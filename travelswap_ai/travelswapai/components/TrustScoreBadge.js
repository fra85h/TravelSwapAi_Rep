// components/TrustScoreBadge.js
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function TrustScoreBadge({ score }) {
  const { t } = useI18n();
  const label = t("trust.scoreLabel", "Affidabilità");

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
