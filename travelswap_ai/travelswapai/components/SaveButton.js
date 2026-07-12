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
 */
export default function SaveButton({ listingId, size = 24, initialSaved }) {
  const [saved, setSaved] = useState(!!initialSaved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (initialSaved === undefined && listingId) {
      isSaved(listingId)
        .then((s) => { if (alive) setSaved(s); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [listingId, initialSaved]);

  const onPress = async () => {
    if (busy || !listingId) return;
    setBusy(true);
    const prev = saved;
    setSaved(!prev); // aggiornamento ottimistico
    try {
      const now = await toggleSaved(listingId, prev);
      setSaved(now);
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
