// screens/MatchingScreen.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { useLayoutEffect } from "react";
import { useI18n } from "../lib/i18n";

// Se presente, useremo le API reali; in fallback usiamo i mock.
let apiListMatches = null;
let apiRecomputeMatches = null;
try {
  // eslint-disable-next-line global-require
  const mod = require("../lib/api");
  apiListMatches = mod.listMatches;
  apiRecomputeMatches = mod.recomputeMatches;
} catch (_) {
  /* ignore – mock fallback */
}

/* -------- MOCK DATA -------- */
const MOCK_MATCHES = [
  // Perfetti (bidirezionali)
  { id: "p1", title: "Weekend Lago di Como", location: "Como", type: "hotel", score: 92, bidirectional: true },
  { id: "p2", title: "Casa vacanza in Toscana", location: "Siena", type: "hotel", score: 88, bidirectional: true },
  { id: "p3", title: "Frecciarossa Milano → Roma", location: "MI Centrale → RM Termini", type: "train", score: 85, bidirectional: true },
  // Compatibili
  { id: "c1", title: "B&B centro storico", location: "Bologna", type: "hotel", score: 78, bidirectional: false },
  { id: "c2", title: "Intercity Genova → Pisa", location: "GE Brignole → PI Centrale", type: "train", score: 73, bidirectional: false },
  { id: "c3", title: "Monolocale mare", location: "Rimini", type: "hotel", score: 69, bidirectional: false },
  { id: "c4", title: "Regionale Verona → Venezia", location: "VR Porta Nuova → VE S. Lucia", type: "train", score: 64, bidirectional: false },
];

/* -------- Skeleton riga -------- */
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

/* -------- Riga match -------- */
function MatchRow({ item, onPress, isNew }) {
  const { t } = useI18n(); // <— prendi t qui

  const badgeStyle =
    item.score >= 80 ? styles.badgeGreen : item.score >= 70 ? styles.badgeLime : styles.badgeYellow;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
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
      </View>
      <View style={[styles.badge, badgeStyle]}>
        <Text style={styles.badgeText}>{item.score}</Text>
      </View>
    </TouchableOpacity>
  );
}

/* -------- Legend + Spiegazione -------- */
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

/* -------- Banner stato ricalcolo -------- */
function StatusBanner({ state, t }) {
  // state: 'idle' | 'queued' | 'running' | 'done'
  if (state === "idle") return null;
  const map = {
    queued: {
      text: t("matching.status.queued", "Ricalcolo AI in coda…"),
      bg: "#FFF7ED",
      border: "#FED7AA",
      color: "#9A3412",
      icon: "time-outline",
    },
    running: {
      text: t("matching.status.running", "Ricalcolo AI in corso…"),
      bg: "#EEF2FF",
      border: "#C7D2FE",
      color: "#1E3A8A",
      icon: "sparkles-outline",
    },
    done: {
      text: t("matching.status.done", "Ricalcolo completato ✓"),
      bg: "#ECFDF5",
      border: "#A7F3D0",
      color: "#065F46",
      icon: "checkmark-circle-outline",
    },
  };
  const s = map[state] || map.queued;
  return (
    <View style={[styles.banner, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Ionicons name={s.icon} size={16} color={s.color} />
      <Text style={[styles.bannerText, { color: s.color }]}>{s.text}</Text>
    </View>
  );
}

export default function MatchingScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [status, setStatus] = useState("idle"); // 'idle' | 'queued' | 'running' | 'done'
  const [data, setData] = useState([]);
  const { t, lang } = useI18n();

  useLayoutEffect(() => {
    navigation.setOptions({ title: t("matching.title", "AI Matching") });
  }, [navigation, t, lang]);

  // legenda collassabile
  const [showLegend, setShowLegend] = useState(false);

  // per marcare "Nuovo" dopo ricalcolo
  const prevScoresRef = useRef(new Map());
  const [newIds, setNewIds] = useState(new Set()); // Set<string>

  const toast = (msg) => {
    if (Platform.OS === "android") ToastAndroid.show(msg, ToastAndroid.SHORT);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let res;
      if (typeof apiListMatches === "function") {
        res = await apiListMatches();
      } else {
        await new Promise((r) => setTimeout(r, 500));
        res = MOCK_MATCHES;
      }
      setData(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // salva punteggi correnti come baseline (una volta al primo load)
    const map = new Map();
    for (const m of data) map.set(m.id, m.score);
    prevScoresRef.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intenzionalmente solo al mount

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const onRecompute = async () => {
    try {
      setRecomputing(true);
      setStatus("queued");
      toast(t("matching.toasts.queued", "Ricalcolo AI in coda…"));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Simula breve attesa coda → running
      await new Promise((r) => setTimeout(r, 400));
      setStatus("running");

      if (typeof apiRecomputeMatches === "function") {
        const before = new Map(prevScoresRef.current);
        await apiRecomputeMatches();
        await load();
        // confronta e marca "nuovi/aggiornati"
        const latest = new Map();
        for (const m of data) latest.set(m.id, m.score);
        const changed = new Set();
        for (const [id, score] of latest.entries()) {
          const prev = before.get(id);
          if (prev === undefined || score !== prev) changed.add(id);
        }
        setNewIds(changed);
        prevScoresRef.current = latest;
      } else {
        // Mock ricalcolo: jitter leggero sui punteggi
        await new Promise((r) => setTimeout(r, 800));
        setData((prev) => {
          const before = new Map(prev.map((m) => [m.id, m.score]));
          const nextArr = prev.map((m) => {
            const jitter = Math.round((Math.random() - 0.5) * 8); // -4..+4
            const nextScore = Math.max(55, Math.min(99, m.score + jitter));
            return { ...m, score: nextScore };
          });
          const changed = new Set();
          for (const m of nextArr) {
            const prevScore = before.get(m.id);
            if (prevScore === undefined || prevScore !== m.score) changed.add(m.id);
          }
          setNewIds(changed);
          prevScoresRef.current = new Map(nextArr.map((m) => [m.id, m.score]));
          return nextArr;
        });
      }

      setStatus("done");
      toast(t("matching.toasts.done", "Ricalcolo completato ✓"));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // dopo poco, nascondi stato & "Nuovo"
      setTimeout(() => {
        setStatus("idle");
        setNewIds(new Set());
      }, 1800);
    } finally {
      setRecomputing(false);
    }
  };

  const perfect = useMemo(() => data.filter((m) => m.bidirectional === true), [data]);
  const compatible = useMemo(() => data.filter((m) => !m.bidirectional), [data]);
const isUUID = (val) =>
  typeof val === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
  const Section = ({ title, icon, subtitle, items }) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {icon} {title}
        </Text>
        {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>

      {loading ? (
        <View>
          {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it, idx) => String(it.id ?? idx)}
        renderItem={({ item }) => {
  // preferisci listing_id / listingId se arrivano dall'API, altrimenti fallback a id
  const targetId = item.listing_id || item.listingId || item.id;
  const safeNavigate = () => {
    if (isUUID(targetId)) {
      navigation.navigate("OfferDetail", { listingId: targetId, type: item.type || "hotel" });
    } else {
      Alert.alert(
        t("matching.errors.invalidIdTitle", "Anteprima non disponibile"),
        t(
          "matching.errors.invalidIdMsg",
          "Questo elemento è un esempio (ID non valido). Esegui un ricalcolo o apri un annuncio reale."
        )
      );
    }
  };
  return (
    <MatchRow
      item={item}
      isNew={newIds.has(item.id)}
      onPress={safeNavigate}
    />
  );
}}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          scrollEnabled={false}
          ListEmptyComponent={
            <Text style={{ color: "#6B7280", paddingHorizontal: 4 }}>
              {t("matching.list.empty", "Nessun risultato.")}
            </Text>
          }
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* Banner stato ricalcolo (non invasivo) */}
      <StatusBanner state={status} t={t} />

      <FlatList
        data={[{ key: "content" }]}
        keyExtractor={(i) => i.key}
        renderItem={() => (
          <View style={{ padding: 16, paddingBottom: (tabBarHeight || 0) + (insets.bottom || 0) + 96 }}>
            {/* Header con toggle legenda */}
            <View style={styles.legendHeaderRow}>
              <Text style={styles.legendHeaderTitle}>{t("matching.title", "AI Matching")}</Text>
              <TouchableOpacity
                onPress={() => setShowLegend((v) => !v)}
                style={styles.legendToggle}
                accessibilityRole="button"
                accessibilityLabel={
                  showLegend
                    ? t("matching.legend.hideA11y", "Nascondi spiegazione punteggi")
                    : t("matching.legend.showA11y", "Mostra spiegazione punteggi")
                }
              >
                <Ionicons name={showLegend ? "chevron-up" : "information-circle-outline"} size={18} color="#111827" />
                <Text style={styles.legendToggleText}>
                  {showLegend
                    ? t("matching.legend.hide", "Nascondi spiegazione")
                    : t("matching.legend.show", "Mostra spiegazione")}
                </Text>
              </TouchableOpacity>
            </View>

            {showLegend && <LegendCard t={t} />}

            <View style={{ height: 12 }} />
            <Section
              title={t("matching.sections.perfectTitle", "Match perfetti")}
              icon="🍀"
              subtitle={t(
                "matching.sections.perfectSubtitle",
                "Incroci bidirezionali: piaci a loro e loro piacciono a te. 80+ = affinità altissima."
              )}
              items={perfect}
            />

            <View style={{ height: 12 }} />
            <Section
              title={t("matching.sections.compatibleTitle", "Match compatibili")}
              icon="🤝"
              subtitle={t(
                "matching.sections.compatibleSubtitle",
                "I numeri (60/70/80) sono la percentuale stimata di compatibilità: 60=base, 70=buona, 80+=eccellente."
              )}
              items={compatible}
            />
          </View>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* FAB rotondo ⚡ — in basso a destra */}
      <TouchableOpacity
        onPress={onRecompute}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel={t("matching.fab.recompute", "Ricalcola AI")}
        style={[
          styles.fab,
          { bottom: (tabBarHeight || 0) + (insets.bottom || 0) + 18 },
        ]}
      >
        {recomputing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name="flash" size={26} color="#fff" />
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

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

  /* Badge "Nuovo" */
  newPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: "#111827",
    borderRadius: 999,
  },
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

  /* Legend */
  legendCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
  },
  legendTitle: { fontSize: 14, fontWeight: "800", color: "#111827", marginBottom: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  legendDot: { width: 16, height: 16, borderRadius: 8, marginRight: 8, borderWidth: 1 },
  legendText: { color: "#374151" },

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
