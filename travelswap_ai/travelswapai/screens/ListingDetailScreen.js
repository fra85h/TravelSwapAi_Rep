// screens/ListingDetailScreen.js
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRoute, useNavigation } from "@react-navigation/native";
import { getListingMatches, recomputeForListing } from "../lib/backendApi";
import MatchCard from "../components/MatchCard";
import { getListingById } from "../lib/db.js";
import { theme } from "../lib/theme";
import TrustScoreBadge from "../components/TrustScoreBadge";
import OfferCTAs from "../components/OfferCTA";
import { useI18n } from "../lib/i18n";
import { useListingTranslation } from "../lib/useListingTranslation";

/* ========= Utils ========= */

const pad2 = (n) => String(n).padStart(2, "0");

function toYMDHMS_AMPM(input) {
  if (!input) return "—";
  const d = new Date(String(input));
  if (isNaN(d.getTime())) return String(input);
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${Y}-${M}-${D} ${pad2(h)}:${m}:${s} ${ampm}`;
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

/** rimuove prezzi nel titolo */
function stripPriceFromTitle(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\s*[-–—]?\s*(?:€|\bEUR\b)?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  out = out.replace(/\s*(?:prezzo|price)\s*[:\-]?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  return out.trim();
}

/* ========= Screen ========= */

export default function ListingDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const listingId = route.params?.listingId ?? route.params?.id;

  //const { t, locale } = (typeof useI18n === "function" ? useI18n() : { t: (s)=>s, locale: "it" });
const { t, lang } = (typeof useI18n === "function" ? useI18n() : { t: (s)=>s, lang: "it" });
 const locale = lang || "it";
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
         <Text style={{ marginLeft: 6, color: props.tintColor ?? "#007AFF", fontWeight: "600" }}>
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
  const [translated, setTranslated] = useState({
    title: null, description: null, translated: false, originalLang: null, lang: null,
  });
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async () => {
    setListing(await getListingById(listingId));
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

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
      });
      setShowOriginal(false);
    })();
    return () => { cancelled = true; };
  }, [listingId, locale, getTranslated]);

  const textColor = theme?.colors?.boardingText || "#111827";

  const trustScore = useMemo(() => {
    const raw =
      typeof listing?.trustscore === "number" ? listing.trustscore :
      typeof listing?.trust_score === "number" ? listing.trust_score :
      null;
    return raw != null ? Number(raw) : null;
  }, [listing]);

  // meta
  const checkIn   = listing?.check_in   ?? listing?.checkIn   ?? null;
  const checkOut  = listing?.check_out  ?? listing?.checkOut  ?? null;
  const departAt  = listing?.depart_at  ?? listing?.departAt  ?? null;
  const arriveAt  = listing?.arrive_at  ?? listing?.arriveAt  ?? null;
  const createdAt = listing?.created_at ?? listing?.createdAt ?? null;
  const publishedAgo = timeAgoLocalized(createdAt, locale);
  const isNewBadge   = (() => {
    if (!createdAt) return false;
    const d = new Date(String(createdAt));
    if (isNaN(d.getTime())) return false;
    return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
  })();

  const meId =
    route.params?.me?.id ??
    listing?.me?.id ??
    listing?.current_user_id ?? null;

  const ownerId =
    listing?.owner_id ?? listing?.user_id ?? listing?.created_by ?? listing?.author_id ?? null;

  const isMine = meId && ownerId && String(meId) === String(ownerId);

  const gradColors = ["#ffffff", listing?.type === "hotel" ? "#f2f7ff" : listing?.type === "train" ? "#fff7f2" : "#f7fafc"];

  // cosa mostrare
  const titleOriginal = stripPriceFromTitle(safeStr(listing?.title));
  const descOriginal  = listing?.description || "";
  const titleShown = translated.translated && !showOriginal ? (translated.title || titleOriginal) : titleOriginal;
  const descShown  = translated.translated && !showOriginal ? (translated.description || descOriginal) : descOriginal;

  const L = {
    info: tt("listingDetail.info", "Informazioni"),
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
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={recomputing} onRefresh={() => setRecomputing(false)} />}>
        <View style={styles.headerCard}>
          {isNewBadge ? (
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

            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E7EB", marginTop: 12, marginBottom: 12 }} />

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
                <Chip icon="📅" label={`${L.checkIn}: ${toYMDHMS_AMPM(checkIn)}`} textColor={textColor} />
                <Chip icon="📅" label={`${L.checkOut}: ${toYMDHMS_AMPM(checkOut)}`} textColor={textColor} />
                {listing?.pnr ? <Chip icon="🎫" label={`PNR: ${String(listing.pnr)}`} textColor={textColor} /> : null}
              </>
            ) : null}

            {listing?.type === "train" ? (
              <>
                <Chip icon="🕒" label={`${L.departAt.split(" (")[0]}: ${toYMDHMS_AMPM(departAt)}`} textColor={textColor} />
                <Chip icon="🕒" label={`${L.arriveAt.split(" (")[0]}: ${toYMDHMS_AMPM(arriveAt)}`} textColor={textColor} />
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
            ) : translated.translated ? (
              <Text style={styles.caption}>{L.translatedAuto(translated.lang, translated.originalLang)}</Text>
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
            onPress={() => console.log("AI price", listingId)}
            style={{
              backgroundColor: theme.colors.primary, paddingVertical: 14, paddingHorizontal: 24,
              borderRadius: 12, alignItems: "center", minWidth: "70%",
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: theme.colors.boardingText, fontWeight: "700", fontSize: 16 }}>
              {L.aiPriceCta}
            </Text>
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

        <View style={{ height: 24 }} />
      </ScrollView>

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
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E7EB", marginTop: mt, marginBottom: mb }} />;
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
        <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>
          {expanded ? "Mostra meno" : "Mostra di più"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/* ========= Styles ========= */

const styles = StyleSheet.create({
  headerCard: { borderRadius: 20, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, overflow: "hidden", position: "relative" },
  headerGradient: { padding: 16 },
  ribbonWrap: { position: "absolute", top: 10, left: -6, zIndex: 10, transform: [{ rotate: "-10deg" }] },
  ribbon: { backgroundColor: "#22C55E", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  ribbonText: { color: "#fff", fontWeight: "800", letterSpacing: 0.5, fontSize: 12 },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { marginTop: 6 },
  price: { fontSize: 22, fontWeight: "800" },
  card: { marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 14,
    backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1,
    borderColor: "#E5E7EB", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginBottom: 8 },
  imageWrap: { borderRadius: 20, overflow: "hidden", backgroundColor: "#E5E7EB" },
  image: { width: "100%", aspectRatio: 16 / 9 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: "#FFFFFF",
    borderTopWidth: 1, borderTopColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, elevation: 8 },

  toggleBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F8FAFC" },
  toggleText: { fontWeight: "700", color: "#111827" },
  caption: { marginTop: 6, color: "#6B7280", fontSize: 12 },
  descHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
