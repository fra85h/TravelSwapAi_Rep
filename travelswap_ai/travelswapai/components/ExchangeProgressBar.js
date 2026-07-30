// components/ExchangeProgressBar.js
// Analisi empatia/UX, sezione F punto 18: prima lo stato di uno scambio
// 1:1 dopo l'accettazione era solo testo ("Hai confermato. In attesa che
// l'altra persona confermi."), senza un colpo d'occhio su quanto manca —
// a differenza delle catene a 3, che già hanno i pallini di progresso in
// ChainProposalsScreen. Complementa (non sostituisce) il testo esistente.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";

export default function ExchangeProgressBar({ iConfirmed, otherConfirmed, finalized, rated, t }) {
  const steps = [
    { key: "accepted", label: t("chat.progress.accepted", "Accettato"), done: true },
    { key: "you", label: t("chat.progress.you", "Tu"), done: iConfirmed || finalized },
    { key: "other", label: t("chat.progress.other", "Altra parte"), done: otherConfirmed || finalized },
    { key: "done", label: t("chat.progress.done", "Concluso"), done: finalized },
    { key: "rated", label: t("chat.progress.rated", "Valutato"), done: !!rated },
  ];
  return (
    <View style={styles.row} accessibilityLabel={t("chat.progress.a11y", "Stato dello scambio")}>
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          <View style={styles.step}>
            <View style={[styles.dot, s.done && styles.dotDone]}>
              {s.done ? <Ionicons name="checkmark" size={10} color={theme.colors.accentOn} /> : null}
            </View>
            <Text style={[styles.label, s.done && styles.labelDone]} numberOfLines={1}>{s.label}</Text>
          </View>
          {i < steps.length - 1 ? <View style={[styles.line, s.done && styles.lineDone]} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 4 },
  step: { alignItems: "center", width: 50 },
  dot: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center", justifyContent: "center",
  },
  dotDone: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },
  label: { fontSize: 9.5, color: theme.colors.textMuted, marginTop: 3, textAlign: "center" },
  labelDone: { color: theme.colors.text, fontWeight: "700" },
  line: { flex: 1, height: 2, backgroundColor: theme.colors.border, marginTop: 8 },
  lineDone: { backgroundColor: theme.colors.success },
});
