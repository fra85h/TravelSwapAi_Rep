// La striscia "sei offline", una sola per tutta l'app.
//
// Sta sopra il contenuto e sotto l'header: deve essere vista senza coprire
// nulla, e sparire da sola quando la rete torna — chiuderla a mano
// significherebbe nascondere un fatto che è ancora vero.
//
// Perché una striscia e non un dialogo: perdere la rete non è un errore
// dell'utente e non richiede una decisione. Un modale bloccherebbe anche
// tutto ciò che nell'app funziona lo stesso (rileggere una chat già
// caricata, correggere una bozza).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isOffline, subscribeConnectivity } from "../lib/connectivity";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

export function useOnline() {
  const [offline, setOffline] = useState(isOffline());
  useEffect(() => subscribeConnectivity(setOffline), []);
  return !offline;
}

export default function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;

  return (
    <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <MaterialCommunityIcons name="wifi-off" size={16} color="#7C4A03" />
      <Text style={styles.text}>
        {t("common.offlineBanner", "Sei offline: quello che vedi potrebbe non essere aggiornato.")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF3C7",
    borderBottomWidth: 1,
    borderBottomColor: "#FCD34D",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  text: { flex: 1, color: "#7C4A03", fontSize: 13, fontWeight: "600", lineHeight: 17 },
});
