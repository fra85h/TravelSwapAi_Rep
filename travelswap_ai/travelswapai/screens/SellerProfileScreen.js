// screens/SellerProfileScreen.js — profilo PUBBLICO di un venditore
import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Image, StyleSheet, RefreshControl,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { getPublicProfile, listSellerActiveListings } from "../lib/db.js";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

function stripPriceFromTitle(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\s*[-–—]?\s*(?:€|\bEUR\b)?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  out = out.replace(/\s*(?:prezzo|price)\s*[:\-]?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  return out.trim();
}

export default function SellerProfileScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const sellerId = route.params?.sellerId ?? route.params?.id;
  const { t, lang } = (typeof useI18n === "function" ? useI18n() : { t: (s) => s, lang: "it" });
  const locale = lang || "it";
  const tt = (key, fallback, vars) => {
    try {
      const raw = t ? t(key) : undefined;
      const txt = raw && raw !== key ? raw : fallback;
      if (!vars) return txt;
      return Object.keys(vars).reduce((acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k])), txt);
    } catch {
      if (!vars) return fallback;
      return Object.keys(vars).reduce((acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k])), fallback);
    }
  };

  const [profile, setProfile] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation?.setOptions?.({ title: tt("sellerProfile.title", "Venditore") });
  }, [navigation, t, locale]);

  const load = useCallback(async () => {
    if (!sellerId) { setLoading(false); return; }
    try {
      const [p, l] = await Promise.all([
        getPublicProfile(sellerId).catch(() => null),
        listSellerActiveListings(sellerId, { limit: 50 }).catch(() => []),
      ]);
      setProfile(p);
      setListings(Array.isArray(l) ? l : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sellerId]);

  useEffect(() => { load(); }, [load]);

  const name = profile?.full_name || profile?.username || tt("sellerProfile.unknown", "Venditore");
  const initials = (name || "?").trim().slice(0, 2).toUpperCase();
  const since = (() => {
    if (!profile?.created_at) return null;
    const d = new Date(profile.created_at);
    if (isNaN(d.getTime())) return null;
    const loc = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "it-IT";
    try { return d.toLocaleDateString(loc, { month: "long", year: "numeric" }); }
    catch { return d.toLocaleDateString(); }
  })();
  const salesCount = Number(profile?.counters?.sold ?? 0) + Number(profile?.counters?.exchanged ?? 0);
  const activeCount = Number(profile?.counters?.active ?? 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textMuted }}>{tt("sellerProfile.notFound", "Profilo non disponibile.")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      {/* Intestazione profilo */}
      <View style={styles.header}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {since ? (
          <Text style={styles.meta}>{tt("sellerProfile.since", "Membro da {when}", { when: since })}</Text>
        ) : null}
        {!!profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}
      </View>

      {/* Statistiche */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{activeCount}</Text>
          <Text style={styles.statLabel}>{tt("sellerProfile.activeListings", "Annunci attivi")}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{salesCount}</Text>
          <Text style={styles.statLabel}>{tt("sellerProfile.completedSwaps", "Scambi completati")}</Text>
        </View>
      </View>

      {/* Altri annunci attivi */}
      <Text style={styles.sectionTitle}>{tt("sellerProfile.otherListings", "Annunci di questo venditore")}</Text>
      {listings.length === 0 ? (
        <Text style={{ color: theme.colors.textMuted, marginTop: 8 }}>
          {tt("sellerProfile.noListings", "Nessun annuncio attivo al momento.")}
        </Text>
      ) : (
        listings.map((item) => {
          const typeLc = String(item.type || "").toLowerCase();
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => navigation.navigate("ListingDetail", { listingId: item.id, type: item.type })}
              activeOpacity={0.8}
              style={styles.card}
            >
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
                {typeLc === "train" ? (
                  <Ionicons name="train-outline" size={18} color={theme.colors.boardingText} style={{ marginRight: 6 }} />
                ) : typeLc === "hotel" ? (
                  <Ionicons name="bed-outline" size={18} color={theme.colors.boardingText} style={{ marginRight: 6 }} />
                ) : null}
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {stripPriceFromTitle(item.title) || tt("listing.untitled", "Senza titolo")}
                </Text>
              </View>
              <Text style={styles.cardSub} numberOfLines={1}>
                {(item.location || item.route_from || "-")}
              </Text>
              {item.price != null && (
                <Text style={styles.cardPrice}>{Number(item.price).toFixed(2)} {item.currency || "€"}</Text>
              )}
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
  header: { alignItems: "center", paddingVertical: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.surfaceMuted },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  avatarInitials: { color: theme.colors.boardingText, fontWeight: "800", fontSize: 28 },
  name: { fontFamily: theme.fonts.headingExtraBold, fontSize: 20, color: theme.colors.boardingText, marginTop: 12 },
  meta: { color: theme.colors.textMuted, marginTop: 4 },
  bio: { color: theme.colors.text, marginTop: 12, textAlign: "center", lineHeight: 20 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  statBox: {
    flex: 1, alignItems: "center", paddingVertical: 16, borderRadius: 16,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  statValue: { fontSize: 24, fontWeight: "800", color: theme.colors.boardingText },
  statLabel: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4, textAlign: "center" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText, marginTop: 24, marginBottom: 4 },
  card: {
    marginTop: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14,
    backgroundColor: theme.colors.surface,
  },
  cardTitle: { fontWeight: "800", fontSize: 15, color: theme.colors.boardingText, flexShrink: 1 },
  cardSub: { color: theme.colors.textMuted, marginTop: 4 },
  cardPrice: { fontWeight: "800", color: theme.colors.boardingText, marginTop: 6 },
});
