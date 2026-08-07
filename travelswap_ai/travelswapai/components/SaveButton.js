// components/SaveButton.js — stella toggle per i preferiti
import React, { useEffect, useState } from "react";
import { TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isSaved, toggleSaved } from "../lib/savedListings";
import { theme } from "../lib/theme";

const SAVED_COLOR = theme.colors.accent;

/**
 * @param {string} listingId
 * @param {number} [size=24]
 * @param {boolean} [initialSaved]  se noto, evita la fetch iniziale
 * @param {(saved: boolean) => void} [onChange]  chiamato dopo un toggle riuscito
 *   (es. per rimuovere subito la riga da una lista di preferiti, invece di
 *   aspettare il prossimo focus/refresh della schermata)
 */
export default function SaveButton({ listingId, size = 24, initialSaved, onChange }) {
  const [saved, setSaved] = useState(!!initialSaved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Chi ci monta sapendo già lo stato (la lista Esplora, i Preferiti) non
    // deve pagare una richiesta per riscoprirlo.
    if (initialSaved !== undefined) {
      setSaved(!!initialSaved);
      return undefined;
    }
    if (listingId) {
      isSaved(listingId)
        .then((s) => { if (alive) setSaved(s); })
        .catch(() => {});
    }
    return () => { alive = false; };
    // initialSaved fra le dipendenze non è solo per la prima volta:
    // useState legge il valore iniziale al montaggio e basta, quindi un
    // elemento riciclato da FlatList si sarebbe tenuto la stella di prima.
    // Succedeva davvero tornando su Esplora dopo aver tolto la stellina dal
    // dettaglio annuncio.
  }, [listingId, initialSaved]);

  const onPress = async () => {
    if (busy || !listingId) return;
    setBusy(true);
    const prev = saved;
    setSaved(!prev); // aggiornamento ottimistico
    try {
      const now = await toggleSaved(listingId, prev);
      setSaved(now);
      onChange?.(now);
    } catch (e) {
      setSaved(prev); // rollback in caso di errore
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <ActivityIndicator size="small" color={SAVED_COLOR} />;

  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Ionicons
        name={saved ? "star" : "star-outline"}
        size={size}
        color={saved ? SAVED_COLOR : theme.colors.textMuted}
      />
    </TouchableOpacity>
  );
}
