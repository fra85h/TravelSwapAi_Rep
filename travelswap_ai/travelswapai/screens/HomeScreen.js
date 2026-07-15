// screens/HomeScreen.js — Annunci pubblici (senza tab "Voli")
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, ScrollView } from "react-native";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { listPublicListings, getCurrentUser } from "../lib/db";
import { getUserSnapshot } from "../lib/backendApi";
import OfferCTAs from "../components/OfferCTA";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import TrustScoreBadge from "../components/TrustScoreBadge";
import SaveButton from "../components/SaveButton";
import { Ionicons } from "@expo/vector-icons";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Estrae i migliori suggerimenti AI dallo snapshot backend, in modo
// tollerante alla forma della risposta (come fa MatchingScreen). Best
// effort: se manca o è malformato, la striscia "Per te" resta nascosta.
function extractPicks(snap) {
  const items = Array.isArray(snap) ? snap : (snap?.items || snap?.rows || snap?.data || []);
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => {
      const listingId = raw.listingId ?? raw.listing_id ?? raw.toId ?? raw.to_id ?? raw.id;
      return {
        listingId,
        title: raw.title ?? raw.name ?? "—",
        location: raw.location ?? raw.city ?? raw.destination ?? "",
        type: raw.type ?? raw.listing_type ?? "",
        score: Number(raw.score ?? raw.score_pct ?? 0) || 0,
      };
    })
    .filter((p) => typeof p.listingId === "string" && UUID_RE.test(p.listingId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// --- Helper: rimuove eventuali prezzi dal titolo
function stripPriceFromTitle(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\s*[-–—]?\s*(?:€|\bEUR\b)?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  out = out.replace(/\s*(?:prezzo|price)\s*[:\-]?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  return out.trim();
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { t, locale } = useI18n();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("all"); // "all" | "hotel" | "train"
  const [me, setMe] = useState(null);
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState([]);

  // helper i18n con fallback + interpolation
  const tt = (key, fallback, vars) => {
    try {
      const raw = t ? t(key) : undefined;
      const txt = (raw && raw !== key) ? raw : fallback;
      if (!vars) return txt;
      return Object.keys(vars).reduce(
        (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k])),
        txt
      );
    } catch {
      if (!vars) return fallback;
      return Object.keys(vars).reduce(
        (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k])),
        fallback
      );
    }
  };

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
      // Suggerimenti AI: best effort, non bloccano la lista se falliscono
      if (u?.id) {
        getUserSnapshot(u.id)
          .then((snap) => setPicks(extractPicks(snap)))
          .catch(() => setPicks([]));
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Ricarica a ogni focus dello screen (non solo al mount): la bottom-tab
  // navigation lascia HomeScreen montato quando si passa ad altre tab, quindi
  // senza questo pausa/riattiva/elimina di un annuncio da Profilo non si
  // rifletteva mai su Esplora finché l'app non veniva riaperta da zero.
  useEffect(() => { if (isFocused) load(); }, [isFocused, load]);

  useEffect(() => {
    navigation.setOptions?.({
      title: tt("esplora.title", "Esplora"),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate("SavedSearches")}
          style={{ paddingHorizontal: 14, paddingVertical: 6 }}
          accessibilityRole="button"
          accessibilityLabel={tt("esplora.alertsA11y", "I miei avvisi di ricerca")}
        >
          <Ionicons name="notifications-outline" size={22} color={theme.colors.boardingText} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, t, locale]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((x) => {
      if (tab !== "all" && String(x.type || "").toLowerCase() !== tab.toLowerCase()) return false;
      if (!q) return true;
      const hay = [x.title, x.location, x.route_from, x.route_to]
        .map((s) => String(s || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [items, tab, query]);

  const renderTabs = () => (
    <View style={styles.tabs}>
      {["all", "hotel", "train"].map((tKey) => {
        const label =
          tKey === "all"
            ? tt("listings.filters.all", "Tutti")
            : tKey === "hotel"
            ? tt("listings.filters.hotels", "Hotel")
            : tt("listings.filters.trains", "Treni");

        return (
          <TouchableOpacity
            key={tKey}
            style={[styles.tab, tab === tKey && styles.tabActive]}
            onPress={() => setTab(tKey)}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Text style={[styles.tabText, tab === tKey && styles.tabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderItem = ({ item }) => {
    const typeLc = String(item.type || "").toLowerCase();
    const typeLabel =
      typeLc === "train"
        ? tt("listing.type.train", "Treno")
        : typeLc === "hotel"
        ? tt("listing.type.hotel", "Hotel")
        : (item.type || "-");

    const published =
      item?.created_at
        ? tt("listing.publishedOn", "Pubblicato il") + " " +
          new Date(item.created_at).toLocaleDateString(locale || undefined)
        : null;

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate("ListingDetail", { id: item.id })}
        activeOpacity={0.8}
        style={styles.card}
      >
        {/* Titolo con icona tipo (in alto a sx) */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
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
          <SaveButton listingId={item.id} size={22} />
        </View>

        <Text style={styles.cardSub}>
          {typeLabel} • {item.location || item.route_from || "-"}
        </Text>

        {item.price != null && (
          <Text style={styles.cardMeta}>
            {Number(item.price).toFixed(2)} {item.currency || "€"}
          </Text>
        )}

        {published ? (
          <Text style={styles.cardPublished}>{published}</Text>
        ) : null}

        <OfferCTAs listing={item} me={me} />

        {/* Affidabilità in basso a destra */}
        {(() => {
          // Supabase/PostgREST serializza le colonne numeric come stringa
          // JSON (es. "58.00"), non come numero — typeof==="number" lasciava
          // il badge sempre nascosto anche a valore correttamente salvato.
          const raw = item.trustscore ?? item.trust_score ?? null;
          const n = raw != null ? Number(raw) : NaN;
          const score = Number.isFinite(n) ? n : null;
          return score != null ? (
            <View style={{ alignItems: "flex-end", marginTop: 8 }}>
              <TrustScoreBadge score={Number(score)} />
            </View>
          ) : null;
        })()}
      </TouchableOpacity>
    );
  };

  // Striscia "Per te": i migliori suggerimenti dell'AI, in cima alla lista.
  // Tiene l'AI in vetrina anche senza un tab dedicato, e porta alla
  // schermata completa con "Vedi tutti".
  const renderPerTe = () => {
    if (!picks.length) return null;
    return (
      <View style={styles.perTeWrap}>
        <View style={styles.perTeHead}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="sparkles" size={15} color={theme.colors.accent} />
            <Text style={styles.perTeTitle}>{tt("esplora.forYouTitle", "Per te")}</Text>
            <View style={styles.aiTag}><Text style={styles.aiTagText}>{tt("matching.aiTag", "AI")}</Text></View>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate("Matching")}>
            <Text style={styles.seeAll}>{tt("esplora.seeAll", "Vedi tutti")}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }}>
          {picks.map((p) => {
            const isTrain = String(p.type || "").toLowerCase() === "train";
            return (
              <TouchableOpacity
                key={p.listingId}
                style={styles.pickCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate("ListingDetail", { id: p.listingId })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name={isTrain ? "train-outline" : "bed-outline"} size={15} color={theme.colors.boardingText} />
                  <Text style={styles.pickScore}>{Math.round(p.score)}</Text>
                </View>
                <Text style={styles.pickTitle} numberOfLines={2}>{stripPriceFromTitle(p.title) || tt("listing.untitled", "Senza titolo")}</Text>
                {p.location ? <Text style={styles.pickSub} numberOfLines={1}>{p.location}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>{tt("common.loading", "Caricamento…")}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>{tt("common.retry", "Riprova")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{tt("esplora.title", "Esplora")}</Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={theme.colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={tt("esplora.searchPlaceholder", "Cerca tratta o città…")}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {renderTabs()}

      <FlatList
        data={filtered}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        ListHeaderComponent={query ? null : renderPerTe}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {query.trim()
                ? tt("esplora.noResults", "Nessun risultato per “{query}”", { query: query.trim() })
                : tab !== "all"
                ? tt("esplora.emptyForType", "Nessun annuncio di questo tipo al momento.")
                : tt("esplora.emptyAll", "Ancora nessun annuncio in giro.")}
            </Text>
            <Text style={styles.emptySub}>
              {query.trim()
                ? tt("esplora.tryOther", "Prova con un'altra città o tratta — o crea un avviso con la campanella in alto: ti avvisiamo noi quando compare.")
                : tab !== "all"
                ? tt("listing.tryChangeFilter", "Prova a cambiare filtro.")
                : tt("esplora.emptyAllSub", "Torna a trovarci tra poco — o pubblica tu il primo dal tab Vendi.")}
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
  loadingText: { marginTop: 8, color: theme.colors.text },
  title: { fontSize: 22, fontWeight: "800", color: theme.colors.text, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tab: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  tabActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.text },
  tabText: { fontWeight: "700", color: theme.colors.textMuted },
  tabTextActive: { color: theme.colors.boardingText },
  card: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  cardTitle: { fontWeight: "800", color: theme.colors.boardingText },
  cardSub: { color: theme.colors.textMuted, marginTop: 4 },
  cardMeta: { color: theme.colors.text, marginTop: 6, fontWeight: "600" },
  cardPublished: { color: theme.colors.textMuted, marginTop: 8, fontSize: 12 },
  errorBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: theme.colors.background },
  error: { color: theme.colors.danger, marginBottom: 8, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontWeight: "600", color: theme.colors.text },
  emptyWrap: { paddingVertical: 32, alignItems: "center", paddingHorizontal: 16 },
  emptyText: { color: theme.colors.textMuted, textAlign: "center", fontWeight: "700" },
  emptySub: { color: theme.colors.textMuted, textAlign: "center", marginTop: 6 },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 12,
    paddingHorizontal: 12, height: 44,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 15, paddingVertical: 0 },

  perTeWrap: { marginBottom: 16 },
  perTeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  perTeTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  seeAll: { color: theme.colors.accent, fontWeight: "800", fontSize: 13 },
  aiTag: {
    backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: theme.colors.accent,
    borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
  },
  aiTagText: { fontSize: 10, fontWeight: "800", color: theme.colors.accentOn, letterSpacing: 0.4 },
  pickCard: {
    width: 150, padding: 12, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  pickScore: { fontSize: 13, fontWeight: "800", color: theme.colors.accent },
  pickTitle: { marginTop: 8, fontWeight: "800", color: theme.colors.boardingText, minHeight: 36 },
  pickSub: { marginTop: 4, color: theme.colors.textMuted, fontSize: 12 },
});
