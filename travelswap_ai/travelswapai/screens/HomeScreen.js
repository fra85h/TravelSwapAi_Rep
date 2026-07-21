// screens/HomeScreen.js — Annunci pubblici (senza tab "Voli")
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, Alert, RefreshControl, ActivityIndicator } from "react-native";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { listPublicListings, listMyListings, getCurrentUser } from "../lib/db";
import { getUserSnapshot } from "../lib/backendApi";
import { getMyPrefs } from "../lib/preferences";
import { subscribeDataChanged } from "../lib/ActivityContext";
import OfferCTAs from "../components/OfferCTA";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import TrustScoreBadge from "../components/TrustScoreBadge";
import SaveButton from "../components/SaveButton";
import { Ionicons } from "@expo/vector-icons";
import { stripPriceFromTitle } from "../lib/listingTitle";
import { formatMoney } from "../lib/number";

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={[styles.skel, { width: "60%", height: 16, borderRadius: 6 }]} />
      <View style={{ height: 8 }} />
      <View style={[styles.skel, { width: "40%", height: 12, borderRadius: 6 }]} />
      <View style={{ height: 12 }} />
      <View style={[styles.skel, { width: "100%", height: 40, borderRadius: 10 }]} />
    </View>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Normalizza per la ricerca: minuscolo, senza accenti, apostrofi come spazio
// (es. "L'Aquila" -> "l aquila", "Città" -> "citta"), come normPlace in
// heuristics.js/score.js/chainMatch.js — senza questo, cercare "citta" non
// trovava "Città di Castello" e "laquila" non trovava "L'Aquila".
function normSearch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’‘`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stessa soglia "migliori per te" di MatchingScreen (isPerfect): reciproco
// >=80%, non reciproco >=90%. Senza questa soglia il widget "Per te" pescava
// semplicemente i primi 6 disponibili qualunque fosse lo score, mostrando
// anche match deboli (es. 8%) sotto un'etichetta che promette personalizzazione
// — mentre la lista completa "I migliori per te" li scarta correttamente in
// "Altri in linea con te". Le due sezioni devono restare coerenti.
function isTopPick(p) {
  return (p.bidirectional === true && p.score >= 80) || (p.bidirectional === false && p.score >= 90);
}

// Data breve per la card ("24 lug"), senza dover aprire il dettaglio.
function formatShortDate(iso, locale) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale || undefined, { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

// Estrae i migliori suggerimenti AI dallo snapshot backend, in modo
// tollerante alla forma della risposta (come fa MatchingScreen). Best
// effort: se manca o è malformato, la striscia "Per te" resta nascosta.
function extractPicks(snap) {
  const items = Array.isArray(snap) ? snap : (snap?.items || snap?.rows || snap?.data || []);
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => {
      const listingId = raw.listingId ?? raw.listing_id ?? raw.toId ?? raw.to_id ?? raw.id;
      const b = raw.bidirectional ?? raw.is_bidirectional ?? raw.match_type;
      const bidirectional = typeof b === "string"
        ? ["true", "t", "1", "bidirectional"].includes(b.toLowerCase())
        : typeof b === "number" ? b === 1 : !!b;
      return {
        listingId,
        title: raw.title ?? raw.name ?? "—",
        location: raw.location ?? raw.city ?? raw.destination ?? "",
        type: raw.type ?? raw.listing_type ?? "",
        score: Number(raw.score ?? raw.score_pct ?? 0) || 0,
        bidirectional,
      };
    })
    .filter((p) => typeof p.listingId === "string" && UUID_RE.test(p.listingId))
    .filter(isTopPick)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// Mappa listingId -> punteggio AI più alto trovato nello snapshot, SENZA il
// filtro isTopPick/slice(6) di extractPicks: qui serve per riordinare l'intero
// catalogo ("Altri annunci"), non solo la striscia dei migliori 6. Priorità
// del prodotto: è l'app a portare in cima l'annuncio giusto, la ricerca
// manuale resta solo un complemento (vedi tab/searchInput più sotto).
function buildScoreMap(snap) {
  const items = Array.isArray(snap) ? snap : (snap?.items || snap?.rows || snap?.data || []);
  const map = new Map();
  if (!Array.isArray(items)) return map;
  for (const raw of items) {
    const listingId = raw.listingId ?? raw.listing_id ?? raw.toId ?? raw.to_id ?? raw.id;
    if (typeof listingId !== "string" || !UUID_RE.test(listingId)) continue;
    const score = Number(raw.score ?? raw.score_pct ?? 0) || 0;
    const prev = map.get(listingId);
    if (prev === undefined || score > prev) map.set(listingId, score);
  }
  return map;
}

const PAGE_SIZE = 30;


export default function HomeScreen() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { t, locale } = useI18n();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("all"); // "all" | "hotel" | "train"
  const [me, setMe] = useState(null);
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState([]);
  // Punteggio AI per listingId, per l'intero catalogo (non solo i 6 top
  // pick): usato per riordinare "Altri annunci" mettendo in cima ciò che
  // l'AI ritiene più in linea con l'utente.
  const [scoreMap, setScoreMap] = useState(() => new Map());
  // true quando lo snapshot AI ha finito di caricare (successo o errore):
  // serve a non far lampeggiare l'empty state "Per te" durante il fetch.
  const [picksReady, setPicksReady] = useState(false);
  // Paginazione a cursore: prima Esplora caricava un campione fisso degli
  // ultimi 100 annunci senza alcun modo di vederne altri. hasMore=false
  // quando l'ultima pagina ricevuta è più corta di PAGE_SIZE.
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Conteggio dedicato (non derivato da items, che è solo un campione degli
  // ultimi 100 annunci di TUTTA la piattaforma): con abbastanza annunci
  // altrui, un proprio annuncio più vecchio poteva restare fuori dal
  // campione, facendo mostrare "Pubblica un annuncio" anche a chi ne aveva
  // già uno attivo.
  const [myActiveCount, setMyActiveCount] = useState(0);
  // Preferenze di profilo (tipo/località preferiti): usate SOLO per
  // preselezionare il tab e dare priorità in lista agli annunci nella zona
  // preferita — non entrano nel matching AI (vedi score.js: quello si basa
  // sul tuo annuncio pubblicato, un segnale più preciso e già presente).
  const [prefs, setPrefs] = useState(null);
  // Il tab preferito va applicato una sola volta (al primo caricamento
  // utile): altrimenti ogni refresh/focus schermata annullerebbe la scelta
  // manuale dell'utente riportandolo sempre al tab preferito.
  const appliedPrefsTabRef = useRef(false);

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
        listPublicListings({ limit: PAGE_SIZE, excludeMine: false }),
      ]);
      setMe(u);
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      setHasMore(rows.length === PAGE_SIZE);
      // Suggerimenti AI: best effort, non bloccano la lista se falliscono
      if (u?.id) {
        setPicksReady(false);
        getUserSnapshot(u.id)
          .then((snap) => { setPicks(extractPicks(snap)); setScoreMap(buildScoreMap(snap)); })
          .catch(() => { setPicks([]); setScoreMap(new Map()); })
          .finally(() => setPicksReady(true));
        listMyListings({ status: "active" })
          .then((mine) => setMyActiveCount(Array.isArray(mine) ? mine.length : 0))
          .catch(() => setMyActiveCount(0));
        getMyPrefs()
          .then((p) => {
            setPrefs(p || null);
            if (!appliedPrefsTabRef.current) {
              appliedPrefsTabRef.current = true;
              const types = Array.isArray(p?.types) ? p.types : [];
              if (types.length === 1 && (types[0] === "hotel" || types[0] === "train")) {
                setTab(types[0]);
              }
            }
          })
          .catch(() => setPrefs(null));
      } else {
        setMyActiveCount(0);
        setPicks([]);
        setScoreMap(new Map());
        setPicksReady(true);
        setPrefs(null);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Pagina successiva del catalogo, a cursore (created_at dell'ultimo
  // elemento già in lista): risolve il limite fisso di prima, che non aveva
  // alcun modo di andare oltre il campione iniziale.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    const last = items[items.length - 1];
    if (!last?.created_at) { setHasMore(false); return; }
    setLoadingMore(true);
    try {
      const more = await listPublicListings({ limit: PAGE_SIZE, excludeMine: false, before: last.created_at });
      setHasMore(more.length === PAGE_SIZE);
      if (more.length) setItems((prev) => [...prev, ...more]);
    } catch {
      // best effort: un errore di rete sul "carica altri" non deve rompere la lista già mostrata
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, hasMore, loading]);

  // Ricarica a ogni focus dello screen (non solo al mount): la bottom-tab
  // navigation lascia HomeScreen montato quando si passa ad altre tab, quindi
  // senza questo pausa/riattiva/elimina di un annuncio da Profilo non si
  // rifletteva mai su Esplora finché l'app non veniva riaperta da zero.
  useEffect(() => { if (isFocused) load(); }, [isFocused, load]);

  // Ricarica Esplora quando qualcosa cambia altrove (es. accettazione/rifiuto
  // di uno scambio in Attività): senza questo il feed restava stantio finché
  // non si faceva refresh manuale, anche se la tab era già aperta.
  useEffect(() => subscribeDataChanged(() => { load(); }), [load]);

  // Pull-to-refresh esplicito: usa un flag SEPARATO da `loading` (stesso
  // pattern di Profilo/Attività). `loading` guida solo lo skeleton del primo
  // caricamento — se pilotasse anche il pull-to-refresh, ogni ricarica
  // automatica (focus della tab, evento globale) farebbe lampeggiare lo
  // spinner in cima anche quando l'utente non ha tirato giù nulla.
  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

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
    const q = normSearch(query);
    const base = items.filter((x) => {
      if (tab !== "all" && String(x.type || "").toLowerCase() !== tab.toLowerCase()) return false;
      if (!q) return true;
      const hay = [x.title, x.location, x.route_from, x.route_to]
        .map(normSearch)
        .join(" ");
      return hay.includes(q);
    });

    // Località preferite salvate in profilo (una o più): gli annunci che le
    // citano salgono in cima (ordinamento soft, nessuno viene escluso).
    // Supporta il nuovo array locations[] con fallback al vecchio singolo.
    const prefLocs = (Array.isArray(prefs?.locations) ? prefs.locations : [prefs?.location])
      .map((s) => normSearch(s))
      .filter(Boolean);
    const matchesPrefLoc = prefLocs.length
      ? (x) => [x.location, x.route_from, x.route_to]
          .some((s) => { const n = normSearch(s); return n && prefLocs.some((p) => n.includes(p)); })
      : () => false;

    // Priorità del prodotto: è l'app a portare in cima l'annuncio giusto,
    // non l'utente a doverlo cercare. Chi ha un punteggio AI (dallo
    // snapshot "Per te") sale in cima ordinato per affinità decrescente;
    // tra gli annunci senza punteggio, la località preferita resta un
    // criterio soft secondario, poi l'ordine originale (created_at desc).
    return [...base].sort((a, b) => {
      const sa = scoreMap.has(a.id) ? scoreMap.get(a.id) : -1;
      const sb = scoreMap.has(b.id) ? scoreMap.get(b.id) : -1;
      if (sa !== sb) return sb - sa;
      return Number(matchesPrefLoc(b)) - Number(matchesPrefLoc(a));
    });
  }, [items, tab, query, prefs, scoreMap]);

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
            accessibilityState={{ selected: tab === tKey }}
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
    // Stesso criterio di ownership usato in OfferCTA/ListingDetail: senza un
    // segnale in Esplora, toccare il proprio annuncio e non vedere i bottoni
    // di acquisto/scambio sembrava un bug, non una conseguenza attesa.
    const isMine =
      me?.id && (item?.owner_id || item?.user_id || item?.created_by) &&
      String(me.id) === String(item.owner_id || item.user_id || item.created_by);
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

    // Date del viaggio/soggiorno, visibili in card senza dover aprire il
    // dettaglio: prima comparivano solo tratta+tipo, mai le date effettive.
    const dateLine = typeLc === "hotel"
      ? [formatShortDate(item.check_in, locale), formatShortDate(item.check_out, locale)].filter(Boolean).join(" → ")
      : formatShortDate(item.depart_at, locale);

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate("ListingDetail", { id: item.id })}
        activeOpacity={0.8}
        style={styles.card}
      >
        {/* Titolo con icona tipo (in alto a sx); "tuo annuncio" ridotto a
            pill accanto al salva (prima riga intera sotto il titolo) e
            tratta+prezzo sulla stessa riga per guadagnare spazio verticale. */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, marginRight: 8 }}>
            {typeLc === "train" ? (
              <Ionicons name="train-outline" size={18} color={theme.colors.boardingText} style={{ marginRight: 6 }} />
            ) : typeLc === "hotel" ? (
              <Ionicons name="bed-outline" size={18} color={theme.colors.boardingText} style={{ marginRight: 6 }} />
            ) : null}
            <Text style={styles.cardTitle} numberOfLines={1}>
              {stripPriceFromTitle(item.title) || tt("listing.untitled", "Senza titolo")}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isMine ? (
              <View style={styles.mineBadge}>
                <Text style={styles.mineBadgeText} numberOfLines={1}>{tt("listing.yourListingBadge", "È un tuo annuncio")}</Text>
              </View>
            ) : null}
            <SaveButton listingId={item.id} size={22} />
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[styles.cardSub, { flex: 1, flexShrink: 1, marginRight: 8 }]} numberOfLines={1}>
            {typeLabel} • {item.location || item.route_from || "-"}
          </Text>
          {item.price != null ? (
            <Text style={styles.cardMeta} numberOfLines={1}>
              {formatMoney(item.price, item.currency)}
            </Text>
          ) : null}
        </View>

        {dateLine ? <Text style={styles.cardDates}>{dateLine}</Text> : null}

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
    // Utente sloggato: la sezione personalizzata non ha senso.
    if (!me?.id) return null;
    // Snapshot AI ancora in caricamento: non mostrare nulla (niente flicker).
    if (!picksReady) return null;

    const hasPicks = picks.length > 0;
    // Se l'utente non ha annunci attivi, il motivo dell'assenza di
    // suggerimenti è che non ha ancora pubblicato: l'empty state lo guida.
    // myActiveCount è nello stato del componente (vedi load()): non va
    // derivato da items, che è solo un campione degli ultimi 100 annunci
    // di tutta la piattaforma, non tutti i propri.

    return (
      <View style={styles.perTeWrap}>
        <View style={styles.perTeHead}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="sparkles" size={15} color={theme.colors.accent} />
            <Text style={styles.perTeTitle}>{tt("esplora.forYouTitle", "Per te")}</Text>
            {/* Tag "AI" rimosso: ridondante con le scintille ✨ (che restano il
                segnale AI) e con la ⓘ; toglierlo alleggerisce e riduce l'oro. */}
            {/* Una sola ⓘ per l'intera sezione: spiega cosa sono i suggerimenti
                e cosa indica la percentuale di affinità, senza affollare le card. */}
            <TouchableOpacity
              onPress={() => Alert.alert(
                tt("esplora.forYouInfoTitle", "Suggeriti per te"),
                tt("esplora.forYouInfoMsg", "Annunci scelti dall'AI in base a ciò che cerchi e pubblichi. La percentuale di affinità indica quanto un annuncio è in linea con te: più è alta, meglio è.")
              )}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={tt("esplora.forYouInfoTitle", "Suggeriti per te")}
            >
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>
          {hasPicks ? (
            <TouchableOpacity onPress={() => navigation.navigate("Matching")}>
              <Text style={styles.seeAll}>{tt("esplora.seeAll", "Vedi tutti")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {!hasPicks ? (
          // Empty state compatto e azionabile: la sezione resta visibile
          // (scoperta + coerenza di layout) ma con una riga utile, non un
          // cartello morto. Due messaggi a seconda del perché è vuota.
          <View style={styles.perTeEmpty}>
            <Text style={styles.perTeEmptyText}>
              {myActiveCount === 0
                ? tt("esplora.forYouEmptyNoListings", "Pubblica un annuncio e l'AI inizierà a suggerirti gli scambi più in linea con te.")
                : tt("esplora.forYouEmptyNoMatches", "Nessun suggerimento per ora: stiamo cercando gli abbinamenti migliori per i tuoi annunci. Ricontrolla tra poco.")}
            </Text>
            {myActiveCount === 0 ? (
              <TouchableOpacity
                style={styles.perTeEmptyCta}
                onPress={() => navigation.navigate("CreateListing")}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={16} color={theme.colors.accentOn} />
                <Text style={styles.perTeEmptyCtaText}>{tt("esplora.forYouEmptyCta", "Crea annuncio")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
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
                {/* Numero etichettato: "Affinità NN%" invece del numero muto,
                    così si capisce senza spiegazioni cosa rappresenta. */}
                <View style={styles.affinityPill}>
                  <Ionicons name={isTrain ? "train-outline" : "bed-outline"} size={13} color={theme.colors.accentOn} />
                  <Text style={styles.affinityText}>{tt("esplora.matchPct", "Match {n}%", { n: Math.round(p.score) })}</Text>
                </View>
                <Text style={styles.pickTitle} numberOfLines={2}>{stripPriceFromTitle(p.title) || tt("listing.untitled", "Senza titolo")}</Text>
                {p.location ? <Text style={styles.pickSub} numberOfLines={1}>{p.location}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        )}

        {/* Divisore verso il catalogo completo: la sezione "Per te" è sempre
            presente per un utente loggato (con suggerimenti o empty state). */}
        <Text style={styles.otherListingsHead}>{tt("esplora.otherListings", "Altri annunci")}</Text>
      </View>
    );
  };

  // Skeleton solo al PRIMO caricamento: `load()` viene richiamato a ogni
  // focus della tab e a ogni evento globale (es. accetti un'offerta in
  // Attività) — se lo spinner sostituisse l'intera pagina anche in quei
  // casi, ricerca e filtri sparirebbero per un lampo ogni volta che si
  // torna su Esplora. A ricariche successive la UI resta visibile; il pull
  // to refresh esplicito ha il proprio indicatore (refreshing, sopra).
  const showSkeletons = loading && items.length === 0;

  // Un errore su una ricarica in background (tab focus, evento globale) non
  // deve cancellare contenuti già mostrati — solo il fallimento del primo
  // caricamento, quando non c'è nulla da mostrare, occupa tutto lo schermo.
  if (error && items.length === 0) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>{tt("common.retry", "Riprova")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const EmptyState = showSkeletons ? (
    <View>
      {[...Array(4)].map((_, i) => <View key={i} style={{ marginBottom: 10 }}><SkeletonCard /></View>)}
    </View>
  ) : (
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
      {query.trim() ? (
        <TouchableOpacity
          style={styles.pillBtn}
          onPress={() => navigation.navigate("SavedSearches")}
          activeOpacity={0.85}
        >
          <Text style={styles.pillBtnText}>{tt("esplora.createAlertCta", "Crea avviso")}</Text>
        </TouchableOpacity>
      ) : tab !== "all" ? (
        <TouchableOpacity style={styles.pillBtn} onPress={() => setTab("all")} activeOpacity={0.85}>
          <Text style={styles.pillBtnText}>{tt("listing.showAll", "Mostra tutti")}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

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
          <TouchableOpacity
            onPress={() => setQuery("")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={tt("esplora.clearSearchA11y", "Cancella ricerca")}
          >
            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {renderTabs()}

      <FlatList
        data={showSkeletons ? [] : filtered}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        ListHeaderComponent={query || showSkeletons ? null : renderPerTe}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={EmptyState}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator style={{ marginVertical: 16 }} color={theme.colors.textMuted} />
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
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
  // Pill piccola accanto al salva (prima riga intera sotto il titolo):
  // guadagna una riga di spazio verticale nella card.
  mineBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft,
    maxWidth: 90,
  },
  mineBadgeText: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: "700",
  },
  cardSub: { color: theme.colors.textMuted, marginTop: 4 },
  cardMeta: { color: theme.colors.text, fontWeight: "600" },
  cardDates: { color: theme.colors.textMuted, marginTop: 4, fontSize: 12, fontWeight: "600" },
  cardPublished: { color: theme.colors.textMuted, marginTop: 8, fontSize: 12 },
  errorBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: theme.colors.background },
  error: { color: theme.colors.danger, marginBottom: 8, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontWeight: "600", color: theme.colors.text },
  emptyWrap: { paddingVertical: 32, alignItems: "center", paddingHorizontal: 16 },
  emptyText: { color: theme.colors.textMuted, textAlign: "center", fontWeight: "700" },
  emptySub: { color: theme.colors.textMuted, textAlign: "center", marginTop: 6 },
  pillBtn: { marginTop: 14, backgroundColor: theme.colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  pillBtnText: { color: theme.colors.boardingText, fontWeight: "800" },

  skel: { backgroundColor: theme.colors.border },

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
  // Empty state "Per te": card slim tono-su-tono oro, non un blocco pieno.
  perTeEmpty: {
    backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: theme.colors.accent,
    borderRadius: theme.radius.lg, padding: 14, gap: 10, alignItems: "flex-start",
  },
  perTeEmptyText: { color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  perTeEmptyCta: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    backgroundColor: theme.colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  perTeEmptyCtaText: { color: theme.colors.accentOn, fontWeight: "800", fontSize: 13 },
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
  // Pillola Match "tenue" (sfondo oro chiaro + bordo + testo navy), stesso
  // peso della pillola verde Affidabilità: due badge-punteggio coerenti,
  // invece del blocco d'oro pieno che appesantiva la sezione "Per te".
  affinityPill: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: theme.colors.accent,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  affinityText: { fontSize: 11, fontWeight: "800", color: theme.colors.boardingText },
  pickTitle: { marginTop: 8, fontWeight: "800", color: theme.colors.boardingText, minHeight: 36 },
  pickSub: { marginTop: 4, color: theme.colors.textMuted, fontSize: 12 },
  otherListingsHead: { marginTop: 16, marginBottom: 2, fontSize: 15, fontWeight: "800", color: theme.colors.text },
});
