// components/UserRating.js — "★ 4,7 (12)" accanto al nome, stile eBay.
//
// Si carica da solo il proprio aggregato: chi lo monta passa solo lo userId.
// Sotto MIN_RATINGS_FOR_AVERAGE voti mostra "Nuovo" invece della media — una
// media di 5,0 su un voto solo è rumore spacciato per reputazione.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { formatRating, starsFor } from "../lib/ratingDisplay.mjs";
import { getUserRating } from "../lib/ratingsApi";

export default function UserRating({ userId, style }) {
  const { t } = useI18n();
  const [agg, setAgg] = useState(null);

  useEffect(() => {
    let vivo = true;
    if (!userId) { setAgg(null); return; }
    getUserRating(userId).then((r) => { if (vivo) setAgg(r); }).catch(() => {});
    return () => { vivo = false; };
  }, [userId]);

  if (!agg) return null;
  const f = formatRating(agg.avg, agg.count);
  if (!f.show) return null;

  if (f.isNew) {
    return (
      <View style={[styles.chip, styles.chipNew, style]}>
        <Text style={[styles.text, { color: theme.colors?.textMuted || "#6B7280" }]}>
          {t("ratings.newUser", "Nuovo")}
        </Text>
      </View>
    );
  }

  const { full, half } = starsFor(f.value);
  return (
    <View style={[styles.chip, style]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Ionicons
          key={i}
          name={i < full ? "star" : (i === full && half ? "star-half" : "star-outline")}
          size={13}
          color="#D9A621"
        />
      ))}
      <Text style={styles.text}>
        {String(f.value).replace(".", ",")} ({f.count})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  chipNew: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors?.border || "#E5E7EB",
    backgroundColor: theme.colors?.surface || "#F4F5F9",
  },
  text: { marginLeft: 4, fontSize: 12, fontWeight: "700", color: theme.colors?.boardingText || "#111827" },
});
