// screens/ListingDetailScreen.js
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, StyleSheet, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRoute, useNavigation } from "@react-navigation/native";
import { getListingMatches, recomputeForListing } from "../lib/backendApi";
import MatchCard from "../components/MatchCard";
import { getListingById, getPublicProfile } from "../lib/db.js";
import { theme } from "../lib/theme";
import TrustScoreBadge from "../components/TrustScoreBadge";
import OfferCTAs from "../components/OfferCTA";
import SaveButton from "../components/SaveButton";
import ImageCarousel from "../components/ImageCarousel";
import ActionSheet from "../components/ui/ActionSheet";
import { submitReport } from "../lib/reports";
import { getCurrentUser } from "../lib/db.js";
import { listImages } from "../lib/listingImages";
import { useI18n } from "../lib/i18n";
import { useListingTranslation } from "../lib/useListingTranslation";
import { usePriceCheck } from "../lib/usePriceCheck";
import { stripPriceFromTitle } from "../lib/listingTitle";
import { normStatusKey, isConcludedStatus } from "../lib/listingStatus";

/* ========= Utils ========= */

const pad2 = (n) => String(n).padStart(2, "0");

// Nomi brevi localizzati (costruiti a mano perché la data va letta in UTC,
// vedi sotto: toLocale* userebbe il fuso di chi guarda e sposterebbe l'ora).
const WD_SHORT = {
  it: ["dom", "lun", "mar", "mer", "gio", "ven", "sab"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
};
const MON_SHORT = {
  it: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
};

// Formato leggibile per chi consulta l'annuncio, es. "sab 18 lug 2026 · 07:31".
// Orari "da parete": partenza/arrivo indicano l'ora ALLA STAZIONE e vanno
// mostrati identici a come li ha inseriti chi pubblica, per qualunque fuso di
// chi guarda. Il valore è salvato naive (interpretato come UTC), quindi si
// legge in UTC — altrimenti in Italia comparivano +2 ore. Per le date "secche"
// (check-in/out) withTime=false: mostra solo giorno/mese/anno, senza orario.
function formatWallClock(input, locale = "it", withTime = true) {
  if (!input) return "—";
  const d = new Date(String(input));
  if (isNaN(d.getTime())) return String(input);
  const lang = ["it", "en", "es"].includes(locale) ? locale : "it";
  const wd = WD_SHORT[lang][d.getUTCDay()];
  const day = d.getUTCDate();
  const mon = MON_SHORT[lang][d.getUTCMonth()];
  const Y = d.getUTCFullYear();
  const datePart = `${wd} ${day} ${mon} ${Y}`;
  if (!withTime) return datePart;
  const h = pad2(d.getUTCHours());
  const m = pad2(d.getUTCMinutes());
  return `${datePart} · ${h}:${m}`;
}

function timeAgoLocalized(input, locale = "it") {
  if (!input) return null;
  const d = new Date(String(input));
  if (isNaN(d.getTime())) return null;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) {
    return locale === "en" ? "a few seconds ago"
         : locale === "es" ? "hace unos segundos"
         : "pochi secondi fa";
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return locale === "en" ? `${mins} min ago`
         : locale === "es" ? `hace ${mins} min`
         : `${mins} min fa`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return locale === "en" ? `${hrs} h ago`
         : locale === "es" ? `hace ${hrs} h`
         : `${hrs} h fa`;
  }
  const days = Math.floor(hrs / 24);
  return locale === "en" ? `${days} d ago`
       : locale === "es" ? `hace ${days} d`
       : `${days} gg fa`;
}

const safeStr = (v) => (v == null || v === "" ? "—" : String(v));
const fmtMoney = (v, c) => (v == null || isNaN(Number(v)) ? "—" : `${Number(v).toFixed(2)} ${c || "€"}`);


/* ========= Screen ========= */

export default function ListingDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const listingId = route.params?.listingId ?? route.params?.id;

  const { t, locale } = (typeof useI18n === "function" ? useI18n() : { t: (s)=>s, locale: "it" });
  const tt = (key, fallback, vars) => {
    try {
      const raw = t ? t(key) : undefined;
      const txt = (raw && raw !== key) ? raw : fallback;
      if (!vars) return txt;
      return Object.keys(vars).reduce((acc,k)=>acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k])), txt);
    } catch {
      if (!vars) return fallback;
      return Object.keys(vars).reduce((acc,k)=>acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k])), fallback);
    }
  };

  // Header localizzato (Back e titolo)
useEffect(() => {
   navigation?.setOptions?.({
     title: tt("stack.listingDetail", "Dettaglio annuncio"),
     // iOS: prova a forzare il titolo del back; se il navigator usa quello della schermata precedente,
     // questa riga potrebbe non avere effetto. In tal caso vedi headerLeft custom sotto.
     headerBackTitle: tt("common.back", "Indietro"),
     headerBackTitleVisible: true,
     // Stella preferiti in alto a destra
     headerRight: () => (
       listingId ? (
         <View style={{ paddingHorizontal: 12 }}>
           <SaveButton listingId={listingId} size={26} />
         </View>
       ) : null
     ),
     // Android (e fallback cross-platform): headerLeft custom con testo localizzato
     headerLeft: (props) => (
       <TouchableOpacity
         onPress={() => navigation.goBack()}
         style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}
         hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
         accessibilityRole="button"
         accessibilityLabel={tt("common.back", "Indietro")}
       >
         {props.canGoBack !== false && (props.backImage ? props.backImage({ tintColor: props.tintColor }) : null)}
         <Text style={{ marginLeft: 6, color: props.tintColor ?? theme.colors.boardingText, fontWeight: "600" }}>
           {tt("common.back", "Indietro")}
         </Text>
       </TouchableOpacity>
     ),
   });
 }, [navigation, t, locale]);

  const [listing, setListing] = useState(null);
  const [recomputing, setRecomputing] = useState(false);
  const [showPriceInfo, setShowPriceInfo] = useState(false);

  const { getTranslated, loading: translating } = useListingTranslation();
  const { checkPrice, loading: priceChecking } = usePriceCheck();
  const [translated, setTranslated] = useState({
    title: null, description: null, translated: false, originalLang: null, lang: null,
    titleTranslated: false, descriptionTranslated: false,
  });
  const [showOriginal, setShowOriginal] = useState(false);

  const [images, setImages] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [myId, setMyId] = useState(null);
  const [seller, setSeller] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    const l = await getListingById(listingId);
    setListing(l);
    try {
      const [imgs, me] = await Promise.all([
        listImages(listingId),
        getCurrentUser().catch(() => null),
      ]);
      setImages((imgs || []).map((i) => i.url).filter(Boolean));
      setIsOwner(!!me && !!l && me.id === l.user_id);
      setMyId(me?.id ?? null);
      // Profilo pubblico del venditore (best-effort, non blocca il dettaglio)
      if (l?.user_id) {
        getPublicProfile(l.user_id).then(setSeller).catch(() => setSeller(null));
      }
    } catch { /* non bloccare il dettaglio */ }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  const doReport = useCallback(async (reason) => {
    const res = await submitReport({
      listingId,
      reportedUserId: listing?.user_id || null,
      reason,
      listingTitle: listing?.title || null,
    });
    const thanksTitle = tt("listingDetail.reportThanksTitle", "Segnalazione inviata");
    if (res?.ok) {
      Alert.alert(thanksTitle, tt("listingDetail.reportThanksMsg", "Grazie: il nostro team la esaminerà."));
    } else if (res?.alreadyReported) {
      Alert.alert(thanksTitle, tt("listingDetail.reportAlready", "Hai già segnalato questo annuncio."));
    } else {
      Alert.alert(tt("listingDetail.report", "Segnala annuncio"), tt("listingDetail.reportError", "Impossibile inviare la segnalazione. Riprova."));
    }
  }, [listingId, listing]);

  // ricarica le foto quando si torna dalla schermata di gestione
  useEffect(() => {
    const unsub = navigation.addListener?.("focus", () => {
      listImages(listingId).then((imgs) =>
        setImages((imgs || []).map((i) => i.url).filter(Boolean))
      ).catch(() => {});
    });
    return unsub;
  }, [navigation, listingId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!listingId || !locale) return;
      const res = await getTranslated(listingId, locale);
      if (cancelled || !res) return;
      setTranslated({
        title: res.title ?? null,
        description: res.description ?? null,
        translated: !!res.translated,
        originalLang: res.originalLang ?? null,
        lang: res.lang ?? null,
        titleTranslated: !!res.titleTranslated,
        descriptionTranslated: !!res.descriptionTranslated,
      });
      setShowOriginal(false);
    })();
    return () => { cancelled = true; };
  }, [listingId, locale, getTranslated]);

  const textColor = theme?.colors?.boardingText || "#111827";

  const trustScore = useMemo(() => {
    // Supabase/PostgREST serializza le colonne numeric come stringa JSON
    // (es. "58.00"), non come numero — un controllo typeof==="number"
    // lasciava il badge sempre nascosto anche a valore correttamente salvato.
    const raw = listing?.trustscore ?? listing?.trust_score ?? null;
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [listing]);

  // meta
  const checkIn   = listing?.check_in   ?? listing?.checkIn   ?? null;
  const checkOut  = listing?.check_out  ?? listing?.checkOut  ?? null;
  const departAt  = listing?.depart_at  ?? listing?.departAt  ?? null;
  const arriveAt  = listing?.arrive_at  ?? listing?.arriveAt  ?? null;
  const createdAt = listing?.created_at ?? listing?.createdAt ?? null;
  const publishedAgo = timeAgoLocalized(createdAt, locale);
  // Un annuncio concluso (venduto/scambiato) non è più "nuovo" in senso utile:
  // prima il ribbon leggeva solo created_at<24h, quindi un annuncio venduto
  // pubblicato di recente mostrava comunque "Nuovo", e uno più vecchio non
  // mostrava alcuno stato — l'utente non capiva che la transazione era chiusa.
  const concludedStatusKey = isConcludedStatus(listing?.status) ? normStatusKey(listing?.status) : null;
  const isNewBadge = !concludedStatusKey && (() => {
    if (!createdAt) return false;
    const d = new Date(String(createdAt));
    if (isNaN(d.getTime())) return false;
    return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
  })();

  // myId viene da getCurrentUser() (vedi load()): è l'unica fonte affidabile.
  // route.params?.me?.id restava come fallback, ma nella pratica non è mai
  // passato da chi naviga qui (es. da Esplora) — usato da solo, meId era
  // quasi sempre null, quindi isMine sempre false anche sul proprio annuncio
  // (bottoni "Proponi acquisto/scambio", o "Ho questo biglietto" per un
  // CERCO, restavano visibili sul proprio annuncio invece di sparire).
  const meId = myId ?? route.params?.me?.id ?? null;

  const ownerId =
    listing?.owner_id ?? listing?.user_id ?? listing?.created_by ?? listing?.author_id ?? null;

  const isMine = meId && ownerId && String(meId) === String(ownerId);

  const gradColors = ["#ffffff", listing?.type === "hotel" ? "#f2f7ff" : listing?.type === "train" ? "#fff7f2" : "#f7fafc"];

  // cosa mostrare
  const titleOriginal = stripPriceFromTitle(safeStr(listing?.title));
  const descOriginal  = listing?.description || "";
  const titleShown = translated.translated && !showOriginal ? (translated.title || titleOriginal) : titleOriginal;
  const descShown  = translated.translated && !showOriginal ? (translated.description || descOriginal) : descOriginal;

  // "Membro da <mese anno>" localizzato dalla data di iscrizione del venditore
  const sellerSince = useMemo(() => {
    if (!seller?.created_at) return null;
    const d = new Date(seller.created_at);
    if (isNaN(d.getTime())) return null;
    const loc = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "it-IT";
    try { return d.toLocaleDateString(loc, { month: "long", year: "numeric" }); }
    catch { return d.toLocaleDateString(); }
  }, [seller, locale]);

  const sellerName = seller?.full_name || seller?.username || null;
  const sellerInitials = (sellerName || "?").trim().slice(0, 2).toUpperCase();
  const sellerSalesCount = Number(seller?.counters?.sold ?? 0) + Number(seller?.counters?.exchanged ?? 0);

  const L = {
    info: tt("listingDetail.info", "Informazioni"),
    seller: tt("listingDetail.seller", "Venditore"),
    sellerSince: (when) => tt("listingDetail.sellerSince", "Membro da {when}", { when }),
    sellerListingsCount: (n) => tt("listingDetail.sellerListingsCount", "{n} annunci pubblicati", { n }),
    sellerSalesCount: (n) => tt("listingDetail.sellerSalesCount", "{n} scambi completati", { n }),
    sellerViewProfile: tt("listingDetail.sellerViewProfile", "Vedi profilo"),
    report: tt("listingDetail.report", "Segnala annuncio"),
    reportTitle: tt("listingDetail.reportTitle", "Segnala questo annuncio"),
    reportMsg: tt("listingDetail.reportMsg", "Perché lo stai segnalando?"),
    reportReasonFake: tt("listingDetail.reportReasonFake", "Annuncio falso o ingannevole"),
    reportReasonScam: tt("listingDetail.reportReasonScam", "Sospetta truffa"),
    reportReasonInappropriate: tt("listingDetail.reportReasonInappropriate", "Contenuto inappropriato"),
    reportReasonDuplicate: tt("listingDetail.reportReasonDuplicate", "Doppione o spam"),
    reportReasonOther: tt("listingDetail.reportReasonOther", "Altro"),
    reportThanksTitle: tt("listingDetail.reportThanksTitle", "Segnalazione inviata"),
    reportThanksMsg: tt("listingDetail.reportThanksMsg", "Grazie: il nostro team la esaminerà."),
    reportAlready: tt("listingDetail.reportAlready", "Hai già segnalato questo annuncio."),
    reportError: tt("listingDetail.reportError", "Impossibile inviare la segnalazione. Riprova."),
    description: tt("listingDetail.description", "Descrizione"),
    publishedAgo: (ago) => tt("listingDetail.publishedAgo", "pubblicato {ago}", { ago }),
    toggleOriginal: tt("listingDetail.toggleOriginal", "Vedi originale"),
    toggleTranslated: tt("listingDetail.toggleTranslated", "Mostra tradotto"),
    translating: tt("listingDetail.translating", "Traduzione in corso…"),
    translatedAuto: (lang, orig) =>
      tt("listingDetail.translatedAuto", "Tradotto automaticamente{lang}{orig}", {
        lang: lang ? ` in ${lang}` : "",
        orig: orig ? ` (origine: ${orig})` : "",
      }),
    translatedPartial: tt("listingDetail.translatedPartial", "Titolo tradotto — descrizione non disponibile in questa lingua"),
    checkIn: tt("createListing.checkIn", "Check-in"),
    checkOut: tt("createListing.checkOut", "Check-out"),
    departAt: tt("createListing.departAt", "Partenza (data e ora)"),
    arriveAt: tt("createListing.arriveAt", "Arrivo (data e ora)"),
    tripLabel: tt("listingDetail.tripLabel", "Viaggio"),
    roundtrip: tt("listingDetail.roundtrip", "A/R"),
    oneway: tt("listingDetail.oneway", "Solo andata"),
    operator: tt("listingDetail.operator", "Operatore"),
    namedTicket: tt("listingDetail.namedTicket", "Nominativo"),
    yes: tt("common.yes", "Sì"),
    no: tt("common.no", "No"),
    aiPriceCta: tt("listingDetail.aiPriceCta", "Analisi prezzo con AI"),
    aiPriceInfoA11y: tt("listingDetail.aiPriceInfoA11y","Informazioni sull'analisi prezzo AI"),
    aiPriceInfo1: tt("listingDetail.aiPriceInfo1", "L’AI valuta la congruità del prezzo considerando:"),
    aiPriceInfoBullets: [
      tt("listingDetail.aiPriceInfoBullet1", "• data/ora del viaggio o del soggiorno (AM/PM)"),
      tt("listingDetail.aiPriceInfoBullet2", "• tratta e distanza / località"),
      tt("listingDetail.aiPriceInfoBullet3", "• operatore (Trenitalia, Italo, …) o struttura"),
      tt("listingDetail.aiPriceInfoBullet4", "• periodo/stagionalità ed eventi"),
      tt("listingDetail.aiPriceInfoBullet5", "• storico prezzi e vincoli del titolo"),
    ],
    toggleA11y: tt("listingDetail.toggleA11y","Mostra originale / Tradotto"),
    aiPriceVerdictLow: tt("listingDetail.aiPriceVerdictLow", "Prezzo conveniente"),
    aiPriceVerdictFair: tt("listingDetail.aiPriceVerdictFair", "Prezzo in linea"),
    aiPriceVerdictHigh: tt("listingDetail.aiPriceVerdictHigh", "Prezzo alto"),
    aiPriceUnavailable: tt("listingDetail.aiPriceUnavailable", "Analisi prezzo non disponibile al momento. Riprova più tardi."),
  };

  if (!listing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <ActivityIndicator />
      </View>
    );
  }

  const tripType  = listing?.trip_type ?? listing?.tripType ?? null;
  const operator  = listing?.operator  ?? listing?.carrier  ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={recomputing} onRefresh={() => setRecomputing(false)} />}>
        {images.length > 0 ? (
          <View style={{ marginHorizontal: -16, marginBottom: 12, borderRadius: 0, overflow: "hidden" }}>
            <ImageCarousel images={images} height={220} />
          </View>
        ) : null}
        {/* Venduto/scambiato: transazione conclusa, non più modificabile
            (stesso vincolo lato DB, vedi trigger before_update_listings_lock_terminal). */}
        {isOwner && !concludedStatusKey ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("CreateListing", { mode: "edit", listingId })}
            style={{ alignSelf: "flex-start", marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}
          >
            <Text style={{ fontWeight: "700", color: theme.colors.text }}>
              ✏️ {tt("listingDetail.editListing", "Modifica annuncio")}
            </Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.headerCard}>
          {concludedStatusKey ? (
            <View style={styles.ribbonWrap} pointerEvents="none">
              <View style={styles.ribbon}><Text style={styles.ribbonText}>{tt(`listing.state.${concludedStatusKey}`, concludedStatusKey)}</Text></View>
            </View>
          ) : isNewBadge ? (
            <View style={styles.ribbonWrap} pointerEvents="none">
              <View style={styles.ribbon}><Text style={styles.ribbonText}>{tt("matching.new","Nuovo")}</Text></View>
            </View>
          ) : null}

          <LinearGradient colors={gradColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headerGradient}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>{titleShown}</Text>
                <Text style={[styles.subtitle, { color: textColor }]}>
                  {safeStr(listing?.type)} • {safeStr(listing?.location || listing?.route_from)}
                  {publishedAgo ? <Text style={{ color: textColor }}>{`  •  ${L.publishedAgo(publishedAgo)}`}</Text> : null}
                </Text>
              </View>
              {/* (toggle spostato nella sezione descrizione) */}
            </View>

            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginTop: 12, marginBottom: 12 }} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexShrink: 1 }}>
                {typeof trustScore === "number" ? <TrustScoreBadge score={trustScore} /> : <View />}
              </View>
              <Text style={[styles.price, { color: textColor }]}>{fmtMoney(listing?.price, listing?.currency)}</Text>
            </View>
          </LinearGradient>
        </View>

        {/* Info principali */}
        <SectionCard title={L.info} textColor={textColor}>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {listing?.type === "hotel" ? (
              <>
                <Chip icon="📅" label={`${L.checkIn}: ${formatWallClock(checkIn, locale, false)}`} textColor={textColor} />
                <Chip icon="📅" label={`${L.checkOut}: ${formatWallClock(checkOut, locale, false)}`} textColor={textColor} />
              </>
            ) : null}

            {listing?.type === "train" ? (
              <>
                <Chip icon="🕒" label={`${L.departAt.split(" (")[0]}: ${formatWallClock(departAt, locale, true)}`} textColor={textColor} />
                <Chip icon="🕒" label={`${L.arriveAt.split(" (")[0]}: ${formatWallClock(arriveAt, locale, true)}`} textColor={textColor} />
                <Chip
                  icon="🎟"
                  label={`${L.tripLabel}: ${
                    tripType ? (/round|ar|a\/r/i.test(String(tripType)) ? L.roundtrip
                    : /one|solo/i.test(String(tripType)) ? L.oneway : String(tripType)) : "—"
                  }`}
                  textColor={textColor}
                />
                <Chip icon="🚄" label={`${L.operator}: ${operator || "—"}`} textColor={textColor} />
                {listing?.is_named_ticket != null ? (
                  <Chip icon="👤" label={`${L.namedTicket}: ${listing.is_named_ticket ? L.yes : L.no}`} textColor={textColor} />
                ) : null}
              </>
            ) : null}
          </View>
        </SectionCard>

        {/* Venditore (solo se non sono io il proprietario) */}
        {!isOwner && seller ? (
          <SectionCard title={L.seller} textColor={textColor}>
            <TouchableOpacity
              onPress={() => navigation.navigate("SellerProfile", { sellerId: seller.id })}
              activeOpacity={0.8}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              {seller.avatar_url ? (
                <Image source={{ uri: seller.avatar_url }} style={styles.sellerAvatar} />
              ) : (
                <View style={[styles.sellerAvatar, styles.sellerAvatarPlaceholder]}>
                  <Text style={styles.sellerInitials}>{sellerInitials}</Text>
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.sellerName, { color: textColor }]} numberOfLines={1}>
                  {sellerName || "—"}
                </Text>
                {sellerSince ? (
                  <Text style={styles.sellerMeta} numberOfLines={1}>{L.sellerSince(sellerSince)}</Text>
                ) : null}
                <Text style={styles.sellerMeta} numberOfLines={1}>
                  {L.sellerListingsCount(Number(seller?.counters?.active ?? 0))}
                  {sellerSalesCount > 0 ? `  •  ${L.sellerSalesCount(sellerSalesCount)}` : ""}
                </Text>
              </View>
              <Text style={styles.sellerLink}>{L.sellerViewProfile} ›</Text>
            </TouchableOpacity>
          </SectionCard>
        ) : null}

        {/* Immagine */}
        {listing?.imageUrl ? (
          <SectionCard textColor={textColor}>
            <View style={styles.imageWrap}>
              <Image source={{ uri: listing.imageUrl }} style={styles.image} resizeMode="cover" />
            </View>
          </SectionCard>
        ) : null}

        {/* Descrizione + toggle + stato traduzione */}
        {(descShown && descShown.trim()) ? (
          <SectionCard textColor={textColor}>
            <View style={styles.descHeaderRow}>
              <Text style={[styles.cardTitle, { color: textColor }]}>{L.description}</Text>
              {translated.translated ? (
                <TouchableOpacity
                  onPress={() => setShowOriginal(v => !v)}
                  style={styles.toggleBtn}
                  accessibilityLabel={L.toggleA11y}
                >
                  <Text style={styles.toggleText}>{showOriginal ? L.toggleTranslated : L.toggleOriginal}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {translating ? (
              <Text style={styles.caption}>{L.translating}</Text>
            ) : translated.translated && translated.descriptionTranslated ? (
              <Text style={styles.caption}>{L.translatedAuto(translated.lang, translated.originalLang)}</Text>
            ) : translated.translated && !translated.descriptionTranslated ? (
              <Text style={styles.caption}>{L.translatedPartial}</Text>
            ) : null}

            <View style={{ height: 10 }} />
            <Hairline mt={0} mb={12} />

            <ExpandableText numberOfLines={5} textColor={textColor}>
              {descShown}
            </ExpandableText>
          </SectionCard>
        ) : null}

        {/* AI price */}
        <View style={{ marginTop: 24, alignItems: "center" }}>
          <TouchableOpacity
            onPress={() => setShowPriceInfo((v) => !v)}
            accessibilityLabel={L.aiPriceInfoA11y}
            style={{
              width: 26, height: 26, borderRadius: 13, borderWidth: 1,
              borderColor: theme.colors.boardingText, alignItems: "center", justifyContent: "center", marginBottom: 8,
            }}
            activeOpacity={0.7}
          >
            <Text style={{ color: theme.colors.boardingText, fontWeight: "800", fontSize: 13 }}>i</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              const res = await checkPrice(listingId, locale);
              if (res?.available) {
                const verdictLabel = res.verdict === "low" ? L.aiPriceVerdictLow
                  : res.verdict === "high" ? L.aiPriceVerdictHigh
                  : L.aiPriceVerdictFair;
                Alert.alert(verdictLabel, res.explanation);
              } else {
                Alert.alert(L.aiPriceCta, L.aiPriceUnavailable);
              }
            }}
            disabled={priceChecking}
            style={{
              backgroundColor: theme.colors.primary, paddingVertical: 14, paddingHorizontal: 24,
              borderRadius: 12, alignItems: "center", minWidth: "70%",
              opacity: priceChecking ? 0.6 : 1,
            }}
            activeOpacity={0.85}
          >
            {priceChecking ? (
              <ActivityIndicator color={theme.colors.boardingText} />
            ) : (
              <Text style={{ color: theme.colors.boardingText, fontWeight: "700", fontSize: 16 }}>
                {L.aiPriceCta}
              </Text>
            )}
          </TouchableOpacity>

          {showPriceInfo ? (
            <View style={{ marginTop: 12, paddingHorizontal: 4 }}>
              <Text style={{ color: theme.colors.boardingText, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
                {L.aiPriceInfo1}
                {"\n"}{L.aiPriceInfoBullets[0]}
                {"\n"}{L.aiPriceInfoBullets[1]}
                {"\n"}{L.aiPriceInfoBullets[2]}
                {"\n"}{L.aiPriceInfoBullets[3]}
                {"\n"}{L.aiPriceInfoBullets[4]}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Segnala annuncio (solo se non sono io il proprietario) */}
        {!isOwner ? (
          <TouchableOpacity
            onPress={() => setReportOpen(true)}
            style={{ marginTop: 20, alignSelf: "center", flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12 }}
            accessibilityRole="button"
            accessibilityLabel={L.report}
          >
            <Text style={{ color: theme.colors.danger, fontWeight: "700" }}>⚑ {L.report}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>

      <ActionSheet
        visible={reportOpen}
        title={L.reportTitle}
        message={L.reportMsg}
        cancelLabel={tt("common.cancel", "Annulla")}
        onClose={() => setReportOpen(false)}
        options={[
          { label: L.reportReasonFake, onPress: () => doReport("fake") },
          { label: L.reportReasonScam, onPress: () => doReport("scam") },
          { label: L.reportReasonInappropriate, onPress: () => doReport("inappropriate") },
          { label: L.reportReasonDuplicate, onPress: () => doReport("duplicate") },
          { label: L.reportReasonOther, onPress: () => doReport("other") },
        ]}
      />

      {/* CTA footer (già localizzate dentro OfferCTAs) */}
      {!isMine ? (
        <View style={styles.footer}>
          <OfferCTAs listing={listing} me={{ id: meId }} />
        </View>
      ) : null}
    </View>
  );
}

/* ========= Micro UI ========= */

function Hairline({ mt = 10, mb = 10 }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginTop: mt, marginBottom: mb }} />;
}
function SectionCard({ title, children, textColor }) {
  return (
    <View style={styles.card}>
      {title ? <Text style={[styles.cardTitle, { color: textColor }]}>{title}</Text> : null}
      {title ? <Hairline mt={8} mb={12} /> : null}
      {children}
    </View>
  );
}
function Chip({ label, icon, textColor }) {
  return (
    <View style={styles.chip}>
      {icon ? <Text style={{ marginRight: 8, color: textColor }}>{icon}</Text> : null}
      <Text style={{ fontWeight: "600", color: textColor }}>{label}</Text>
    </View>
  );
}
function ExpandableText({ children, numberOfLines = 4, textColor }) {
  const [expanded, setExpanded] = useState(false);
  if (!children) return null;
  return (
    <View>
      <Text numberOfLines={expanded ? undefined : numberOfLines} style={{ color: textColor }}>
        {children}
      </Text>
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={{ marginTop: 6 }}>
        <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
          {expanded ? "Mostra meno" : "Mostra di più"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/* ========= Styles ========= */

const styles = StyleSheet.create({
  headerCard: { borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, overflow: "hidden", position: "relative" },
  headerGradient: { padding: 16 },
  ribbonWrap: { position: "absolute", top: 10, left: -6, zIndex: 10, transform: [{ rotate: "-10deg" }] },
  ribbon: { backgroundColor: "#22C55E", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  ribbonText: { color: "#fff", fontWeight: "800", letterSpacing: 0.5, fontSize: 12 },
  title: { fontFamily: theme.fonts.headingExtraBold, fontSize: 22 },
  subtitle: { marginTop: 6 },
  price: { fontSize: 22, fontWeight: "800" },
  card: { marginTop: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14,
    backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  sellerAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surfaceMuted },
  sellerAvatarPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  sellerInitials: { color: theme.colors.boardingText, fontWeight: "800", fontSize: 16 },
  sellerName: { fontWeight: "800", fontSize: 15 },
  sellerMeta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  sellerLink: { color: theme.colors.accent, fontWeight: "700", marginLeft: 8 },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.background, borderWidth: 1,
    borderColor: theme.colors.border, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginBottom: 8 },
  imageWrap: { borderRadius: 20, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  image: { width: "100%", aspectRatio: 16 / 9 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: theme.colors.surface,
    borderTopWidth: 1, borderTopColor: theme.colors.border, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, elevation: 8 },

  toggleBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background },
  toggleText: { fontWeight: "700", color: theme.colors.text },
  caption: { marginTop: 6, color: theme.colors.textMuted, fontSize: 12 },
  descHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
