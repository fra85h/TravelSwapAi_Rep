// La striscia "salvato nei preferiti", una sola per tutta l'app.
//
// Perché una striscia e non un dialogo, due ragioni.
//
// Tecnica: sul web Alert.alert diventa window.alert, e il browser può
// zittirlo del tutto dopo qualche finestra ("impedisci a questa pagina di
// creare altre finestre"). È già il motivo per cui il riepilogo prima di
// pubblicare usa una modale dell'app. Un avviso che l'utente può perdere
// senza accorgersene sarebbe inutile proprio nel caso che deve risolvere.
//
// Di prodotto: salvare non richiede una decisione. Un modale bloccherebbe
// per dare un'informazione, che è quello che le strisce sanno fare.
//
// Sta sopra il navigatore (App.js) come OfflineBanner: salvare si può fare
// da Esplora e dal dettaglio annuncio, e ripeterla in ognuna vorrebbe dire
// dimenticarla in qualcuna.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { subscribeSavedHint } from "../lib/savedHint.mjs";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

const DURATA_MS = 6000;

export default function SavedHint() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [visibile, setVisibile] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const stop = subscribeSavedHint(() => {
      setVisibile(true);
      if (timer.current) clearTimeout(timer.current);
      // Sparisce da sola: nessuno deve chiudere a mano un messaggio che non
      // chiede niente.
      timer.current = setTimeout(() => setVisibile(false), DURATA_MS);
    });
    return () => {
      stop();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const vai = useCallback(() => {
    setVisibile(false);
    if (timer.current) clearTimeout(timer.current);
    navigation.navigate("Saved");
  }, [navigation]);

  if (!visibile) return null;

  return (
    <View style={s.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="star" size={16} color={theme.colors.accentOn} />
      <Text style={s.testo} numberOfLines={2}>
        {t("savedHint.text", "Salvato. Ritrovi i tuoi preferiti dalla stella qui in alto.")}
      </Text>
      <TouchableOpacity onPress={vai} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={s.azione}>{t("savedHint.cta", "Vedi")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.accent,
  },
  testo: { flex: 1, color: theme.colors.accentOn, fontSize: 13, lineHeight: 17, fontWeight: "600" },
  azione: { color: theme.colors.accentOn, fontSize: 13, fontWeight: "900", textDecorationLine: "underline" },
});
