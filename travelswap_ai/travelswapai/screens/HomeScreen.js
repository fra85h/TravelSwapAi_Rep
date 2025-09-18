// screens/HomeScreen.js — Annunci pubblici + CTA Proponi acquisto / Proponi scambio
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { listPublicListings, getCurrentUser } from "../lib/db";
import OfferCTAs from "../components/OfferCTA";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import TrustScoreBadge from '../components/TrustScoreBadge';

export default function HomeScreen() {
  const navigation = useNavigation();
  const { t, lang } = useI18n();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("all"); // "all" | "hotel" | "train" | "flight"
  const [me, setMe] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [u, data] = await Promise.all([
        getCurrentUser().catch(() => null),
        listPublicListings({ limit: 100, excludeMine: false }),
      ]);
      setMe(u);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // se vuoi che il titolo dell'header cambi lingua dinamicamente:
  useEffect(() => {
    // aggiorna l'header quando cambia lingua
    navigation.setOptions?.({ title: t("listingsTitle") });
  }, [navigation, t, lang]);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    const ttype = tab.toLowerCase();
    return items.filter((x) => String(x.type || "").toLowerCase() === ttype);
  }, [items, tab]);

const renderTabs = () => (
  <View style={styles.tabs}>
    {["all", "hotel", "train", "flight"].map((tKey) => {
      const label =
        tKey === "all"
          ? t("listings.filters.all", "Tutti")
          : tKey === "hotel"
          ? t("listings.filters.hotels", "Hotel")
          : tKey === "train"
          ? t("listings.filters.trains", "Treni")
          : t("listings.filters.flights", "Voli");

      return (
        <TouchableOpacity
          key={tKey}
          style={[styles.tab, tab === tKey && styles.tabActive]}
          onPress={() => setTab(tKey)}
        >
          <Text style={[styles.tabText, tab === tKey && styles.tabTextActive]}>
            {label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const renderItem = ({ item }) => (
  <TouchableOpacity
    onPress={() => navigation.navigate("ListingDetail", { id: item.id })}
    activeOpacity={0.8}
    style={styles.card}
  >
    {/* Titolo + Trustscore allineato a destra */}
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={styles.cardTitle}>{item.title || t("listing", "Annuncio")}</Text>
     
    </View>

    <Text style={styles.cardSub}>
      {item.type} • {item.location || item.route_from || "-"}
    </Text>

    {item.price != null && (
      <Text style={styles.cardMeta}>
        {Number(item.price).toFixed(2)} {item.currency || "€"}
      </Text>
    )}

    {/* CTA per comprare/scambiare (nascoste automaticamente sui miei) */}
    <OfferCTAs listing={item} me={me} />
    {/* Affidabilità in basso a destra */}
{(() => {
  const score =
    typeof item.trustscore === "number"
      ? item.trustscore
      : typeof item.trust_score === "number"
      ? item.trust_score
      : null;
  return score != null ? (
    <View style={{ alignItems: "flex-end", marginTop: 8 }}>
      <TrustScoreBadge score={Number(score)} />
    </View>
  ) : null;
})()}
  </TouchableOpacity>
);


  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>{t("retry")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("listingsTitle")}</Text>
      {renderTabs()}

      <FlatList
        data={filtered}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}><Text style={styles.emptyText}>{t("noItems")}</Text></View>
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tab: { borderWidth: 1, borderColor: "#E5E7EB", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  tabActive: { backgroundColor: theme.colors.primary, borderColor: "#111827" },
  tabText: { fontWeight: "700", color: theme.colors.boardingText },
  tabTextActive: { color: theme.colors.boardingText },
  card: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12, backgroundColor: "#fff" },
  cardTitle: { fontWeight: "800" },
  cardSub: { color: "#6B7280", marginTop: 4 },
  cardMeta: { color: "#111827", marginTop: 6, fontWeight: "600" },
  errorBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  error: { color: "#B91C1C", marginBottom: 8 },
  retryBtn: { borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontWeight: "600", color: "#111827" },
  emptyWrap: { paddingVertical: 32, alignItems: "center" },
  emptyText: { color: "#6B7280" },
});
