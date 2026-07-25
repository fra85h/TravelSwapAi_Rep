// components/TrustScoreBadge.js
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function TrustScoreBadge({ score, pending = false }) {
  const { t } = useI18n();
  const label = t("trust.scoreLabel", "Affidabilità");

  // Verifica non ancora completata (l'AI non ha risposto): stato NEUTRO, senza
  // percentuale e senza colore di giudizio.
  //
  // Prima qui arrivava un punteggio tappato a 55, quindi rosso: l'app diceva
  // al compratore "abbiamo controllato e non convince" mentre non aveva
  // controllato niente, e il venditore si ritrovava marchiato per un guasto
  // nostro. Un numero più gentile non risolverebbe: qualunque numero è una
  // misura, e qui non c'è niente di misurato. L'unica cosa vera da mostrare è
  // che il controllo è in corso.
  if (pending) {
    return (
      <View style={[styles.badge, { backgroundColor: "#F1F3F8", borderColor: "#D5DAE5" }]}>
        <Text style={[styles.text, { color: "#4A5268" }]}>
          {t("trust.pendingLabel", "Verifica in corso")}
        </Text>
      </View>
    );
  }

  if (typeof score !== "number") return null;

  const bg =
    score >= 85 ? "#ECFDF5" : score >= 70 ? "#FFFBEB" : "#FEF2F2";
  const fg =
    score >= 85 ? "#065F46" : score >= 70 ? "#92400E" : "#991B1B";
  const bd =
    score >= 85 ? "#A7F3D0" : score >= 70 ? "#FDE68A" : "#FECACA";

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[styles.text, { color: fg }]}>
        {label}: {Math.round(score)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  text: {
    fontWeight: "700",
    color: theme.colors?.boardingText || "#111827",
  },
});
