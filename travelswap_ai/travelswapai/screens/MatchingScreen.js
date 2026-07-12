// screens/MatchingScreen.js — layout classico + snapshot backend reale
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { theme } from "../lib/theme";
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
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useI18n } from "../lib/i18n";
import { recomputeAIAndSnapshot } from "../lib/backendApi";

// Backend reale
import { getCurrentUser } from "../lib/db";
import { getUserSnapshot, recomputeUserSnapshot } from "../lib/backendApi";

/* ---------- UI di supporto ---------- */
function EmptyState({ onRecompute, isLoading, hasError }) {
  const { t } = useI18n();
  return (
    <View style={{ alignItems: "center", padding: 24 }}>
      <Ionicons
        name={hasError ? "cloud-offline-outline" : "bulb-outline"}
        size={28}
        color={theme.colors.boardingText}
      />
      <Text style={{ marginTop: 10, fontWeight: "800" , color:theme.colors.boardingText}}>
        {hasError
          ? t("matchingScreen.backendUnreachable", "Backend non raggiungibile")
          : t("matchingScreen.noMatchesComputed", "Nessun match calcolato")}
      </Text>
    { /* {!hasError && (
        <TouchableOpacity
          onPress={onRecompute}
          disabled={isLoading}
          style={{ marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.colors.boardingText, borderRadius: 999 }}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "800" }}>Ricalcola AI</Text>
          )}
        </TouchableOpacity>
      )}*/}
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

/*function LegendCard({ t }) {
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
}*/

function LegendCard({ t }) {
  return (
    <View style={styles.legendCard}>
      <Text style={styles.legendTitle}>
        {t("matching.legend.title", "Come funziona")}
      </Text>
      <Text style={styles.legendText}>
        {t("matching.scoreHint", "Più il numero è alto, più l'annuncio è vicino a ciò che cerchi.")}
      </Text>
      <View style={styles.legendAiRow}>
        <Ionicons name="sparkles-outline" size={15} color={theme.colors.accent} />
        <Text style={[styles.legendText, { flex: 1 }]}>
          {t("matching.poweredBy", "Suggerimenti generati dalla nostra AI in base a ciò che cerchi e pubblichi.")}
        </Text>
      </View>
    </View>
  );
}

function StatusBanner({
  state, t,
  perfectCount = 0,
  compatibleCount = 0,
  showPerfectOnly = false,
  sortByNewness = false,
  onShowPerfectOnly = () => {},
  onSortByNewness = () => {},
}) {
  if (state === "idle") return null;

  const base = {
    queued: { text: t("matching.status.queued", "Ricalcolo AI in coda…"), bg:"#FFF7ED", border:"#FED7AA", color:"#9A3412", icon:"time-outline" },
    running:{ text: t("matching.status.running","Ricalcolo AI in corso…"), bg:"#EEF2FF", border:"#C7D2FE", color:"#1E3A8A", icon:"sparkles-outline" },
    error:  { text: t("matching.status.error", "Backend offline o non raggiungibile"), bg:"#FEF2F2", border:"#FECACA", color:"#991B1B", icon:"alert-circle-outline" },
  };

  // modalità “done”: messaggio con conteggi + CTA
  if (state === "done") {
    return (
      <View style={[styles.banner, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }]}>
        <Ionicons name="checkmark-circle-outline" size={16} color="#065F46" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerText, { color: "#065F46" }]}>
            {t("matching.status.summary", "✨ {perfect} migliori, {compatible} in linea con te. ", { perfect: perfectCount, compatible: compatibleCount })}
            {t("matching.status.tip", "Suggerimento: invia una proposta ai migliori.")}
          </Text>

          {/* CTA inline */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <TouchableOpacity
              onPress={onShowPerfectOnly}
              style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, borderWidth:1, borderColor:"#A7F3D0", backgroundColor:"#D1FAE5" }}
            >
              <Text style={{ fontWeight:"700", color:"#065F46" }}>
                {showPerfectOnly ? t("matching.cta.showAll","Vedi tutti") : t("matching.cta.perfectOnly","Vedi solo perfetti")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onSortByNewness}
              style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, borderWidth:1, borderColor:"#A7F3D0", backgroundColor:"#D1FAE5" }}
            >
              <Text style={{ fontWeight:"700", color:"#065F46" }}>
                {sortByNewness ? t("matching.cta.sortScore","Ordina per punteggio") : t("matching.cta.sortNew","Ordina per novità")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const s = base[state] || base.queued;
  return (
    <View style={[styles.banner, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Ionicons name={s.icon} size={16} color={s.color} />
      <Text style={[styles.bannerText, { color: s.color }]}>{s.text}</Text>
    </View>
  );
}

/* ---------- Riga Match ---------- */

function MatchRow({ item, onPress, isNew, expanded, onToggleInfo, generatedAt, onPressChevron ,onProposeBuy, onProposeSwap }) {
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
  const model = item.model ?? null;
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
          {/*     {model ? <Text style={styles.explSmall}>model: {model}</Text> : <View />}*/}
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
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.boardingText}/>
          <Text style={styles.infoChipTxt}>{expanded ? t("matching.hide","Nascondi") : t("matching.info","Info")}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onPressChevron} style={{ paddingTop: 6 }}>
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
  // Ora è una schermata Stack (aperta da "Vedi tutti"), non un tab:
  // niente barra dei tab sotto, quindi nessuna altezza da compensare.
  const tabBarHeight = 0;
  const { t, lang } = useI18n();
const [showPerfectOnly, setShowPerfectOnly] = useState(false);
const [sortByNewness, setSortByNewness] = useState(false);
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
  // dentro MatchingScreen, subito dopo const navigation = useNavigation();
const onOpenDetails = useCallback((it) => {
  if (!it) return;

  // prendo ciò che serve all’altro screen
  const listingId  = it.listingId || it.id || null;
  const proposalId = it.id || null;
  const type       = it.type || "hotel";

  // Passo sia gli ID che l’oggetto completo come fallback
  navigation.navigate("OfferDetail", {
    listingId,
    proposalId,
    type,
    proposal: it,           // <— oggetto completo per evitare “non trovato”
  });
}, [navigation]);

 const sortRows = useCallback((arr) => {
  const list = Array.isArray(arr) ? [...arr] : [];
  if (sortByNewness) {
    // priorità: nuovi > updatedAt recente > score
    return list.sort((a, b) => {
      const aNew = newIds.has(a.id) ? 1 : 0;
      const bNew = newIds.has(b.id) ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (at !== bt) return bt - at;
      return (b.score - a.score);
    });
  }
  // default: per punteggio
  return list.sort((a, b) => (b.score - a.score));
}, [sortByNewness, newIds]);
   const onPressRicalcolaAI = async () => {
  const u = userRef.current;
  if (!u?.id || recomputing) return;

  try {
    setRecomputing(true);
    setStatus("queued");
    toast(t("matching.toasts.queued", "Ricalcolo AI in coda…"));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await new Promise((r) => setTimeout(r, 300));
    setStatus("running");

    // chiamata backend (usa la tua firma corretta)
    const { snapshot } = await recomputeAIAndSnapshot(u.id, {
      topPerListing: 3,
      maxTotal: 50,
    });

    console.log("[FAB] recomputeAIAndSnapshot OK:", snapshot); // ✅

    const { items, generatedAt } = coerceSnapshot(snapshot);
    setRows(normalize(items, generatedAt));
    setStatus("done"); // ✅ ora il banner "smart" appare

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    console.error("[FAB] recompute error:", e);
    setStatus("error");
    Alert.alert(t("common.error", "Errore"), e?.message || String(e));
  } finally {
    setRecomputing(false);
  }
};

 
  
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
        ToastAndroid.show(String(e?.message || t("matchingScreen.backendErrorTitle", "Errore backend")), ToastAndroid.SHORT);
      } else {
        Alert.alert(t("matchingScreen.backendErrorTitle", "Errore backend"), String(e?.message || t("matchingScreen.backendErrorMsg", "Impossibile contattare il server")));
      }
    } finally {
      setRecomputing(false);
    }
  };

  //const perfect = useMemo(() => rows.filter((m) => m.bidirectional === true && m.score >= 80), [rows]);
  //const compatible = useMemo(() => rows.filter((m) => !m.bidirectional), [rows]);

const isPerfect = (m) =>
  (m.bidirectional === true && m.score >= 80) ||
  (m.bidirectional === false && m.score >= 90);

const perfect = useMemo(
  () => sortRows(rows.filter(isPerfect)),
  [rows, sortRows]
);

const compatible = useMemo(
  () => sortRows(rows.filter((m) => !isPerfect(m))),
  [rows, sortRows]
);
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
                onPressChevron={() =>
   navigation.navigate("OfferDetail", {
     proposalId: item.id,        // id della proposta/match selezionata
     showOnlyThisProposal: true, // flag esplicito
     // (opzionale) tieni anche questi, se lo screen li usa per header ecc.
     listingId: item.listingId || item.id || null,
     type: item.type || "hotel",
   })
    }
                onProposeBuy={(it) => handleProposeBuy(it)}
                onProposeSwap={(it) => handleProposeSwap(it)}
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
 const handleProposeBuy = useCallback((it) => {
   const targetId = it.listingId || it.id;
   if (!targetId) return;
   // Adatta alla tua rotta/sheet esistente:
   // Esempio 1: navigazione a una screen di proposta
   navigation.navigate("Proposal", { mode: "buy", listingId: targetId });
   // Esempio 2 (se hai già uno sheet): openNegotiationSheet({ type: "buy", toListingId: targetId })
 }, [navigation]);

 const handleProposeSwap = useCallback((it) => {
   const targetId = it.listingId || it.id;
   if (!targetId) return;
   navigation.navigate("Proposal", { mode: "swap", listingId: targetId });
 }, [navigation]);
  return (
    <SafeAreaView style={{ flex: 1 }}>
    <StatusBanner
  state={status}
  t={t}
  perfectCount={perfect.length}
  compatibleCount={compatible.length}
  showPerfectOnly={showPerfectOnly}
  sortByNewness={sortByNewness}
  onShowPerfectOnly={() => setShowPerfectOnly(v => !v)}
  onSortByNewness={() => setSortByNewness(v => !v)}
   />

      <FlatList
        data={[{ key: "content" }]}
        keyExtractor={(i) => i.key}
        renderItem={() => (
          <View style={{ padding: 16, paddingBottom: (tabBarHeight || 0) + (insets.bottom || 0) + 96 }}>
                        <View style={styles.legendHeaderRow}>
              <View style={{ flexShrink: 1, paddingRight: 10 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.legendHeaderTitle}>{t("matching.title", "Suggeriti dall'AI")}</Text>
                  <View style={styles.aiTag}>
                    <Ionicons name="sparkles" size={11} color={theme.colors.accentOn} />
                    <Text style={styles.aiTagText}>{t("matching.aiTag", "AI")}</Text>
                  </View>
                </View>
                <Text style={styles.poweredBy}>
                  {t("matching.poweredBy", "Suggerimenti generati dalla nostra AI in base a ciò che cerchi e pubblichi.")}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowLegend((v) => !v)}
                style={styles.legendToggle}
                accessibilityRole="button"
                accessibilityLabel={
                  showLegend
                    ? t("matching.legend.hideA11y", "Nascondi come funzionano i suggerimenti")
                    : t("matching.legend.showA11y", "Mostra come funzionano i suggerimenti")
                }
              >
                <Ionicons
                  name={showLegend ? "chevron-up" : "information-circle-outline"}
                  size={18}
                  color={theme.colors.boardingText}
                />
                <Text style={styles.legendToggleText}>
                  {showLegend
                    ? t("matching.legend.hide", "Nascondi")
                    : t("matching.legend.show", "Come funziona")}
                </Text>
              </TouchableOpacity>
            </View>

            {showLegend && <LegendCard t={t} />}

            <View style={{ height: 12 }} />
           <Section
  title={t("matching.sections.perfectTitle", "I migliori per te")}
  icon="✨"
  subtitle={t(
   "matching.sections.perfectSubtitle",
   "Scambi che funzionano in entrambi i sensi: interessano a te e a chi li ha pubblicati."
)}
  items={perfect}
  generatedAt={rows?.[0]?.updatedAt || null}
     />

{!showPerfectOnly && (
  <>
    <View style={{ height: 12 }} />
    <Section
      title={t("matching.sections.compatibleTitle", "Altri in linea con te")}
      icon="🤝"
      subtitle={t("matching.sections.compatibleSubtitle","Annunci vicini a ciò che cerchi. Più alto è il numero, più sono in linea.")}
      items={compatible}
      generatedAt={rows?.[0]?.updatedAt || null}
    />
  </>
)}
        
</View>                 
)}                     
refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
/>                    

      {/* Pulsante "Aggiorna suggerimenti" con etichetta esplicita */}
      <TouchableOpacity
        onPress={onPressRicalcolaAI}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel={t("matching.refresh", "Aggiorna suggerimenti")}
        style={[styles.fab, { bottom: (tabBarHeight || 0) + (insets.bottom || 0) + 18 }]}
      >
        {recomputing ? (
          <ActivityIndicator color={theme.colors.accentOn} />
        ) : (
          <>
            <Ionicons name="sparkles" size={18} color={theme.colors.accentOn} />
            <Text style={styles.fabText}>{t("matching.refresh", "Aggiorna suggerimenti")}</Text>
          </>
        )}
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
  legendHeaderTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.boardingText },
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
  legendToggleText: { fontWeight: "700", color: theme.colors.boardingText },

  /* Sezioni */
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    ...theme.shadow.sm,
  },
  sectionHeader: { marginBottom: 8 },
  sectionTitle: { fontFamily: theme.fonts.headingBold, fontSize: 16, color: theme.colors.boardingText },
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
  title: { fontWeight: "800", color: theme.colors.boardingText, marginRight: 8 },
  meta: { color: "#6B7280", marginTop: 2 },

  /* colonna destra */
  rightCol: { alignItems: "flex-end", justifyContent: "center", gap: 8 },

  /* Badge "Nuovo" */
  newPill: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: theme.colors.boardingText, borderRadius: 999 },
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
  infoChipTxt: { color: theme.colors.boardingText, fontWeight: "700", fontSize: 12 },

  /* Spiegazione */
  explBox: { marginTop: 8, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10 },
  explText: { color: "#374151", lineHeight: 18 },
  explFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  explSmall: { fontSize: 12, color: "#6B7280" },

  /* Skeleton */
  skel: { backgroundColor: "#E5E7EB" },

  /* Pulsante "Aggiorna suggerimenti" (pill con etichetta) */
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: theme.colors.accent, shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 8 },
    }),
  },
  fabText: { color: theme.colors.accentOn, fontWeight: "800", fontSize: 14 },

  /* Card "Come funziona" + tag AI */
  legendCard: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 8,
  },
  legendTitle: { fontWeight: "800", color: theme.colors.text, fontSize: 15 },
  legendText: { color: theme.colors.textMuted, lineHeight: 19 },
  legendAiRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  aiTag: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1, borderColor: theme.colors.accent,
    borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2,
  },
  aiTagText: { fontSize: 10, fontWeight: "800", color: theme.colors.accentOn, letterSpacing: 0.4 },
  poweredBy: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 },
});
