// components/TrustBadges.js — segnali di fiducia "leggeri" sul venditore:
// email verificata (dalla conferma Supabase, non falsificabile lato client) e
// storico (numero di scambi/vendite concluse). Nessuna verifica identità con
// documento: è un deterrente base, mostrato dove si valuta un venditore
// (dettaglio annuncio, profilo venditore).
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function TrustBadges({ emailVerified, salesCount = 0, style }) {
  const { t } = useI18n();
  const hasEmail = !!emailVerified;
  const hasHistory = Number(salesCount) > 0;
  if (!hasEmail && !hasHistory) return null;
  return (
    <View style={[styles.row, style]}>
      {hasEmail ? (
        <View style={[styles.badge, styles.badgeVerified]}>
          <Ionicons name="shield-checkmark" size={12} color="#166534" style={{ marginRight: 4 }} />
          <Text style={[styles.text, { color: "#166534" }]}>{t("trust.emailVerified", "Email verificata")}</Text>
        </View>
      ) : null}
      {hasHistory ? (
        <View style={[styles.badge, styles.badgeHistory]}>
          <Ionicons name="ribbon-outline" size={12} color={theme.colors.accentOn} style={{ marginRight: 4 }} />
          <Text style={[styles.text, { color: theme.colors.accentOn }]}>
            {t("trust.hasHistory", "Con storico ({n})", { n: Number(salesCount) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  badge: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1,
  },
  badgeVerified: { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" },
  badgeHistory: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
  text: { fontSize: 11, fontWeight: "700" },
});
