// screens/MatchingScreen.js — layout classico + snapshot backend reale
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  ToastAndroid,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { createIconSetFromFontello, Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { useI18n } from "../lib/i18n";

// Backend reale
import { getCurrentUser } from "../lib/db";
import { getUserSnapshot, recomputeUserSnapshot } from "../lib/backendApi";

/* ---------- UI di supporto ---------- */
function EmptyState({ onRecompute, isLoading, hasError }) {
  return (
    <View style={{ alignItems: "center", padding: 24 }}>
      <Ionicons
        name={hasError ? "cloud-offline-outline" : "bulb-outline"}
        size={28}
        color="#111827"
      />
      <Text style={{ marginTop: 10, fontWeight: "800" }}>
        {hasError ? "Backend non raggiungibile" : "Nessun match calcolato"}
      </Text>
      {!hasError && (
        <TouchableOpacity
          onPress={onRecompute}
          disabled={isLoading}
          style={{ marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#111827", borderRadius: 999 }}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "800" }}>Ricalcola AI</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

function SkeletonRow() {
  return (
    <View style={styles.row}>
      <View style={[styles.skel, { width: 48, height: 48, borderRadius: 10 }]} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={[styles.skel, { width: "60%", height: 14, borderRadius: 6 }]} />
        <View style={{ height: 8 }} />
        <View style={[styles.skel, { width: "40%", height: 12, borderRadius: 6 }]} />
      </View>
      <View style={[styles.badge, { width: 48 }]} />
    </View>
  );
}

function LegendCard({ t }) {
  return (
    <View style={styles.legendCard}>
      <Text style={styles.legendTitle}>{t("matching.legend.title", "Cosa significano 60 / 70 / 80?")}</Text>

      <View style={styles.legendRow}>
        <View style={[styles.legendDot, { backgroundColor: "#FEF9C3", borderColor: "#FDE68A" }]} />
        <Text style={styles.legendText}>{t("matching.legend.base", "60–69 = compatibilità di base")}</Text>
      </View>

      <View style={styles.legendRow}>
        <View style={[styles.legendDot, { backgroundColor: "#ECFCCB", borderColor: "#BEF264" }]} />
        <Text style={styles.legendText}>{t("matching.legend.good", "70–79 = buona compatibilità")}</Text>
      </View>

      <View style={styles.legendRow}>
        <View style={[styles.legendDot, { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" }]} />
        <Text style={styles.legendText}>{t("matching.legend.excellent", "80–100 = affinità eccellente")}</Text>
      </View>

      <Text style={[styles.legendText, { marginTop: 8 }]}>
        {t(
          "matching.legend.long",
          "Il punteggio è una stima (0–100) calcolata da TravelSwap AI combinando: preferenze e cronologia, allineamento prezzo, prossimità/località, sovrapposizione date, categoria/tipo annuncio e segnali di interesse reciproco. I “match perfetti” sono bidirezionali."
        )}
      </Text>
    </View>
  );
}

function StatusBanner({ state, t }) {
  if (state === "idle") return null;
  const map = {
    queued: { text: t("matching.status.queued", "Ricalcolo AI in coda…"), bg: "#FFF7ED", border: "#FED7AA", color: "#9A3412", icon: "time-outline" },
    running:{ text: t("matching.status.running","Ricalcolo AI in corso…"), bg:"#EEF2FF", border:"#C7D2FE", color:"#1E3A8A", icon:"sparkles-outline" },
    done:   { text: t("matching.status.done",  "Ricalcolo completato ✓"), bg:"#ECFDF5", border:"#A7F3D0", color:"#065F46", icon:"checkmark-circle-outline" },
    error:  { text: t("matching.status.error", "Backend offline o non raggiungibile"), bg:"#FEF2F2", border:"#FECACA", color:"#991B1B", icon:"alert-circle-outline" },
  };
  const s = map[state] || map.queued;
  return (
    <View style={[styles.banner, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Ionicons name={s.icon} size={16} color={s.color} />
      <Text style={[styles.bannerText, { color: s.color }]}>{s.text}</Text>
    </View>
  );
}

/* ---------- Riga Match ---------- */

function MatchRow({ item, onPress, isNew, expanded, onToggleInfo, generatedAt }) {
  const { t } = useI18n();
  const badgeStyle =
    item.score >= 80 ? styles.badgeGreen : item.score >= 70 ? styles.badgeLime : styles.badgeYellow;

  const fallbackExpl = [
    item.bidirectional ? "Match reciproco (💫)" : null,
    `Affinità ${Math.round(Number(item.score) || 0)}/100`,
    item.location ? `Località: ${item.location}` : null,
    item.type ? `Tipologia: ${item.type}` : null,
    item.price != null ? `Prezzo: €${item.price}` : null,
  ].filter(Boolean).join(" · ");

  const explText = item.explanation || fallbackExpl;
  const model = item.model || (item.explanation ? "AI" : "heuristic");
  const upd = item.updatedAt || generatedAt || null;

  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: "#E5E7EB" }]} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          {isNew && (
            <View style={styles.newPill}>
              <Text style={styles.newPillText}>{t("matching.pill.new", "Nuovo")}</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta}>
          {item.location} · {item.type === "hotel" ? t("listing.type.hotel", "Hotel") : t("listing.type.train", "Treno")}
        </Text>

        {expanded ? (
          <View style={styles.explBox}>
            <Text style={styles.explText} numberOfLines={4}>{explText}</Text>
            <View style={styles.explFooter}>
              {model ? <Text style={styles.explSmall}>model: {model}</Text> : <View />}
              {upd ? <Text style={styles.explSmall}>upd: {new Date(upd).toLocaleDateString()}</Text> : null}
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.rightCol}>
        {item.bidirectional ? (
          <View style={[styles.badge, styles.badgeBlue]}>
            <Text style={{ fontWeight: "800", color: "#0369A1" }}>💫</Text>
          </View>
        ) : (
          <View style={[styles.badge, badgeStyle]}>
            <Text style={styles.badgeText}>{Math.round(item.score)}</Text>
          </View>
        )}

        <TouchableOpacity onPress={onToggleInfo} style={styles.infoChip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="information-circle-outline" size={16} color="#111827" />
          <Text style={styles.infoChipTxt}>{expanded ? t("matching.hide","Nascondi") : t("matching.info","Info")}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onPress} style={{ paddingTop: 6 }}>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------- Screen ---------- */

export default function MatchingScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight(); // calcolato qui (mai nei renderItem)
  const { t, lang } = useI18n();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [status, setStatus] = useState("idle"); // 'idle' | 'queued' | 'running' | 'done' | 'error'
  const [rows, setRows] = useState([]); // elementi normalizzati
  const [showLegend, setShowLegend] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [expanded, setExpanded] = useState(new Set());
  const expandedKey = useMemo(() => Array.from(expanded).sort().join("|"), [expanded]);

  const prevScoresRef = useRef(new Map());
  const [newIds, setNewIds] = useState(new Set());
  const userRef = useRef(null);
const asArray = (x) => Array.isArray(x) ? x : (x == null ? [] : [x]);

const coerceSnapshot = (snap) => {
  if (Array.isArray(snap)) {
    return { items: snap, generatedAt: null };
  }
  if (snap && Array.isArray(snap.items)) {
    return { items: snap.items, generatedAt: snap.generatedAt ?? snap.generated_at ?? null };
  }
  if (snap && Array.isArray(snap.rows)) {
    return { items: snap.rows, generatedAt: snap.generatedAt ?? snap.generated_at ?? null };
  }
  if (snap && Array.isArray(snap.data)) {
    return { items: snap.data, generatedAt: snap.generatedAt ?? snap.generated_at ?? null };
  }
  if (snap && typeof snap === "object") {
    // fallback estremo: prendi i valori dell’oggetto
    return { items: Object.values(snap), generatedAt: snap.generatedAt ?? snap.generated_at ?? null };
  }
  return { items: [], generatedAt: null };
};
  useLayoutEffect(() => {
    navigation.setOptions({ title: t("matching.title", "AI Matching") });
  }, [navigation, t, lang]);

  const toast = (msg) => {
    if (Platform.OS === "android") ToastAndroid.show(msg, ToastAndroid.SHORT);
  };

  const isUUID = (val) =>
    typeof val === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);


     const normalize = useCallback((items, generatedAt) => {
  const list = Array.isArray(items) ? items : (items == null ? [] : [items]);

  const arr = list.map((raw) => {
    // id / listingId
    const id =
      raw.toId ?? raw.to_id ??
      raw.listingId ?? raw.listing_id ??
      raw.id;

    const listingId =
      raw.listingId ?? raw.listing_id ?? raw.toId ?? raw.to_id ?? id;

    // campi base
    const title     = raw.title ?? raw.name ?? "—";
    const location  = raw.location ?? raw.city ?? raw.destination ?? "—";
    const type      = raw.type ?? raw.listing_type ?? raw.category ?? "—";
    const priceRaw  = raw.price ?? raw.price_eur ?? raw.amount ?? null;
    const price     = priceRaw == null ? null : Number(priceRaw);

    // score (supporta stringhe/alias)
    const score = Number(raw.score ?? raw.score_pct ?? raw.score_percent ?? 0) || 0;

    // bidirectional normalizzato (bool, 0/1, "t"/"f", "true"/"false", "1")
    const bidirectional = (() => {
      const b = raw.bidirectional ?? raw.is_bidirectional ?? raw.match_type;
      if (typeof b === "string") {
        const s = b.toLowerCase();
        return s === "true" || s === "t" || s === "1" || s === "bidirectional";
      }
      if (typeof b === "number") return b === 1;
      return !!b;
    })();

    const explanation = raw.explanation ?? raw.reason ?? null;
    const model       = raw.model ?? raw.algo ?? null;
    const updatedAt   = raw.updatedAt ?? raw.updated_at ?? generatedAt ?? null;

    return {
      id,
      listingId,
      title,
      location,
      type,
      price,
      score,
      bidirectional,
      explanation,
      model,
      updatedAt,
    };
  });

  arr.sort((a, b) => b.score - a.score);
  return arr;
}, []);


  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const u = await getCurrentUser();
      userRef.current = u;
      if (!u?.id) throw new Error("missing user");

 const snap = await getUserSnapshot(u.id);
 const { items, generatedAt } = coerceSnapshot(snap);
 // debug utile per capire che forma arriva
 console.log("[MatchingScreen] snapshot shape keys:", snap && typeof snap === "object" ? Object.keys(snap) : typeof snap);
 console.log("[MatchingScreen] items length:", Array.isArray(items) ? items.length : "not-array");
 const n = normalize(items, generatedAt);
      setRows(n);

      const base = new Map();
      for (const m of n) base.set(m.id, m.score);
      prevScoresRef.current = base;
      // piccolo aiuto per debug rapido
      console.log("[MatchingScreen] snapshot items:", items?.length ?? 0);
      if (Platform.OS === "android") {
        ToastAndroid.show(`🔎 ${n.length} match caricati`, ToastAndroid.SHORT);
      }

    } catch (e) {
      console.error("[MatchingScreen] load error:", e);
      setLoadError(e?.message || String(e));
      setRows([]);               // nessun mock
      setStatus("error");        // banner rosso
    } finally {
      setLoading(false);
    }
  }, [normalize]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const onRecompute = async () => {
    try {
      setRecomputing(true);
      setStatus("queued");
      toast(t("matching.toasts.queued", "Ricalcolo AI in coda…"));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      await new Promise((r) => setTimeout(r, 300));
      setStatus("running");

      const u = userRef.current || (await getCurrentUser());
      if (!u?.id) throw new Error("missing user");

      const before = new Map(prevScoresRef.current);

      await recomputeUserSnapshot(u.id, { topPerListing: 3, maxTotal: 50 });
      const snap = await getUserSnapshot(u.id);
      const items = Array.isArray(snap) ? snap : (snap?.items || []);
      const generatedAt = Array.isArray(snap) ? null : (snap?.generatedAt ?? snap?.generated_at ?? null);
      const n = normalize(items, generatedAt);
      setRows(n);

      const latest = new Map(n.map((m) => [m.id, m.score]));
      const changed = new Set();
      for (const [id, score] of latest.entries()) {
        const prev = before.get(id);
        if (prev === undefined || prev !== score) changed.add(id);
      }
      setNewIds(changed);
      prevScoresRef.current = latest;

      setStatus("done");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => { setStatus("idle"); setNewIds(new Set()); }, 1600);
    } catch (e) {
      console.error("[MatchingScreen] recompute error:", e);
      setStatus("error");
      if (Platform.OS === "android") {
        ToastAndroid.show(String(e?.message || "Errore backend"), ToastAndroid.SHORT);
      } else {
        Alert.alert("Errore backend", String(e?.message || "Impossibile contattare il server"));
      }
    } finally {
      setRecomputing(false);
    }
  };

  const perfect = useMemo(() => rows.filter((m) => m.bidirectional === true && m.score >= 80), [rows]);
  const compatible = useMemo(() => rows.filter((m) => !m.bidirectional), [rows]);

  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const Section = ({ title, icon, subtitle, items, generatedAt }) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{icon} {title}</Text>
        {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>

      {loading ? (
        <View>{[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}</View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it, idx) => String(it.id ?? idx)}
          renderItem={({ item }) => {
            const targetId = item.listingId || item.id;
           const safeNavigate = () => {
             if (!targetId) return; // niente tap se manca del tutto
              if (isUUID(targetId)) {
                navigation.navigate("OfferDetail", {
                  listingId: targetId,
                  type: item.type || "hotel",
                });
              } else {
                // Non alzare un alert: semplicemente ignora il tap (rimane visualizzabile la riga)
                console.log("[MatchingScreen] listingId non-UUID, tap ignorato:", targetId);
              }
             };
            return (
              <MatchRow
                item={item}
                isNew={newIds.has(item.id)}
                expanded={expanded.has(item.id)}
                onToggleInfo={() => toggleExpand(item.id)}
                onPress={safeNavigate}
                generatedAt={generatedAt}
              />
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          scrollEnabled={false}
          ListEmptyComponent={
           <EmptyState
              onRecompute={onRecompute}
              isLoading={recomputing || loading}
              hasError={!!loadError}
            />
          }
          extraData={`${expandedKey}|${newIds.size}`}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBanner state={status} t={t} />

      <FlatList
        data={[{ key: "content" }]}
        keyExtractor={(i) => i.key}
        renderItem={() => (
          <View style={{ padding: 16, paddingBottom: (tabBarHeight || 0) + (insets.bottom || 0) + 96 }}>
            <View style={styles.legendHeaderRow}>
              <Text style={styles.legendHeaderTitle}>{t("matching.title", "AI Matching")}</Text>
              <TouchableOpacity
                onPress={() => setShowLegend((v) => !v)}
                style={styles.legendToggle}
                accessibilityRole="button"
                accessibilityLabel={showLegend ? "Nascondi spiegazione punteggi" : "Mostra spiegazione punteggi"}
              >
                <Ionicons name={showLegend ? "chevron-up" : "information-circle-outline"} size={18} color="#111827" />
                <Text style={styles.legendToggleText}>{showLegend ? "Nascondi spiegazione" : "Mostra spiegazione"}</Text>
              </TouchableOpacity>
            </View>

            {showLegend && <LegendCard t={t} />}

            <View style={{ height: 12 }} />
            <Section
              title={t("matching.sections.perfectTitle", "Match perfetti")}
              icon="🍀"
              subtitle={t("matching.sections.perfectSubtitle","Incroci bidirezionali: piaci a loro e loro piacciono a te. 80+ = affinità altissima.")}
              items={perfect}
              generatedAt={rows?.[0]?.updatedAt || null}
            />

            <View style={{ height: 12 }} />
            <Section
              title={t("matching.sections.compatibleTitle", "Match compatibili")}
              icon="🤝"
              subtitle={t("matching.sections.compatibleSubtitle","I numeri (60/70/80) sono la percentuale stimata di compatibilità: 60=base, 70=buona, 80+=eccellente.")}
              items={compatible}
              generatedAt={rows?.[0]?.updatedAt || null}
            />
          </View>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* FAB rotondo ⚡ */}
      <TouchableOpacity
        onPress={onRecompute}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel="Ricalcola AI"
        style={[styles.fab, { bottom: (tabBarHeight || 0) + (insets.bottom || 0) + 18 }]}
      >
        {recomputing ? <ActivityIndicator color="#fff" /> : <Ionicons name="flash" size={26} color="#fff" />}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  /* Banner stato */
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerText: { fontWeight: "700" },

  /* Header legenda */
  legendHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  legendHeaderTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  legendToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  legendToggleText: { fontWeight: "700", color: "#111827" },

  /* Sezioni */
  section: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
  },
  sectionHeader: { marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  sectionSubtitle: { color: "#6B7280", marginTop: 4 },

  /* Riga */
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F3F4F6",
    borderRadius: 12,
    padding: 10,
  },
  avatar: { width: 48, height: 48, borderRadius: 10 },
  title: { fontWeight: "800", color: "#111827", marginRight: 8 },
  meta: { color: "#6B7280", marginTop: 2 },

  /* colonna destra */
  rightCol: { alignItems: "flex-end", justifyContent: "center", gap: 8 },

  /* Badge "Nuovo" */
  newPill: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "#111827", borderRadius: 999 },
  newPillText: { color: "#fff", fontWeight: "800", fontSize: 10, marginTop: 1 },

  /* Badge score */
  badge: {
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  badgeText: { fontWeight: "800", color: "#92400E" },
  badgeGreen: { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" },
  badgeLime: { backgroundColor: "#ECFCCB", borderColor: "#BEF264" },
  badgeYellow: { backgroundColor: "#FEF9C3", borderColor: "#FDE68A" },
  badgeBlue: { backgroundColor: "#EAF7FF", borderColor: "#BAE6FD" },

  /* Chip "i Info" */
  infoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  infoChipTxt: { color: "#111827", fontWeight: "700", fontSize: 12 },

  /* Spiegazione */
  explBox: { marginTop: 8, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10 },
  explText: { color: "#374151", lineHeight: 18 },
  explFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  explSmall: { fontSize: 12, color: "#6B7280" },

  /* Skeleton */
  skel: { backgroundColor: "#E5E7EB" },

  /* FAB */
  fab: {
    position: "absolute",
    right: 16,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 8 },
    }),
  },
});
