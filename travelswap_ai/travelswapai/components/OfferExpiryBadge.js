// components/OfferExpiryBadge.js — conto alla rovescia per una proposta
// pending (48h, vedi lib/offers.js#getOfferExpiryInfo). Condiviso tra
// AttivitaScreen e OfferDetailScreen per non duplicare le soglie di
// urgenza (1h/6h) e i colori in più punti.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import { getOfferExpiryInfo } from "../lib/offers";

const URGENCY_STYLES = {
  normal: { chip: "chipNormal", text: "txtNormal" },
  warning: { chip: "chipWarning", text: "txtWarning" },
  danger: { chip: "chipDanger", text: "txtDanger" },
  expired: { chip: "chipExpired", text: "txtExpired" },
};

/**
 * @param {string} expiresAt - ISO timestamp (offers.expires_at)
 * @param {boolean} pill - variante larga (flex:1, per sostituire uno statusChip); default chip compatto
 */
export default function OfferExpiryBadge({ expiresAt, pill = false, style }) {
  const { t } = useI18n();
  const info = getOfferExpiryInfo(expiresAt);
  if (!info) return null;

  const label = info.urgency === "expired"
    ? t("offers.expiryExpired", "Scaduta")
    : info.days > 0
      ? t("offers.expiryDays", "Scade tra {d}g {h}h", { d: info.days, h: info.hours })
      : info.hours > 0
        ? t("offers.expiryHours", "Scade tra {h}h {m}min", { h: info.hours, m: info.minutes })
        : t("offers.expiryMinutes", "Scade tra {m}min", { m: info.minutes });

  const sty = URGENCY_STYLES[info.urgency];
  return (
    <View style={[pill ? s.pill : s.chip, s[sty.chip], style]}>
      <Text style={[pill ? s.pillTxt : s.chipTxt, s[sty.text]]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start" },
  chipTxt: { fontSize: 11, fontWeight: "800" },
  pill: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: "center", borderWidth: 1 },
  pillTxt: { fontWeight: "700" },

  chipNormal: { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
  txtNormal: { color: theme.colors.textMuted },
  chipWarning: { backgroundColor: "#FEF3C7", borderColor: "#FBBF24" },
  txtWarning: { color: "#92400E" },
  chipDanger: { backgroundColor: "#FEE2E2", borderColor: "#F87171" },
  txtDanger: { color: "#991B1B" },
  chipExpired: { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
  txtExpired: { color: theme.colors.textMuted, fontStyle: "italic" },
});
