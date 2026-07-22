
// screens/CreateListingScreen.js

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AntDesign, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { insertListing, updateListing, getListingById, getListingSecret, findMyDuplicateActiveListing, isPnrInUse } from "../lib/db";
import { recomputeAIAndSnapshot, propagateListing } from "../lib/backendApi";
import { theme } from "../lib/theme";
import TrustScoreBadge from '../components/TrustScoreBadge';
import { useTrustScore } from '../lib/useTrustScore';
import TrustInfo from '../components/TrustInfo';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  StyleSheet, Switch, Modal, Dimensions,
  Keyboard,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "../lib/i18n";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
// API legacy: readAsStringAsync per la lettura base64 su nativo (la nuova
// File API di SDK 54 non serve qui; su web si passa da FileReader).
import * as FileSystem from "expo-file-system/legacy";
import DateField from "../components/DateField";
import DateTimeField from "../components/DateTimeField";
import { parseListingFromTextAI, parseListingFromPdfAI } from "../lib/descriptionParser"; // OpenAI parser (server-side)
import { Image } from "react-native";
import { listImages, uploadImage, deleteImage } from "../lib/listingImages";
import { parseLocalizedNumber } from "../lib/number";
import { isConcludedStatus } from "../lib/listingStatus";
import StationAutocomplete from "../components/StationAutocomplete";

/* ---------- CONST ---------- */
const FOOTER_H = 96; // usato per dare spazio sotto alle slide
const DRAFT_KEY = "@tsai:create_listing_draft";
const AUTO_HIDE_MS = 4500;   // tempo dopo cui spariscono micro log e barra
const MAX_PHOTOS = 2; // un biglietto/una stanza non ha bisogno di una galleria

function uniqBy(arr, keyFn) {
  try {
    const seen = new Set();
    return (Array.isArray(arr) ? arr : []).filter(it => {
      const key = keyFn(it);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { return Array.isArray(arr) ? arr : []; }
}

function formatAutoTitle(cercoVendo, type, locFrom, locTo, checkIn, checkOut, departAt, price, currency) {
  const action = (cercoVendo || '').toUpperCase() === 'CERCO' ? 'Cerco' : 'Vendo';
  const priceStr = (price != null && price !== '') ? `${Number(String(price).replace(',', '.')).toFixed(0)} ${currency || '€'}` : '';
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('it-IT'); } catch { return d || '-'; } };
  if ((type || '').toLowerCase() === 'train') {
    const soloAndata = 'solo andata'; // non abbiamo flag andata/ritorno: default solo andata
    const fromTo = (locFrom && locTo) ? `${locFrom}→${locTo}` : (locFrom || locTo || '');
    const d = departAt ? fmtDate(departAt) : '';
    return `${action} treno ${fromTo} ${d} ${soloAndata} ${priceStr}`.trim();
  } else {
    const loc = locTo || locFrom || ''; // per hotel usiamo location come "Località"
    const d1 = checkIn ? fmtDate(checkIn) : '';
    const d2 = checkOut ? fmtDate(checkOut) : '';
    return `${action} hotel in ${loc} ${d1}/${d2} ${priceStr}`.trim();
  }

}


/* Divide una tratta "A → B" (o "A-->B") in [da, a]. */
function splitRoute(loc) {
  const parts = String(loc || "").split(/-->|→/);
  if (parts.length === 2) return [parts[0].trim(), parts[1].trim()];
  return ["", ""];
}

/* Titolo standard coerente con l'azione scelta dall'utente (mai "Vendo" a
   prescindere: era il bug per cui un annuncio CERCO usciva col titolo "Vendo
   treno..."). I titoli restano in italiano come da template lato server. */
function buildAutoTitle(cercoVendo, type, routeFrom, routeTo, location) {
  const action = String(cercoVendo || "").toUpperCase() === "CERCO" ? "Cerco" : "Vendo";
  if (String(type || "").toLowerCase() === "train") {
    const route = [String(routeFrom || "").trim(), String(routeTo || "").trim()].filter(Boolean).join(" → ");
    return route ? `${action} treno ${route} solo andata` : "";
  }
  const loc = String(location || "").trim();
  return loc ? `${action} hotel ${loc}` : "";
}

/* Estrazione CERCO/VENDO dal testo descrizione (fallback locale se l'AI non lo imposta) */
function guessCercoVendoFromText(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;
  // segnali di "cerco"
  const cercoRx = /\b(cerco|cercasi|compro|acquisto|mi\s+serve|sto\s+cercando)\b/;
  // segnali di "vendo"
  const vendoRx = /\b(vendo|cedo|rivendo|offro|metto\s+in\s+vendita|scambio)\b/;
  if (cercoRx.test(s) && !vendoRx.test(s)) return "CERCO";
  if (vendoRx.test(s) && !cercoRx.test(s)) return "VENDO";
  // priorità al "cerco" se sono presenti entrambi
  if (cercoRx.test(s) && vendoRx.test(s)) return "CERCO";
  return null;
}

// Icone distinte e coerenti col significato di ciascuna azione (la vecchia
// stella unica era decorativa e su "Clear all" pure fuorviante, perché non
// è un'azione AI). iconLib: "mci" = MaterialCommunityIcons, "ant" = AntDesign.
function PillIcon({ iconLib, iconName, color }) {
  if (iconLib === "ant") {
    return <AntDesign name={iconName} size={16} style={{ marginRight: 6 }} color={color} />;
  }
  return <MaterialCommunityIcons name={iconName} size={17} style={{ marginRight: 6 }} color={color} />;
}

function AIPill({ title, onPress, disabled, dark, subtle, loading, iconName = "star-four-points", iconLib = "mci" }) {
  const contentColor = dark ? "#fff" : subtle ? theme.colors.textMuted : theme.colors.boardingText;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.pill,
        dark ? styles.pillDark : subtle ? styles.pillSubtle : styles.pillLight,
        (disabled || loading) && { opacity: 0.6 }
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {loading ? (
        <ActivityIndicator size="small" color={dark ? "#fff" : "#111827"} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <PillIcon iconLib={iconLib} iconName={iconName} color={contentColor} />
          <Text style={[styles.pillText, dark && styles.pillTextDark, subtle && styles.pillTextSubtle]} numberOfLines={1}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Versione icona-sola di AIPill, per il gruppo di azioni secondarie della
// toolbar AI compatta (Import/Check/Pulisci): stessa icona di prima, senza
// etichetta — l'accessibilityLabel resta il titolo completo per lettori
// schermo. "Compila con AI" resta un AIPill normale, è l'azione primaria.
// `label` è testo VISIBILE sotto l'icona (non solo accessibilityLabel): senza,
// "scudo" e "scopa" da soli non comunicano cosa fanno — l'utente li vedeva e
// non capiva a cosa servissero.
function AIIconButton({ onPress, disabled, loading, iconName = "star-four-points", iconLib = "mci", accessibilityLabel, label }) {
  const Icon = iconLib === "ant" ? AntDesign : MaterialCommunityIcons;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.aiIconBtnWrap, (disabled || loading) && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.aiIconBtn}>
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.boardingText} />
        ) : (
          <Icon name={iconName} size={18} color={theme.colors.textMuted} />
        )}
      </View>
      {!!label && <Text style={styles.aiIconBtnLabel} numberOfLines={1}>{label}</Text>}
    </TouchableOpacity>
  );
}

const TYPES = [
  { key: "hotel", labelKey: "listing.type.hotel" },
  { key: "train", labelKey: "listing.type.train" },
];

/* ---------- UTIL DATE/TIME ---------- */
function normalizeDateStr(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  let m;
  m = v.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); // YYYY-M-D
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = pad2(parseInt(m[2], 10));
    const d = pad2(parseInt(m[3], 10));
    return `${y}-${mo}-${d}`;
  }
  m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // D-M-YYYY
  if (m) {
    const d = pad2(parseInt(m[1], 10));
    const mo = pad2(parseInt(m[2], 10));
    const y = parseInt(m[3], 10);
    return `${y}-${mo}-${d}`;
  }
  return v;
}

const pad2 = (n) => String(n).padStart(2, "0");
const toISODate = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};
const toISOTime = (d) => {
  const dt = new Date(d);
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
};
// Converte un timestamptz del DB (es. "2026-09-25T08:00:00+00:00") nel formato
// "YYYY-MM-DDTHH:MM" del campo data/ora, leggendo i componenti in UTC: gli
// orari treno sono "da parete" (ora alla stazione) e vanno riproposti in
// modifica identici a come inseriti, senza lo scarto del fuso locale (+2 in IT).
const tsToWallInput = (ts) => {
  if (!ts) return "";
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return String(ts).replace(" ", "T").slice(0, 16);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
};
const parseISODate = (s) => {
  const norm = normalizeDateStr(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(norm))) return null;
  const [y, m, d] = norm.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
};
const parseISODateTime = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(String(s))) return null;
  const [date, time] = s.replace("T", " ").split(" ");
  const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
  const [H, M] = time.split(":").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d, H, M, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

/* ---------- AI PARSER helpers (semplificati) ---------- */
const IATA = { FCO:"Roma Fiumicino", CIA:"Roma Ciampino", MXP:"Milano Malpensa", LIN:"Milano Linate", BGY:"Bergamo Orio", VCE:"Venezia", BLQ:"Bologna", NAP:"Napoli", CTA:"Catania", PMO:"Palermo", CAG:"Cagliari", PSA:"Pisa", TRN:"Torino", VRN:"Verona", BRI:"Bari", OLB:"Olbia" };
const MONTHS_IT = { GENNAIO:0, FEBBRAIO:1, MARZO:2, APRILE:3, MAGGIO:4, GIUGNO:5, LUGLIO:6, AGOSTO:7, SETTEMBRE:8, OTTOBRE:9, NOVEMBRE:10, DICEMBRE:11 };
const DATE_ANY_RE = /\b(?:(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})|(\d{4})[\/-](\d{1,2})[\/-](\d{1,2}))\b/;
const DATE_TEXT_RE = new RegExp(String.raw`\b(\d{1,2})\s([A-Za-zÀ-ÿ]{3,})\s(\d{4})\b`, "i");
const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const FLIGHT_NO_RE = /\b([A-Z]{2})\s?(\d{2,4})\b/;
const IATA_PAIR_RE = /\b([A-Z]{3})\s*(?:-|–|—|>|→|to|verso)\s*([A-Z]{3})\b/;
const TRAIN_KEYWORDS_RE = /\b(Trenitalia|Frecciarossa|FR\s?\d|Italo|NTV|Regionale|IC|Intercity|Frecciargento|Frecciabianca)\b/i;
const ROUTE_TEXT_RE = /\b(?:da|from)\s([A-Za-zÀ-ÿ .'\-]+)\s(?:a|to)\s([A-Za-zÀ-ÿ .'\-]+)\b/i;
const ROUTE_ARROW_RE = /([A-Za-zÀ-ÿ .'\-]{3,})\s*(?:-|–|—|>|→)\s*([A-Za-zÀ-ÿ .'\-]{3,})/;
const PNR_RE = /\b(?:PNR|booking\s*reference|codice\s*(?:prenotazione|biglietto)|record\s*locator)\s*[:=]?\s([A-Z0-9]{5,8})\b/i;

function parseAnyDate(text) {
  if (!text) return null;
  let m = text.match(DATE_ANY_RE);
  if (m) {
    if (m[1] && m[2] && m[3]) {
      const d = parseInt(m[1], 10), mn = parseInt(m[2], 10) - 1, y = parseInt(m[3], 10);
      const dt = new Date(y, mn, d);
      if (!isNaN(dt.getTime())) return toISODate(dt);
    } else if (m[4] && m[5] && m[6]) {
      const y = parseInt(m[4], 10), mn = parseInt(m[5], 10) - 1, d = parseInt(m[6], 10);
      const dt = new Date(y, mn, d);
      if (!isNaN(dt.getTime())) return toISODate(dt);
    }
  }
  m = text.match(DATE_TEXT_RE);
  if (m) {
    const d = parseInt(m[1], 10), monthName = m[2].toUpperCase(), y = parseInt(m[3], 10);
    let mn = MONTHS_IT[monthName];
    if (mn === undefined) {
      const keys = Object.keys(MONTHS_IT);
      const hit = keys.find((k) => k.startsWith(monthName.slice(0, 3).toUpperCase()));
      if (hit) mn = MONTHS_IT[hit];
    }
    if (mn !== undefined) {
      const dt = new Date(y, mn, d);
      if (!isNaN(dt.getTime())) return toISODate(dt);
    }
  }
  return null;
}
function parseAnyTime(text, fallback = "09:00") {
  if (!text) return fallback;
  const m = text.match(TIME_RE);
  if (!m) return fallback;
  const h = pad2(parseInt(m[1], 10)), mm = pad2(parseInt(m[2], 10));
  return `${h}:${mm}`;
}
function normalizeTitleFromRoute(from, to, carrierHint) {
  if (from && to) {
    const arrow = "→";
    if (/ryanair/i.test(carrierHint)) return `Volo ${carrierHint} ${from} ${arrow} ${to}`;
    if (/italo/i.test(carrierHint)) return `Italo ${from} ${arrow} ${to}`;
    if (/trenitalia|freccia/i.test(carrierHint)) return `Freccia ${from} ${arrow} ${to}`;
    return `${from} ${arrow} ${to}`;
  }
  return null;
}
function smartParseTicket(text) {
  const src = String(text || "").replace(/\s/g, " ").trim();
  const out = { status: "active" };
  const pnr = (src.match(PNR_RE) || [])[1];
  if (pnr) out.pnr = pnr.toUpperCase();
  const hasTrain = TRAIN_KEYWORDS_RE.test(src);
  const flMatch = src.match(FLIGHT_NO_RE);
  const mentionsRyanair = /Ryanair|FR\s?\d{1,4}\b/i.test(src);
  let routeFrom = null, routeTo = null;
  const iata = src.match(IATA_PAIR_RE);
  if (iata) {
    const A = iata[1].toUpperCase(), B = iata[2].toUpperCase();
    routeFrom = IATA[A] || A; routeTo = IATA[B] || B;
  }
  if (!routeFrom || !routeTo) {
    const m1 = src.match(ROUTE_ARROW_RE);
    if (m1) { routeFrom = routeFrom || m1[1].trim(); routeTo = routeTo || m1[2].trim(); }
  }
  if (!routeFrom || !routeTo) {
    const m2 = src.match(ROUTE_TEXT_RE);
    if (m2) { routeFrom = routeFrom || m2[1].trim(); routeTo = routeTo || m2[2].trim(); }
  }
  const dateMatches = [...src.matchAll(DATE_ANY_RE)];
  const dateTextMatch = src.match(DATE_TEXT_RE);
  let dateDepart = null, timeDepart = null, dateArrive = null, timeArrive = null;
  if (dateMatches.length >= 1) dateDepart = parseAnyDate(dateMatches[0][0]);
  if (dateMatches.length >= 2) dateArrive = parseAnyDate(dateMatches[1][0]);
  if (!dateDepart && dateTextMatch) dateDepart = parseAnyDate(dateTextMatch[0]);
  const times = [...src.matchAll(TIME_RE)].map((m) => `${pad2(m[1])}:${pad2(m[2])}`);
  if (times[0]) timeDepart = times[0];
  if (times[1]) timeArrive = times[1];
  if (dateDepart && !dateArrive) dateArrive = dateDepart;
  if (dateDepart && timeDepart && !timeArrive) {
    const [H, M] = timeDepart.split(":").map((x) => parseInt(x, 10));
    const dt = new Date(`${dateDepart}T${pad2(H)}:${pad2(M)}:00`);
    const plus = new Date(dt.getTime() + 90 * 60000);
    timeArrive = `${pad2(plus.getHours())}:${pad2(plus.getMinutes())}`;
  }
  const isHotelish = /\b(hotel|albergo|check[-\s]?in|check[-\s]?out|notti|night)\b/i.test(src);
  const twoPlainDatesOnly = (dateMatches.length >= 2 || dateTextMatch) && times.length === 0;
  const isRyanair = mentionsRyanair || (flMatch && flMatch[1] === "FR");
  if (isHotelish || (twoPlainDatesOnly && !hasTrain && !isRyanair)) {
    out.type = "hotel";
    let d1 = dateDepart || parseAnyDate(src);
    let d2 = dateArrive || null;
    if (!d2 && dateMatches.length >= 2) d2 = parseAnyDate(dateMatches[1][0]);
    if (!d2 && d1) { const day2 = new Date(d1); day2.setDate(new Date(d1).getDate() + 2); d2 = toISODate(day2); }
    out.checkIn = d1 || ""; out.checkOut = d2 || "";
    out.title = normalizeTitleFromRoute(routeFrom, routeTo, "Hotel") || "Soggiorno";
    out.location = routeTo || routeFrom || "Hotel";
    return out;
  }
  out.type = "train";
  const dD = dateDepart || parseAnyDate(src) || toISODate(new Date());
  const tD = parseAnyTime(timeDepart, "09:00");
  const dA = dateArrive || dD;
  const tA = parseAnyTime(timeArrive, "10:30");
  out.departAt = `${dD}T${tD}`; out.arriveAt = `${dA}T${tA}`;
  const carrierHint = isRyanair ? "Ryanair" : hasTrain ? "Trenitalia/Italo" : "";
  out.title = normalizeTitleFromRoute(routeFrom, routeTo, carrierHint) || (isRyanair ? `Volo Ryanair ${flMatch ? flMatch[1] + flMatch[2] : ""}` : "Viaggio");
  out.location = routeFrom && routeTo ? `${routeFrom} → ${routeTo}` : isRyanair ? "Volo Ryanair" : "Treno";
  const pm = src.match(/(?:€|\beur\b|\beuro\b)\s*([0-9](?:[\,\.][0-9]{1,2})?)/i);
  if (pm) out.price = String(pm[1]).replace(",", ".");
  if (isRyanair) out.imageUrl = "https://picsum.photos/seed/ryanair/1200/800";
  else if (hasTrain) out.imageUrl = "https://picsum.photos/seed/train/1200/800";
  return out;
}

/* ---------- AI IMPORT RESOLVERS ---------- */
async function aiImportFromPNR(pnr) {
  await new Promise((r) => setTimeout(r, 300));
  const code = String(pnr || "").trim().toUpperCase();
  const synthetic = `Codice prenotazione: ${code}`;
  const parsed = smartParseTicket(synthetic);
  if (!parsed.type) parsed.type = "train";
  if (parsed.type === "train" && (!parsed.departAt || !parsed.arriveAt)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const a = new Date(d.getTime() + 90 * 60000);
    parsed.departAt = `${toISODate(d)}T${toISOTime(d)}`;
    parsed.arriveAt = `${toISODate(a)}T${toISOTime(a)}`;
  }
  if (!parsed.title) parsed.title = "Viaggio";
  if (!parsed.location) parsed.location = parsed.type === "hotel" ? "Hotel" : "Tratta";
  if (!parsed.imageUrl) parsed.imageUrl = parsed.type === "hotel" ? "https://picsum.photos/seed/hotel/1200/800" : "https://picsum.photos/seed/train/1200/800";
  return parsed;
}
async function aiImportFromQR(raw) {
  await new Promise((r) => setTimeout(r, 300));
  const txt = String(raw || "");
  const parsed = smartParseTicket(txt);
  if (parsed.type === "train" && (!parsed.departAt || !parsed.arriveAt)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const a = new Date(d.getTime() + 90 * 60000);
    parsed.departAt = `${toISODate(d)}T${toISOTime(d)}`;
    parsed.arriveAt = `${toISODate(a)}T${toISOTime(a)}`;
  }
  if (!parsed.title) parsed.title = parsed.type === "hotel" ? "Soggiorno" : "Viaggio";
  if (!parsed.location) parsed.location = parsed.type === "hotel" ? "Hotel" : "Tratta";
  // fix: URL corretta (evita immagini rotte)
  if (!parsed.imageUrl) parsed.imageUrl = parsed.type === "hotel" ? "https://picsum.photos/seed/hotel/1200/800" : "https://picsum.photos/seed/train/1200/800";
  return parsed;
}

export default function CreateListingScreen({
  onDirtyChange = () => {},
  onSubmitStart = () => {},
  onSubmitEnd = () => {},
  route,
}) {
  const { t, locale } = useI18n();
  const navigation = useNavigation();
  const p = route?.params ?? {};
  const passedListing = p.listing ?? null; // <-- keep same API
  const listingId = p.listingId ?? passedListing?.id ?? passedListing?._id ?? null;
  const mode = (p.mode === "edit" || listingId != null || passedListing != null) ? "edit" : "create";

  // TrustScore hook + UI state
  const { loading: trustLoading, data: trustData, error: trustError, evaluate } = useTrustScore();
  const [splitDetected, setSplitDetected] = useState(false);
  const [splitReason, setSplitReason] = useState("");

  // Rilevamento "due annunci" basato su descrizione e tipo
  const detectTwoListings = useCallback((desc, type) => {
    try {
      const text = String(desc || "").toLowerCase();
      if (!text || text.length < 10) return { two: false, reason: "" };

      const routeArrowRx = /([A-Za-zÀ-ÿ .'\-]{3,})\s*(?:\-+|—+|–+|>|→|a|to|verso)\s*([A-Za-zÀ-ÿ .'\-]{3,})/gi;
      const timeRx = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
      const dateRx = /\b(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}|\d{4}[\/\.\-]\d{1,2}[\/\.\-]\d{1,2})\b/g;
      const hotelWordRx = /\b(hotel|albergo|b&b|bb|bnb|ostello|resort|guesthouse)\b/gi;

      const routes = Array.from(text.matchAll(routeArrowRx));
      const times = Array.from(text.matchAll(timeRx));
      const dates = Array.from(text.matchAll(dateRx));
      const hotels = Array.from(text.matchAll(hotelWordRx));

      const ty = String(type || "").toLowerCase();
      if (ty === "train") {
        if (routes.length >= 2) return { two: true, reason: t("createListing.checkAi.reasonRoutes", `Rilevate ${routes.length} tratte nel testo.`, { n: routes.length }) };
        if (routes.length === 1 && times.length >= 3) return { two: true, reason: t("createListing.checkAi.reasonTimes", `Rilevati più orari (${times.length}).`, { n: times.length }) };
      } else if (ty === "hotel") {
        // Soglie più alte che per il treno: una normale conferma di
        // prenotazione (prenotato il / check-in / check-out / scadenza
        // cancellazione gratuita) cita già 4 date e la parola "hotel" 2+
        // volte per UN SOLO soggiorno — con soglie basse veniva segnalata
        // come "2 annunci distinti" una prenotazione singola legittima.
        if (dates.length >= 6) return { two: true, reason: t("createListing.checkAi.reasonDates", `Rilevate più date (${dates.length}).`, { n: dates.length }) };
        if (hotels.length >= 3) return { two: true, reason: t("createListing.checkAi.reasonHotels", `Rilevate più strutture (${hotels.length}).`, { n: hotels.length }) };
      } else {
        if (routes.length >= 2 || dates.length >= 4) return { two: true, reason: t("createListing.checkAi.reasonMultiple", "Rilevati elementi multipli (tratte/date).") };
      }
      if (/\b(2|due)\s+bigliett/i.test(text)) return { two: true, reason: t("createListing.checkAi.reasonTwoTickets", "La descrizione cita due biglietti.") };
      return { two: false, reason: "" };
    } catch { return { two: false, reason: "" }; }
  }, [t]);

  // Stato form
  // location resta il campo per gli hotel; per i treni la tratta vive in due
  // campi separati routeFrom/routeTo ("Da"/"A") e location viene ricomposta
  // come "Da → A" solo al salvataggio (compatibilità con DB e resto dell'app).
  const [form, setForm] = useState({
    type: "hotel",
    cercoVendo: "VENDO",
    title: "",
    location: "",
    routeFrom: "",
    routeTo: "",
    checkIn: "",
    checkOut: "",
    departAt: "",
    arriveAt: "",
    isNamedTicket: false,
    gender: "",
    pnr: "",
    // Operatore (solo treno): Trenitalia, Italo… Ricavato dall'AI (Compila
    // AI sul testo, import PDF/conferma), mai chiesto a mano — vedi consider()
    // in onAiFill e applyImportedData. Mostrato solo nel dettaglio annuncio.
    operator: "",
    description: "",
    price: "",
    // Prezzo di acquisto (anti-bagarinaggio): quanto il venditore ha pagato il
    // biglietto. Il prezzo di vendita non può superarlo (vedi computeErrors).
    purchasePrice: "",
    // Scambio (B): solo per VENDO. Se attivo, l'utente dichiara cosa cerca in
    // cambio (tratta per treno, località per hotel) → l'AI abbina scambi reali.
    acceptsSwap: false,
    swapWantedFrom: "",
    swapWantedTo: "",
    swapWantedLocation: "",
    swapWantedNote: "",
  });

  // true dopo che l'utente ha toccato esplicitamente il segmento: da quel
  // momento "Compila con AI" non cambia più il valore in silenzio ma chiede.
  const userTouchedCercoVendo = useRef(false);
  const userTouchedType = useRef(false);

  const [lastTrustRunAt, setLastTrustRunAt] = useState(0);
  useEffect(() => {
    // Mostra il box solo dopo un Check AI (per coerenza con il flusso richiesto)
    if (lastTrustRunAt <= 0) return;
    const info = detectTwoListings(form?.description, form?.type);
    setSplitDetected(!!info.two);
    setSplitReason(info.two ? info.reason : "");
  }, [lastTrustRunAt, form?.description, form?.type, detectTwoListings]);

  const [showFixesModal, setShowFixesModal] = useState(false);

  // Micro log + progress per Check AI
  const [microLog, setMicroLog] = useState([]);
  const [showMicroLog, setShowMicroLog] = useState(false);
  const [progress, setProgress] = useState(0);
  const hideTimerRef = useRef(null);

  // Tastiera (per bloccare swipe orizzontale quando è aperta)
  const [isKbOpen, setIsKbOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvt, () => setIsKbOpen(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setIsKbOpen(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Fase della schermata: "intro" (Tipo/Titolo + import/AI, favorisce
  // l'import automatico) o "manual" (Step 2: tutti gli altri campi, a
  // schermo intero). In modifica si parte già da "manual": i dati esistono
  // già, non ha senso far ripassare l'utente dal gate "Inserisci
  // manualmente" ogni volta che apre un annuncio da correggere.
  const [phase, setPhase] = useState(mode === "edit" ? "manual" : "intro");

  const [slideIndex, setSlideIndex] = useState(0);
  const [sliderW, setSliderW] = useState(Dimensions.get("window").width);
  const [advancedOpen, setAdvancedOpen] = useState(false); // "Opzioni avanzate" a scomparsa
  const scrollRef = useRef(null); // ref for horizontal ScrollView

  const [insightsOpen, setInsightsOpen] = useState(false);
  const hasInsights = (trustData?.flags?.length || trustData?.suggestedFixes?.length);

  // Campi disabilitati di default + matita per abilitare: protegge i dati
  // già presenti (annuncio esistente in modifica, o importati dall'AI) da
  // modifiche accidentali. In creazione da zero, invece, non c'è nulla da
  // proteggere: i campi partono sbloccati, altrimenti non si riesce a
  // scrivere nulla senza prima scoprire il tasto matita.
  const [editableFields, setEditableFields] = useState({
    title: mode === "create",
    checkIn: mode === "create",
    checkOut: mode === "create",
    departAt: mode === "create",
    arriveAt: mode === "create",
    location: mode === "create",
  });

  // Helper: località non vuota (per lock hotel Località)
  const isFilledLocation = useCallback((s) => !!String(s || "").trim(), []);

  // Helper: data completa YYYY-MM-DD (per lock hotel date)
  const isFullDate = useCallback((s) => {
    if (!s || typeof s !== "string") return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }, []);

  // Helper: datetime completo YYYY-MM-DDTHH:MM (per lock treno) — stessa
  // forma richiesta da parseISODateTime, altrimenti un campo può risultare
  // "completo" (bloccato) ma comunque invalido per il validatore.
  const isFullDateTime = useCallback((s) => {
    if (!s || typeof s !== "string") return false;
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
  }, []);

  const toggleEditable = useCallback((key) => {
    setEditableFields((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ---- Auto-lock flags ----
  const departLocked = isFullDateTime(form?.departAt) && !editableFields.departAt;
  const arriveLocked = isFullDateTime(form?.arriveAt) && !editableFields.arriveAt;
  const checkInLocked = isFullDate(form?.checkIn) && !editableFields.checkIn;
  const checkOutLocked = isFullDate(form?.checkOut) && !editableFields.checkOut;
  const hotelLocLocked = form?.type === "hotel" && !!String(form?.location || "").trim() && !editableFields.location;

const initialJsonRef = useRef(null);
  const [errors, setErrors] = useState({});

  // Validazione "lazy": l'errore di un campo si vede solo dopo che l'utente
  // ci è passato ed è uscito lasciandolo vuoto/invalido (touched), oppure
  // dopo un tentativo di avanzare/pubblicare (submitAttempted) — mai
  // all'apertura dello step. `errors` resta sempre calcolato per intero
  // (serve a bloccare la pubblicazione e ad aprire da sola "Opzioni
  // avanzate"), è solo la VISUALIZZAZIONE a essere posticipata.
  const [touched, setTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const markTouched = useCallback((key) => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);
  const fieldError = useCallback(
    (key) => ((touched[key] || submitAttempted) ? errors[key] : undefined),
    [touched, submitAttempted, errors]
  );

  // Solo il "nessuna foto caricata" è un promemoria a bassa priorità (le foto
  // sono facoltative): lo nascondiamo dal riepilogo per non fare rumore. Ma
  // filtrare per TESTO del messaggio (come prima) nascondeva anche flag reali
  // — es. IRRELEVANT_IMAGES ("la foto mostra...") — solo perché il messaggio
  // nomina "foto"/"immagine": un problema che limita il punteggio (55%)
  // spariva dal riepilogo, mostrando "nessun problema rilevato". Filtrare per
  // CODICE esatto invece del testo evita di nascondere problemi veri.
  const HIDDEN_FLAG_CODES = useMemo(() => new Set(["NO_IMAGES"]), []);
  const HIDDEN_FIX_FIELDS = useMemo(() => new Set(["images"]), []);

  const flagsNoImg = useMemo(() => {
    let arr = Array.isArray(trustData?.flags)
      ? trustData.flags.filter(f => !HIDDEN_FLAG_CODES.has(String(f?.code || "").toUpperCase()))
      : [];
    if (form?.type === "hotel") {
      arr = arr.filter(f => !/depart|arrive/i.test(f.field || ""));
    } else {
      arr = arr.filter(f => !/checkin|checkout/i.test(f.field || ""));
    }
    const seen = new Set();
    return arr.filter(f => {
      const key = `${String(f?.field||'')}`.trim().toLowerCase() + '|' + `${String(f?.msg||'')}`.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [trustData, form?.type, HIDDEN_FLAG_CODES]);

  const fixesNoImg = useMemo(() => {
    let arr = Array.isArray(trustData?.suggestedFixes)
      ? trustData.suggestedFixes.filter(s => !HIDDEN_FIX_FIELDS.has(String(s?.field || "").toLowerCase()))
      : [];
    if (form?.type === "hotel") {
      arr = arr.filter(s => !/depart|arrive/i.test(s.field || ""));
    } else {
      arr = arr.filter(s => !/checkin|checkout/i.test(s.field || ""));
    }
    const seen = new Set();
    return arr.filter(s => {
      const key = `${String(s?.field||'')}`.trim().toLowerCase() + '|' + `${String(s?.suggestion||'')}`.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [trustData, form?.type]);

  // Il "perché" del punteggio deve essere SEMPRE visibile, non solo quando è
  // basso (regola di prodotto): prima la soglia score>=85 nascondeva questa
  // spiegazione anche a un 86% senza alcun flag, facendo mostrare "Nessun
  // problema rilevato" — fuorviante, perché 86% non è 100% e un motivo per
  // cui non lo è esiste sempre. Ora si nasconde solo a punteggio pieno (100).
  const trustExplain = useMemo(() => {
    if (!trustData || trustData.aiAvailable === false) return null;
    const score = Number(trustData?.trustScore);
    if (!Number.isFinite(score) || score >= 100) return null;
    if (flagsNoImg?.length) return null; // già spiegato da un flag puntuale
    const sub = trustData?.subScores || {};
    const parts = [
      { label: t("createListing.checkAi.subHeuristics", "Controlli di base (date, prezzo, coerenza)"), value: sub.heuristics },
      { label: t("createListing.checkAi.subAiText", "Analisi del testo (AI)"), value: sub.aiText },
      { label: t("createListing.checkAi.subAiImages", "Analisi delle foto (AI)"), value: sub.aiImages },
    ].filter(p => Number.isFinite(Number(p.value)));
    if (!parts.length) return null;
    parts.sort((a, b) => Number(a.value) - Number(b.value));
    const weakest = parts[0];
    const value = Math.round(Number(weakest.value));
    return t(
      "createListing.checkAi.explainWeak",
      `Punteggio non massimo: il punto più debole è "${weakest.label}" (${value}%).`,
      { label: weakest.label, value }
    );
  }, [trustData, flagsNoImg, t]);

  // ---------- EDIT MODE: prefill ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A-2: "Ho questo biglietto" da un annuncio CERCO → precompila un VENDO
        // con la stessa tratta/date. Mai titolo/descrizione/prezzo del CERCO: il
        // prezzo lì è il budget dell'altro, il tuo lo scegli tu. Segna come
        // "toccati" tipo e cerco/vendo così "Compila con AI" non li ribalta.
        if (route?.params?.prefill && mode !== "edit") {
          const pf = route.params.prefill;
          const [locFrom, locTo] = splitRoute(pf.location);
          const type = (pf.type === "train" || pf.type === "hotel") ? pf.type : "train";
          const rf = pf.route_from || locFrom || "";
          const rt = pf.route_to || locTo || "";
          userTouchedCercoVendo.current = true;
          userTouchedType.current = true;
          if (!cancelled) {
            setForm((prev) => ({
              ...prev,
              type,
              cercoVendo: "VENDO",
              location: pf.location || prev.location,
              routeFrom: rf,
              routeTo: rt,
              checkIn: pf.check_in || "",
              checkOut: pf.check_out || "",
              departAt: tsToWallInput(pf.depart_at),
              arriveAt: tsToWallInput(pf.arrive_at),
              title: buildAutoTitle("VENDO", type, rf, rt, pf.location),
            }));
          }
          return;
        }
        if (mode === "edit" && route?.params?.listingId && typeof getListingById === "function") {
          const l = await getListingById(route.params.listingId);
          // il PNR non è in listings: si legge dal segreto (solo owner)
          const secretPnr = await getListingSecret(route.params.listingId).catch(() => null);
          if (!cancelled && l) {
            originalStatusRef.current = l.status || null;
            const [locFrom, locTo] = splitRoute(l.location);
            setForm((prev) => ({
              ...prev,
              type: l.type || prev.type,
              cercoVendo: l.cerco_vendo || l.cercoVendo || prev.cercoVendo,
              title: l.title ?? prev.title,
              location: l.location ?? prev.location,
              routeFrom: l.route_from || locFrom || "",
              routeTo: l.route_to || locTo || "",
              description: l.description ?? prev.description,
              price: l.price != null ? String(l.price) : prev.price,
              purchasePrice: l.purchase_price != null ? String(l.purchase_price) : (prev.purchasePrice || ""),
              checkIn: l.check_in || "",
              checkOut: l.check_out || "",
              // depart_at/arrive_at arrivano dal DB come timestamptz completi
              // (con secondi e offset, es. "2026-07-20T09:00:00+00:00"): li
              // normalizziamo nel formato YYYY-MM-DDTHH:MM che il validatore
              // e il picker si aspettano, altrimenti il salvataggio fallisce
              // silenziosamente in edit mode.
              departAt: tsToWallInput(l.depart_at),
              arriveAt: tsToWallInput(l.arrive_at),
              pnr: secretPnr ?? prev.pnr ?? "",
              operator: l.operator || prev.operator || "",
              // scambio (B)
              acceptsSwap: !!l.accepts_swap,
              swapWantedFrom: l?.swap_wanted?.from || "",
              swapWantedTo: l?.swap_wanted?.to || "",
              swapWantedLocation: l?.swap_wanted?.location || "",
              swapWantedNote: l?.swap_wanted?.note || "",
            }));
          }
          return;
        }
        if (route?.params?.draftFromId && typeof getListingById === "function") {
          const l = await getListingById(route.params.draftFromId);
          if (!cancelled && l) {
            const [locFrom, locTo] = splitRoute(l.location);
            setForm((prev) => ({
              ...prev,
              title: l.title || prev.title,
              location: l.location || prev.location,
              routeFrom: l.route_from || locFrom || "",
              routeTo: l.route_to || locTo || "",
              description: l.description || prev.description,
              price: l.price != null ? String(l.price) : prev.price,
              imageUrl: l.image_url || prev.imageUrl,
              checkIn: l.check_in || "",
              checkOut: l.check_out || "",
              departAt: tsToWallInput(l.depart_at),
              arriveAt: tsToWallInput(l.arrive_at),
            }));
          }
        } else {
          const raw = await AsyncStorage.getItem(DRAFT_KEY);
          if (raw && mode !== "edit") {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              // bozze salvate prima dei campi routeFrom/routeTo: ricava la
              // tratta dalla vecchia location "A → B"
              if (parsed.location && !parsed.routeFrom && !parsed.routeTo) {
                const [a, b] = splitRoute(parsed.location);
                if (a || b) { parsed.routeFrom = a; parsed.routeTo = b; }
              }
              setForm((p) => ({ ...p, ...parsed }));
            }
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [mode, route?.params?.listingId, route?.params?.draftFromId]);

  const isDirty = useMemo(() => {
    if (initialJsonRef.current == null) return false;
    try {
      return JSON.stringify(form) !== initialJsonRef.current;
    } catch {
      return false;
    }
  }, [form]);

  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  const saveTimer = useRef(null);
  const queueAutoSave = useCallback((next) => {
    if (mode === "edit") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch {}
    }, 350);
  }, [mode]);

  const update = useCallback((patchOrUpdater) => {
    setForm((prev) => {
      const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(prev) : patchOrUpdater;
      const next = { ...prev, ...patch };
      queueAutoSave(next);
      return next;
    });
  }, [queueAutoSave]);

  const onChangeType = (nextType) => {
    userTouchedType.current = true;
    if (form?.type === nextType) return;
    if (nextType === "hotel") {
      update({ type: "hotel", departAt: "", arriveAt: "", isNamedTicket: false, gender: "", pnr: "" });
    } else {
      update({ type: "train", checkIn: "", checkOut: "" });
    }
  };

  // Cambio CERCO/VENDO: se il titolo segue il template "Cerco/Vendo …",
  // adegua la prima parola così titolo e chip non si contraddicono mai.
  const onChangeCercoVendo = (cv) => {
    userTouchedCercoVendo.current = true;
    update((prev) => {
      const patch = { cercoVendo: cv };
      const m = String(prev.title || "").match(/^(Cerco|Vendo)\s+(.*)$/i);
      if (m) patch.title = `${cv === "CERCO" ? "Cerco" : "Vendo"} ${m[2]}`;
      return patch;
    });
  };

  /* ---------- CHECK AI (comprende ex “Magia IA”) ---------- */
  const [loadingAI, setLoadingAI] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importSheet, setImportSheet] = useState(false);
  const [pnrInput, setPnrInput] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  /* ---------- FOTO ANNUNCIO ---------- */
  // in creazione: foto scelte ma non ancora caricate (nessun listing su cui appoggiarle)
  const [pendingPhotos, setPendingPhotos] = useState([]); // [{ uri, base64, mimeType, fileName }]
  // in modifica: foto già salvate su listing_images
  const [existingPhotos, setExistingPhotos] = useState([]); // [{ id, url }]
  const [photoBusy, setPhotoBusy] = useState(false);

  // In modifica il salvataggio non richiede di norma un nuovo Check AI (per
  // non intralciare piccole correzioni di testo/prezzo). Ma le foto sono
  // valutate SOLO dal Check AI (pertinenza, moderazione): se cambiano dopo
  // l'ultima verifica, quella verifica non le ha mai viste. Questo flag forza
  // un nuovo Check AI prima di salvare, solo quando le foto sono cambiate.
  const [photosDirtySinceCheck, setPhotosDirtySinceCheck] = useState(false);

  // Solo in CREAZIONE: se il Check AI è già stato eseguito ma poi si modifica
  // un campo testuale rilevante (titolo, descrizione, tratta/data, prezzo…),
  // il punteggio calcolato non riflette più il contenuto reale. In modifica
  // resta intenzionalmente escluso (vedi commento sopra su photosDirtySinceCheck):
  // qui invece prima non c'era ALCUN controllo sul testo, solo sulle foto.
  const lastCheckedContentRef = useRef(null);
  // Stato originale dell'annuncio in modifica: serve solo per sapere se era
  // 'expired' — se lo era e le nuove date sono di nuovo nel futuro, il
  // salvataggio lo rimette 'active' in automatico (vedi onPublishOrSave).
  const originalStatusRef = useRef(passedListing?.status || null);

  const editListingId = mode === "edit" ? (passedListing?.id || listingId) : null;
  const totalPhotoCount = existingPhotos.length + pendingPhotos.length;

  useEffect(() => {
    let cancelled = false;
    if (!editListingId) return;
    listImages(editListingId).then((imgs) => {
      if (!cancelled) setExistingPhotos(imgs || []);
    });
    return () => { cancelled = true; };
  }, [editListingId]);

  const pickPhotos = async () => {
    try {
      const room = MAX_PHOTOS - totalPhotoCount;
      if (room <= 0) {
        Alert.alert(
          t("createListing.photoLimitTitle", "Limite foto raggiunto"),
          t("createListing.photoLimitMsg", `Puoi caricare al massimo ${MAX_PHOTOS} foto per annuncio: solo il biglietto o la stanza/prenotazione, niente altro.`, { n: MAX_PHOTOS })
        );
        return;
      }
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("createListing.photoPermissionTitle", "Permesso negato"), t("createListing.photoPermissionMsg", "Consenti l'accesso alle foto per aggiungerne."));
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: room,
        quality: 0.7,
        base64: true,
      });
      if (res.canceled) return;
      const assets = (res.assets || []).slice(0, room);

      if (editListingId) {
        // annuncio già esistente: carica subito
        setPhotoBusy(true);
        let pos = existingPhotos.length;
        for (const a of assets) {
          try {
            const row = await uploadImage(editListingId, a, pos++);
            setExistingPhotos((prev) => [...prev, row]);
            setPhotosDirtySinceCheck(true);
          } catch (e) {
            Alert.alert(t("createListing.photoUploadErrorTitle", "Errore caricamento"), e?.message || t("createListing.photoUploadErrorMsg", "Impossibile caricare una foto."));
          }
        }
        setPhotoBusy(false);
      } else {
        // annuncio non ancora creato: tieni in sospeso, carica dopo la pubblicazione.
        // Anche qui, come per le foto già salvate sopra, un Check AI già fatto
        // non ha mai visto queste foto: va invalidato (vedi needsCheckAI).
        setPendingPhotos((prev) => [...prev, ...assets]);
        setPhotosDirtySinceCheck(true);
      }
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("createListing.photoPickErrorMsg", "Impossibile selezionare le foto."));
    }
  };

  const removePendingPhoto = (idx) => {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotosDirtySinceCheck(true);
  };

  const removeExistingPhoto = (img) => {
    Alert.alert(t("createListing.removePhotoTitle", "Rimuovi foto"), t("createListing.removePhotoMsg", "Vuoi eliminare questa foto?"), [
      { text: t("common.cancel", "Annulla"), style: "cancel" },
      {
        text: t("common.delete", "Elimina"),
        style: "destructive",
        onPress: async () => {
          setPhotoBusy(true);
          try {
            await deleteImage(img.id, img.url);
            setExistingPhotos((prev) => prev.filter((p) => p.id !== img.id));
            setPhotosDirtySinceCheck(true);
          } catch (e) {
            Alert.alert(t("common.error", "Errore"), e?.message || t("createListing.photoDeleteErrorMsg", "Impossibile eliminare."));
          } finally {
            setPhotoBusy(false);
          }
        },
      },
    ]);
  };

  /** Carica le foto rimaste in sospeso su un annuncio appena creato */
  const flushPendingPhotos = async (newListingId) => {
    if (!newListingId || pendingPhotos.length === 0) return;
    let pos = 0;
    for (const a of pendingPhotos) {
      try {
        await uploadImage(newListingId, a, pos++);
      } catch (e) {
        console.log("[flushPendingPhotos] upload error:", e?.message || e);
      }
    }
    setPendingPhotos([]);
  };

  const logStep = useCallback((msg, pct) => {
    setMicroLog((prev) => [...prev, msg]);
    if (typeof pct === "number") setProgress((p) => Math.max(p, Math.min(100, pct)));
  }, []);

  const clearLogSoon = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setShowMicroLog(false);
      setMicroLog([]);
      setProgress(0);
    }, AUTO_HIDE_MS);
  }, []);

  /* ---------- COMPILA CON AI (ex "Magia IA", separata dal Check) ----------
     Legge la descrizione e propone i campi. Regole:
     - compila SOLO i campi vuoti; se un campo ha già un valore diverso,
       chiede conferma prima di sovrascrivere;
     - le DATE inserite dall'utente non vengono MAI toccate;
     - il titolo rispetta il CERCO/VENDO effettivo (mai "Vendo" forzato). */
  const [aiFilling, setAiFilling] = useState(false);

  const onAiFill = useCallback(async () => {
    const text = String(form.description || "").trim();
    if (text.length < 10) {
      Alert.alert(
        t("createListing.aiFillNeedDescTitle", "Descrizione mancante"),
        t("createListing.aiFillNeedDescMsg", "Scrivi prima una breve descrizione (almeno 10 caratteri): l'AI la userà per compilare i campi.")
      );
      return;
    }

    try {
      setAiFilling(true);
      setShowMicroLog(true);
      setMicroLog([]);
      setProgress(0);
      logStep(t("createListing.checkAi.logAnalyzingDesc", "Analisi descrizione con AI…"), 25);

      let parsed = null;
      try { parsed = await parseListingFromTextAI(text, "it"); } catch {}

      // cerco/vendo: AI > euristica locale sul testo
      const cercoFromText = guessCercoVendoFromText(text);
      const detectedCV =
        (parsed?.cercoVendo === "CERCO" || parsed?.cercoVendo === "VENDO")
          ? parsed.cercoVendo
          : cercoFromText;

      // tratta dal parse (origin/destination o location "A-->B")
      const [parsedFrom, parsedTo] = (parsed?.origin || parsed?.destination)
        ? [String(parsed.origin || "").trim(), String(parsed.destination || "").trim()]
        : splitRoute(parsed?.location);

      const isEmpty = (v) => !String(v ?? "").trim();

      // fillPatch: campi vuoti → si applicano subito, in silenzio.
      // conflicts: campi già valorizzati con suggerimento diverso → si chiede.
      const fillPatch = {};
      const conflicts = [];
      const consider = (key, suggested, label, { neverOverwrite = false } = {}) => {
        const sugg = String(suggested ?? "").trim();
        if (!sugg) return;
        const current = String(form[key] ?? "").trim();
        if (isEmpty(current)) { fillPatch[key] = sugg; return; }
        if (current.toLowerCase() === sugg.toLowerCase()) return;
        if (neverOverwrite) return; // date dell'utente: mai toccate
        conflicts.push({ key, label, suggested: sugg });
      };

      // type/cercoVendo: hanno un default, quindi "vuoto" = mai toccato dall'utente
      const nextType = (parsed?.type === "train" || parsed?.type === "hotel") ? parsed.type : null;
      if (nextType && nextType !== form.type) {
        if (!userTouchedType.current) fillPatch.type = nextType;
        else conflicts.push({ key: "type", label: t("createListing.type", "Tipo"), suggested: nextType });
      }
      if (detectedCV && detectedCV !== form.cercoVendo) {
        if (!userTouchedCercoVendo.current) fillPatch.cercoVendo = detectedCV;
        else conflicts.push({ key: "cercoVendo", label: t("createListing.cercoVendoLabel", "Tipo annuncio"), suggested: detectedCV });
      }

      const effType = fillPatch.type || form.type;
      if (effType === "train") {
        consider("routeFrom", parsedFrom, t("createListing.routeFrom", "Da"));
        consider("routeTo", parsedTo, t("createListing.routeTo", "A"));
        consider("departAt", parsed?.departAt ? parsed.departAt.replace(" ", "T") : null, t("createListing.departAt", "Partenza"), { neverOverwrite: true });
        consider("arriveAt", parsed?.arriveAt ? parsed.arriveAt.replace(" ", "T") : null, t("createListing.arriveAt", "Arrivo"), { neverOverwrite: true });
        if (parsed?.pnr) consider("pnr", parsed.pnr, "PNR");
        if (typeof parsed?.isNamedTicket === "boolean" && !form.isNamedTicket) fillPatch.isNamedTicket = parsed.isNamedTicket;
        if (parsed?.gender) consider("gender", parsed.gender, t("createListing.train.genderLabel", "Genere"));
        if (parsed?.provider) consider("operator", parsed.provider, t("createListing.train.operator", "Operatore"));
      } else {
        const parsedLoc = String(parsed?.location || "").trim();
        if (parsedLoc && !/-->|→/.test(parsedLoc)) consider("location", parsedLoc, t("createListing.locationLabelHotel", "Località"));
        consider("checkIn", parsed?.checkIn ? normalizeDateStr(parsed.checkIn) : null, t("createListing.checkIn", "Check-in"), { neverOverwrite: true });
        consider("checkOut", parsed?.checkOut ? normalizeDateStr(parsed.checkOut) : null, t("createListing.checkOut", "Check-out"), { neverOverwrite: true });
      }
      if (parsed?.price) consider("price", String(parsed.price).replace(",", "."), t("createListing.price", "Prezzo"));

      // titolo: sempre ricostruito dal template con l'azione EFFETTIVA
      const effCV = fillPatch.cercoVendo || form.cercoVendo;
      const autoTitle = buildAutoTitle(
        effCV,
        effType,
        fillPatch.routeFrom || form.routeFrom,
        fillPatch.routeTo || form.routeTo,
        fillPatch.location || form.location
      );
      if (autoTitle) consider("title", autoTitle, t("createListing.titleLabel", "Titolo").replace(" *", ""));

      const filledCount = Object.keys(fillPatch).length;
      if (filledCount) {
        update(fillPatch);
        logStep(t("createListing.checkAi.logFilledN", `Compilati ${filledCount} campi dalla descrizione.`, { n: filledCount }), 80);
      } else {
        logStep(t("createListing.checkAi.logNothingEmpty", "Nessun campo vuoto da compilare."), 80);
      }

      if (conflicts.length) {
        const fieldNames = conflicts.map((c) => c.label).join(", ");
        logStep(t("createListing.checkAi.logSomeConflict", "Alcuni campi hanno già un valore: scegli tu."), 95);
        Alert.alert(
          t("createListing.aiFillConflictTitle", "Sovrascrivere i campi già compilati?"),
          t("createListing.aiFillConflictMsg", `L'AI suggerisce valori diversi per: ${fieldNames}. Le date che hai inserito non vengono mai modificate.`, { fields: fieldNames }),
          [
            { text: t("createListing.aiFillKeep", "Mantieni i miei dati"), style: "cancel" },
            {
              text: t("createListing.aiFillOverwrite", "Usa suggerimenti AI"),
              onPress: () => {
                const patch = {};
                for (const c of conflicts) patch[c.key] = c.suggested;
                // ricalcola il titolo se cambia qualcosa che lo compone
                const cv2 = patch.cercoVendo || effCV;
                const type2 = patch.type || effType;
                const t2 = buildAutoTitle(
                  cv2, type2,
                  patch.routeFrom || fillPatch.routeFrom || form.routeFrom,
                  patch.routeTo || fillPatch.routeTo || form.routeTo,
                  patch.location || fillPatch.location || form.location
                );
                if (t2 && !conflicts.some((c) => c.key === "title")) patch.title = t2;
                update(patch);
              },
            },
          ]
        );
      }

      logStep(t("createListing.checkAi.logAiFillDone", "Fatto. Controlla i campi e completa ciò che manca."), 100);
      clearLogSoon();
    } catch {
      logStep(t("createListing.checkAi.logAiFillError", "Errore durante la compilazione AI."), 100);
      clearLogSoon();
      Alert.alert(t("common.error", "Errore"), t("createListing.aiFillErrorMsg", "Impossibile analizzare la descrizione. Riprova."));
    } finally {
      setAiFilling(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, t, update, logStep, clearLogSoon]);

  // Sottoinsieme testuale del form (nessuna foto) usato per capire se il
  // contenuto è cambiato dall'ultimo Check AI — le foto hanno il loro flag
  // dedicato, photosDirtySinceCheck, perché sono valutate solo lì.
  const buildContentSnapshot = useCallback(() => {
    const isTrain = form?.type === "train";
    return {
      type: form?.type,
      cerco_vendo: form.cercoVendo === "CERCO" ? "CERCO" : "VENDO",
      title: form.title,
      description: form.description,
      origin: isTrain ? (String(form.routeFrom || "").trim() || null) : null,
      destination: isTrain ? (String(form.routeTo || "").trim() || null) : null,
      location: !isTrain ? (String(form.location || "").trim() || null) : null,
      checkIn: !isTrain ? (form.checkIn || null) : null,
      checkOut: !isTrain ? (form.checkOut || null) : null,
      departAt: isTrain ? (form.departAt || null) : null,
      arriveAt: isTrain ? (form.arriveAt || null) : null,
      price: form.price ? parseLocalizedNumber(form.price) : null,
    };
  }, [form]);

  /* ---------- CHECK AI (solo verifica: non modifica MAI il form) ----------
     Ritorna il risultato del TrustScore (truthy) se la verifica è andata a
     buon fine, null se è stata saltata (rate limit) o è fallita: onPublishOrSave
     la richiama in automatico e usa questo esito per decidere se può
     procedere alla pubblicazione. */
  const onTrustCheck = useCallback(async () => {
    const now = Date.now();
    if (now - lastTrustRunAt < 10_000) {
      const secs = Math.ceil((10_000 - (now - lastTrustRunAt)) / 1000);
      Alert.alert(t("createListing.trustCheckWaitTitle", "Attendi un attimo"), t("createListing.trustCheckWaitMsg", `Puoi rilanciare la verifica tra ~${secs}s.`, { secs }));
      return null;
    }

    try {
      setLoadingAI(true);
      setShowMicroLog(true);
      setMicroLog([]);
      setProgress(0);
      logStep(t("createListing.checkAi.logStart", "Inizio controllo…"), 10);

      // 1) Coerenza/validazioni locali (warning)
      logStep(t("createListing.checkAi.logCoherenceDates", "Controllo coerenza e date…"), 30);
      const localFlags = [];
      const nowDate = new Date();

      if (form?.type === "hotel") {
        const a = parseISODate(normalizeDateStr(form.checkIn));
        const b = parseISODate(normalizeDateStr(form.checkOut));
        if (a && b) {
          const days = (b - a) / (1000 * 60 * 60 * 24);
          if (days > 30) localFlags.push({ field: "checkOut", msg: t("createListing.checkAi.localStayTooLong", "Durata soggiorno oltre 30 giorni.") });
        }
        if (a && a < new Date(nowDate.toDateString())) localFlags.push({ field: "checkIn", msg: t("createListing.checkAi.localCheckInPast", "Check-in nel passato.") });
        if (b && b < new Date(nowDate.toDateString())) localFlags.push({ field: "checkOut", msg: t("createListing.checkAi.localCheckOutPast", "Check-out nel passato.") });
      } else {
        const da = parseISODateTime(form.departAt);
        const ar = parseISODateTime(form.arriveAt);
        if (da && ar) {
          const hrs = (ar - da) / (1000 * 60 * 60);
          if (hrs > 48) localFlags.push({ field: "arriveAt", msg: t("createListing.checkAi.localTripTooLong", "Durata tratta oltre 48 ore.") });
        }
        if (da && da < new Date()) localFlags.push({ field: "departAt", msg: t("createListing.checkAi.localDepartPast", "Partenza nel passato.") });
        if (ar && ar < new Date()) localFlags.push({ field: "arriveAt", msg: t("createListing.checkAi.localArrivePast", "Arrivo nel passato.") });
      }

      // 2) Foto: incluse nella verifica (moderazione + coerenza col contenuto).
      //    In creazione sono ancora locali → data URI base64; in modifica
      //    sono già su storage → URL https.
      const images = [];
      for (const a of pendingPhotos) {
        if (images.length >= 3) break;
        if (a?.base64) images.push({ url: `data:${a.mimeType || "image/jpeg"};base64,${a.base64}` });
      }
      for (const img of existingPhotos) {
        if (images.length >= 3) break;
        if (img?.url) images.push({ url: img.url });
      }
      if (images.length) logStep(t("createListing.checkAi.logAnalyzingPhotos", `Analizzo anche ${images.length} foto…`, { n: images.length }), 45);

      // 3) TrustScore remoto sul form CORRENTE (nessuna patch)
      logStep(t("createListing.checkAi.logReliability", "Verifica affidabilità annuncio…"), 60);
      const isTrain = form?.type === "train";
      const payload = {
        id: passedListing?.id || listingId || null,
        type: form?.type,
        cerco_vendo: form.cercoVendo === "CERCO" ? "CERCO" : "VENDO",
        title: form.title,
        description: form.description,
        origin: isTrain ? (String(form.routeFrom || "").trim() || null) : null,
        destination: isTrain ? (String(form.routeTo || "").trim() || null) : null,
        // per gli hotel il normalizzatore legge "location" (non destination):
        // passarla come destination la faceva sparire dal payload verso il server
        location: !isTrain ? (String(form.location || "").trim() || null) : null,
        checkIn: !isTrain ? (form.checkIn || null) : null,
        checkOut: !isTrain ? (form.checkOut || null) : null,
        departAt: isTrain ? (form.departAt || null) : null,
        arriveAt: isTrain ? (form.arriveAt || null) : null,
        price: form.price ? parseLocalizedNumber(form.price) : null,
        currency: "EUR",
        images,
      };
      const res = await evaluate(payload, { locale });

      if (localFlags.length) {
        localFlags.forEach((f) => logStep(`⚠︎ ${f.msg}`, 90));
      }

      logStep(t("createListing.checkAi.logDone", "Fatto."), 100);
      setLastTrustRunAt(Date.now()); // <-- mark that Check AI has been run
      setPhotosDirtySinceCheck(false); // le foto correnti sono state appena valutate
      lastCheckedContentRef.current = JSON.stringify(buildContentSnapshot());
      clearLogSoon();
      if (!res && trustError) {
        Alert.alert(t("createListing.trustScoreTitle", "AI TrustScore"), trustError);
        return null;
      }
      return res;
    } catch (err) {
      logStep(t("createListing.checkAi.logError", "Errore durante il Check AI."), 100);
      clearLogSoon();
      Alert.alert(t("createListing.trustScoreTitle", "AI TrustScore"), t("createListing.trustScoreGenericError", "Qualcosa è andato storto durante la verifica."));
      return null;
    } finally {
      setLoadingAI(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, lastTrustRunAt, trustError, evaluate, logStep, clearLogSoon, passedListing?.id, listingId, pendingPhotos, existingPhotos, t, locale, buildContentSnapshot]);

  const applyAllTrustFixes = () => {
    try {
      const fixes = Array.isArray(trustData?.suggestedFixes) ? trustData.suggestedFixes : [];
      if (!fixes.length) {
        Alert.alert(t("createListing.noFixTitle", "Nessun fix"), t("createListing.noFixMsg", "Non ci sono suggerimenti da applicare."));
        return;
      }
      const patch = {};
      const isTrain = form?.type === "train";
      const mapKey = (k) => {
        const key = String(k || "").toLowerCase();
        if (["title","titolo"].includes(key)) return "title";
        if (["origin","partenza","da","route_from","routefrom"].includes(key)) return isTrain ? "routeFrom" : "location";
        if (["location","località","destinazione","destination","a","route_to","routeto"].includes(key)) return isTrain ? "routeTo" : "location";
        if (["checkin","check_in","check-out","check-in"].includes(key)) return "checkIn";
        if (["checkout","check_out"].includes(key)) return "checkOut";
        if (["departat","depart_at","departure"].includes(key)) return "departAt";
        if (["arriveat","arrive_at","arrival","arrivo"].includes(key)) return "arriveAt";
        if (["price","prezzo"].includes(key)) return "price";
        if (["pnr","codiceprenotazione"].includes(key)) return "pnr";
        if (["cerco","vendo","cercovendo","tipo annuncio"].includes(key)) return "cercoVendo";
        return null;
      };
      for (const f of fixes) {
        const k = mapKey(f.field);
        if (!k) continue;
        let v = f.suggestion;
        if (k === "price") v = String(v).replace(",", ".");
        if (k === "cercoVendo") v = /cerco/i.test(String(v)) ? "CERCO" : /vendo/i.test(String(v)) ? "VENDO" : null;
        if (v == null) continue;
        // se il fix porta una tratta intera "A → B", spalmala sui due campi
        if (k === "routeFrom" || k === "routeTo") {
          const [a, b] = splitRoute(v);
          if (a && b) { patch.routeFrom = a; patch.routeTo = b; continue; }
        }
        patch[k] = String(v);
      }
      // titolo coerente con l'azione EFFETTIVA (mai "Vendo" forzato)
      if (!patch.title && (patch.routeFrom || patch.routeTo || patch.location || patch.cercoVendo)) {
        const t2 = buildAutoTitle(
          patch.cercoVendo || form.cercoVendo,
          form.type,
          patch.routeFrom || form.routeFrom,
          patch.routeTo || form.routeTo,
          patch.location || form.location
        );
        if (t2) patch.title = t2;
      }

      if (Object.keys(patch).length) {
        update(patch);
        setShowFixesModal(false);
        Alert.alert(t("createListing.fixesAppliedTitle", "Fix applicati"), t("createListing.fixesAppliedMsg", "Ho applicato i suggerimenti AI. Puoi comunque modificarli."));
      } else {
        Alert.alert(t("createListing.nothingToApplyTitle", "Nulla da applicare"), t("createListing.nothingToApplyMsg", "I suggerimenti non riguardano campi modificabili."));
      }
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.applyFixesErrorMsg", "Impossibile applicare i fix."));
    }
  };

  
  // Lock flags (auto-lock when complete)
    //const departLocked = isFullDateTime(form?.departAt) && !editableFields.departAt;
   // const arriveLocked = isFullDateTime(form?.arriveAt) && !editableFields.arriveAt;
    //const checkInLocked = isFullDate(form?.checkIn) && !editableFields.checkIn;
    //const checkOutLocked = isFullDate(form?.checkOut) && !editableFields.checkOut;
   // const hotelLocLocked = form?.type === "hotel" && isFilledLocation(form?.location) && !editableFields.location;
/* ---------- VALIDAZIONI ---------- */
  const computeErrors = useCallback(() => {
    const ciNorm = normalizeDateStr(form.checkIn);
    const coNorm = normalizeDateStr(form.checkOut);
    const e = {};

    if (!form.title.trim()) e.title = t("createListing.errors.titleRequired", "Titolo obbligatorio.");
    if (form?.type === "train") {
      if (!String(form.routeFrom || "").trim()) e.routeFrom = t("createListing.errors.routeFromRequired", "Stazione di partenza obbligatoria.");
      if (!String(form.routeTo || "").trim()) e.routeTo = t("createListing.errors.routeToRequired", "Stazione di arrivo obbligatoria.");
    } else if (!form.location.trim()) {
      e.location = t("createListing.errors.locationRequired", "Località obbligatoria.");
    }

    if (form?.type === "hotel") {
      if (!ciNorm) e.checkIn = t("createListing.errors.checkInRequired", "Check-in obbligatorio.");
      if (!coNorm) e.checkOut = t("createListing.errors.checkOutRequired", "Check-out obbligatorio.");
      if (ciNorm && !parseISODate(ciNorm)) e.checkIn = t("createListing.errors.checkInInvalid", "Check-in non valido (YYYY-MM-DD).");
      if (coNorm && !parseISODate(coNorm)) e.checkOut = t("createListing.errors.checkOutInvalid", "Check-out non valido (YYYY-MM-DD).");
      if (ciNorm && coNorm) {
        const a = parseISODate(ciNorm), b = parseISODate(coNorm);
        if (a && b && b < a) e.checkOut = t("createListing.errors.checkoutBeforeCheckin", "Il check-out non può precedere il check-in.");
      }
      // Data nel passato: bloccante SOLO in creazione. Un annuncio NUOVO con
      // check-in già nel passato non ha senso; un annuncio ESISTENTE la cui
      // data è nel frattempo trascorsa non deve invece impedire di
      // correggere un campo non correlato (es. il prezzo) in "Modifica
      // annuncio". Prima questo controllo esisteva solo come avviso
      // informativo nel micro-log del Check AI, mai come validazione
      // bloccante: un annuncio nuovo con data passata poteva comunque essere
      // pubblicato.
      if (mode !== "edit") {
        const todayStart = new Date(new Date().toDateString());
        if (!e.checkIn && ciNorm) {
          const a = parseISODate(ciNorm);
          if (a && a < todayStart) e.checkIn = t("createListing.checkAi.localCheckInPast", "Check-in nel passato.");
        }
        if (!e.checkOut && coNorm) {
          const b = parseISODate(coNorm);
          if (b && b < todayStart) e.checkOut = t("createListing.checkAi.localCheckOutPast", "Check-out nel passato.");
        }
      }
    } else {
      if (!form.departAt.trim()) e.departAt = t("createListing.errors.departRequired", "Data/ora partenza obbligatoria.");
      if (!form.arriveAt.trim()) e.arriveAt = t("createListing.errors.arriveRequired", "Data/ora arrivo obbligatoria.");
      if (form.departAt && !parseISODateTime(form.departAt)) e.departAt = t("createListing.errors.departInvalid", "Partenza non valida (YYYY-MM-DD HH:mm).");
      if (form.arriveAt && !parseISODateTime(form.arriveAt)) e.arriveAt = t("createListing.errors.arriveInvalid", "Arrivo non valido (YYYY-MM-DD HH:mm).");
      if (form.departAt && form.arriveAt) {
        const a = parseISODateTime(form.departAt), b = parseISODateTime(form.arriveAt);
        if (a && b && b < a) e.arriveAt = t("createListing.errors.arriveBeforeDepart", "L’arrivo non può precedere la partenza.");
      }
      if (mode !== "edit") {
        const now = new Date();
        if (!e.departAt && form.departAt) {
          const a = parseISODateTime(form.departAt);
          if (a && a < now) e.departAt = t("createListing.checkAi.localDepartPast", "Partenza nel passato.");
        }
        if (!e.arriveAt && form.arriveAt) {
          const b = parseISODateTime(form.arriveAt);
          if (b && b < now) e.arriveAt = t("createListing.checkAi.localArrivePast", "Arrivo nel passato.");
        }
      }
      if (form.isNamedTicket && !/^(M|F)$/.test(form.gender)) {
        e.gender = t("createListing.errors.genderRequired", "Seleziona M o F.");
      }
    }
    const priceStr = String(form.price || "").trim();
    let priceNum = NaN;
    if (!priceStr) e.price = t("createListing.errors.priceRequired", "Prezzo obbligatorio.");
    else {
      priceNum = parseLocalizedNumber(priceStr) ?? NaN;
      if (!Number.isFinite(priceNum)) e.price = t("createListing.errors.priceInvalid", "Prezzo non valido.");
      else if (priceNum < 0) e.price = t("createListing.errors.priceNegative", "Il prezzo non può essere negativo.");
    }

    // Anti-bagarinaggio: il prezzo di vendita non può superare quello di
    // acquisto (solo per un VENDO; per un CERCO il campo prezzo è il budget).
    if (!isCerco) {
      const purchStr = String(form.purchasePrice || "").trim();
      if (purchStr) {
        const purchNum = parseLocalizedNumber(purchStr) ?? NaN;
        if (!Number.isFinite(purchNum)) e.purchasePrice = t("createListing.errors.purchaseInvalid", "Prezzo di acquisto non valido.");
        else if (purchNum <= 0) e.purchasePrice = t("createListing.errors.purchaseNonPositive", "Il prezzo di acquisto deve essere maggiore di zero.");
        else if (Number.isFinite(priceNum) && priceNum > purchNum) {
          e.price = t("createListing.errors.priceAbovePurchase", "Il prezzo di vendita non può superare quello di acquisto ({purchase}€).", { purchase: purchNum });
        }
      }
    }
    return e;
  }, [form, t, mode]);
  useEffect(() => { setErrors(computeErrors()); }, [computeErrors]);
  const validate = () => { const e = computeErrors(); setErrors(e); return Object.keys(e).length === 0; };

  // --- Helpers to go to slides programmatically
  const goToSlide = (idx) => {
    const x = (idx || 0) * (sliderW || 0);
    if (scrollRef.current && typeof scrollRef.current.scrollTo === "function") {
      scrollRef.current.scrollTo({ x, animated: true });
    }
    setSlideIndex(idx);
  };
  const onNextPress = () => { setSubmitAttempted(true); goToSlide(Math.min(slideIndex + 1, 1)); };
  const onBackPress = () => goToSlide(Math.max(slideIndex - 1, 0));
  // Passa allo Step 2 (campi manuali) e, se richiesto, salta direttamente a
  // una slide precisa — usato dopo Import/Compila con AI per mostrare
  // subito l'esito (Check AI, prezzo) invece di lasciare l'utente sullo
  // Step 1.
  const goToManualStep = (idx) => { setPhase("manual"); goToSlide(idx); };

  // Ricava il passo corrente dalla posizione di scroll effettiva: usata sia
  // da onMomentumScrollEnd sia da onScrollEndDrag, così lo swipe (con o
  // senza inerzia) aggiorna i pallini con la stessa identica logica del
  // tasto Avanti/Indietro invece di dipendere da un solo evento non sempre
  // affidabile (specie su web).
  const setSlideIndexFromOffset = (nativeEvent) => {
    const w = nativeEvent.layoutMeasurement?.width || sliderW || 1;
    const x = nativeEvent.contentOffset?.x || 0;
    const idx = Math.round(x / w);
    setSlideIndex(idx);
  };
  const clearAll = useCallback(() => {
    setMicroLog([]); setProgress(0); setShowMicroLog(false);
    update({
      title: "",
      location: "",
      routeFrom: "", routeTo: "",
      description: "",
      type: "train",
      checkIn: "", checkOut: "",
      departAt: "", arriveAt: "",
      price: "", currency: "EUR",
      pnr: "", gender: "", isNamedTicket: false,
      imageUrl: "",
    });
  }, [update]);


  /* ---------- Analisi prezzo con AI (locale) ---------- */
  const [priceInfoOpen, setPriceInfoOpen] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const analyzePriceAI = async () => {
    try {
      setPriceLoading(true);
      // Simulazione di analisi AI locale: stima semplice basata su durata
      let suggestion = parseLocalizedNumber(form.price) ?? 0;
      if (!Number.isFinite(suggestion) || suggestion <= 0) suggestion = 0;

      if (form.type === "hotel") {
        const a = parseISODate(form.checkIn);
        const b = parseISODate(form.checkOut);
        const nights = (a && b) ? Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24))) : 1;
        const basePerNight = 80; // eur
        suggestion = Math.max(40, Math.min(400, nights * basePerNight));
      } else {
        const da = parseISODateTime(form.departAt);
        const ar = parseISODateTime(form.arriveAt);
        const hours = (da && ar) ? Math.max(1, Math.round((ar - da) / (1000 * 60 * 60))) : 2;
        const perHour = 12; // eur
        suggestion = Math.max(10, Math.min(120, hours * perHour));
      }
      // arrotonda a 5€
      suggestion = Math.round(suggestion / 5) * 5;

      update({ price: String(suggestion) });
      Alert.alert(
        t("createListing.priceSuggestionTitle", "Suggerimento prezzo"),
        t(
          "createListing.priceSuggestionMsg",
          `In base ai dati inseriti, potresti proporre circa ${suggestion}€.\nÈ solo un consiglio: sentiti libero di adattarlo.`,
          { price: suggestion }
        )
      );
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.priceEstimateErrorMsg", "Impossibile stimare il prezzo al momento."));
    } finally {
      setPriceLoading(false);
    }
  };

  /* ---------- PUBBLICA / SALVA MODIFICHE ---------- */
  const onPublishOrSave = async () => {
    // Da qui in poi gli errori dei campi non ancora "toccati" diventano
    // visibili: un tentativo di pubblicazione conta come richiesta esplicita
    // di validazione, come premere "Avanti".
    setSubmitAttempted(true);
    // Venduto/scambiato: transazione conclusa, non più modificabile (stesso
    // vincolo lato DB, vedi trigger before_update_listings_lock_terminal). Un
    // ingresso qui è già anomalo (il bottone "Modifica" è nascosto per questi
    // stati sia nel dettaglio annuncio sia nell'action sheet di Profilo), ma
    // la route resta raggiungibile: blocco comunque il submit.
    if (mode === "edit" && isConcludedStatus(originalStatusRef.current)) {
      Alert.alert(
        t("editListing.concludedTitle", "Annuncio non modificabile"),
        t("editListing.concludedMsg", "Questo annuncio è già venduto o scambiato: la transazione è conclusa e non può più essere modificata.")
      );
      return;
    }

    // Il Check AI deve sempre riflettere il contenuto che si sta per
    // pubblicare (sempre in creazione, o se non ancora fatto; in entrambe le
    // modalità anche se le foto sono cambiate dall'ultima verifica —
    // altrimenti si potrebbe verificare, poi sostituire le foto con altre mai
    // valutate e pubblicare comunque un trustScore calcolato su foto diverse
    // da quelle pubblicate. Correggere testo/prezzo in modifica non richiede
    // invece di rilanciare tutto il Check AI, vedi commento su
    // photosDirtySinceCheck. In creazione conta anche il testo
    // (contentDirtySinceCheck): senza, un Check AI fatto su una bozza e mai
    // ripetuto dopo aver riscritto titolo/descrizione restava "valido" per
    // sempre.
    const hasRunCheckAI = lastTrustRunAt > 0;
    const contentDirtySinceCheck =
      mode !== "edit" && hasRunCheckAI &&
      JSON.stringify(buildContentSnapshot()) !== lastCheckedContentRef.current;
    const needsCheckAI = mode !== "edit"
      ? (!hasRunCheckAI || photosDirtySinceCheck || contentDirtySinceCheck)
      : photosDirtySinceCheck;

    // Invece di bloccare con un Alert che rimanda a un bottone "Check AI" a
    // parte (due bottoni, non ovvio quale premere prima prima di pubblicare),
    // lo eseguiamo qui in automatico e in modo trasparente: stesso micro-log
    // di un check manuale. Se fallisce (rete, o rate limit di 10s tra due
    // check) blocchiamo comunque la pubblicazione: mai un annuncio mai
    // verificato.
    if (needsCheckAI) {
      const checkRes = await onTrustCheck();
      if (!checkRes) {
        Alert.alert(
          t("createListing.checkAiAutoFailedTitle", "Verifica non riuscita"),
          t("createListing.checkAiAutoFailedMsg", "Non sono riuscito a completare automaticamente la verifica AI. Riprova tra qualche secondo.")
        );
        return;
      }
    }

    const validationErrors = computeErrors();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      Alert.alert(
        t("createListing.errors.cannotSaveTitle", "Impossibile salvare"),
        Object.values(validationErrors).join("\n")
      );
      return;
    }

    // Anti doppia vendita: uno stesso biglietto (PNR) non può essere in
    // vendita in due annunci vivi. Vale in creazione e in modifica (escludendo
    // il proprio annuncio). Il PNR è opzionale: il controllo scatta solo se
    // presente. Backstop a DB con indice unico su pnr_fingerprint.
    if (form?.type === "train") {
      const pnrClean = String(form.pnr || "").trim();
      if (pnrClean) {
        const excludeId = mode === "edit" ? (listingId || passedListing?.id || null) : null;
        const inUse = await isPnrInUse(pnrClean, excludeId);
        if (inUse) {
          Alert.alert(
            t("createListing.pnrInUseTitle", "Biglietto già in vendita"),
            t("createListing.pnrInUseMsg", "Questo PNR risulta già presente in un altro annuncio attivo. Lo stesso biglietto non può essere messo in vendita più volte.")
          );
          return;
        }
      }
    }

    // Anti-duplicati (solo in creazione): un duplicato ESATTO di un proprio
    // annuncio già attivo si blocca (stesso vincolo lato DB, vedi trigger
    // before_insert_listings_block_duplicate); uno SIMILE (stessa tratta/
    // località, altro prezzo o data) è solo un avviso — si può procedere.
    if (mode !== "edit") {
      const rf = String(form.routeFrom || "").trim();
      const rt = String(form.routeTo || "").trim();
      const probe = {
        type: form?.type,
        route_from: rf,
        route_to: rt,
        location: form?.type === "hotel" ? form.location.trim() : [rf, rt].filter(Boolean).join(" → "),
        depart_at: form.departAt || null,
        check_in: form.checkIn || null,
        price: parseLocalizedNumber(form.price) ?? null,
      };
      const dup = await findMyDuplicateActiveListing(probe);
      if (dup.exact) {
        Alert.alert(
          t("createListing.dupExactTitle", "Annuncio già pubblicato"),
          t("createListing.dupExactMsg", "Hai già un annuncio attivo identico. Modifica o rimuovi quello esistente invece di pubblicarne un altro uguale.")
        );
        return;
      }
      if (dup.similar) {
        const proceed = await new Promise((resolve) => {
          Alert.alert(
            t("createListing.dupSimilarTitle", "Annuncio simile già attivo"),
            t("createListing.dupSimilarMsg", "Hai già un annuncio attivo molto simile. Vuoi pubblicarlo lo stesso?"),
            [
              { text: t("common.cancel", "Annulla"), style: "cancel", onPress: () => resolve(false) },
              { text: t("createListing.dupPublishAnyway", "Pubblica comunque"), onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) return;
      }
    }

    try {
      setPublishing(true);
      onSubmitStart();

      const idForUpdate =
        (listingId != null) ? String(listingId) :
        (passedListing?.id != null ? String(passedListing.id) : null);

      if (mode === "edit" && !idForUpdate) {
        Alert.alert(t("common.error", "Errore"), t("editListing.saveError", "ID annuncio mancante."));
        return;
      }

      const priceNum = parseLocalizedNumber(form.price) ?? NaN;

      // Treno: la location salvata è la composizione "Da → A" dei due campi
      // (compatibilità con card, dettaglio e matching già esistenti).
      const routeFrom = String(form.routeFrom || "").trim();
      const routeTo = String(form.routeTo || "").trim();
      const locationForSave = form?.type === "train"
        ? [routeFrom, routeTo].filter(Boolean).join(" → ")
        : form.location.trim();

      // Scambio (B): solo un VENDO può accettare scambio. swap_wanted racchiude
      // cosa cerchi in cambio (tratta per treno, località per hotel) + nota.
      const acceptsSwap = form.cercoVendo !== "CERCO" && !!form.acceptsSwap;
      const swapWanted = acceptsSwap
        ? {
            type: form?.type,
            from: form?.type === "train" ? (String(form.swapWantedFrom || "").trim() || null) : null,
            to: form?.type === "train" ? (String(form.swapWantedTo || "").trim() || null) : null,
            location: form?.type === "hotel" ? (String(form.swapWantedLocation || "").trim() || null) : null,
            note: String(form.swapWantedNote || "").trim() || null,
          }
        : null;

      const basePayload = {
        type: form?.type,
        title: form.title.trim(),
        location: locationForSave,
        description: form.description.trim() || null,
        price: Number.isFinite(priceNum) ? priceNum : null,
        cerco_vendo: form.cercoVendo === "CERCO" ? "CERCO" : "VENDO",
        // Anti-bagarinaggio: solo per un VENDO. In modifica va sempre passato
        // (anche null) così svuotare il campo lo azzera davvero a DB.
        purchase_price: form.cercoVendo === "CERCO"
          ? null
          : (parseLocalizedNumber(String(form.purchasePrice || "").trim()) ?? null),
        accepts_swap: acceptsSwap,
        swap_wanted: swapWanted,
        // In creazione: salva la reliability calcolata (chiave camelCase, la
        // mappa insertListing). In modifica: aggiorna il punteggio salvato
        // SOLO se in questa sessione è stato rilanciato il Check AI — così
        // ri-verificare un annuncio "guarisce" un punteggio vecchio/ingiusto,
        // invece di restare congelato al valore della pubblicazione. La chiave
        // qui è snake_case perché updateListing passa i campi come colonne.
        ...(mode !== "edit"
          ? { status: "active", trustScore: trustData?.trustScore ?? null }
          : (Number.isFinite(Number(trustData?.trustScore)) ? { trust_score: Number(trustData.trustScore) } : {}))
      };

      const payload = form?.type === "hotel"
        ? { ...basePayload, check_in: form.checkIn, check_out: form.checkOut }
        : { ...basePayload, depart_at: form.departAt, arrive_at: form.arriveAt, pnr: form.pnr || null, route_from: routeFrom, route_to: routeTo, operator: String(form.operator || "").trim() || null };

      // Riattivazione automatica: un annuncio 'expired' con le date ora
      // corrette (di nuovo nel futuro) torna 'active' da solo al salvataggio
      // — stessa reversibilità già prevista per 'paused'. Il toggle rapido
      // pausa/riprendi di ProfileScreen esclude apposta 'expired' (non può
      // sapere se le date sono state sistemate): il ripristino passa sempre
      // da qui, modificando le date.
      if (mode === "edit" && String(originalStatusRef.current || "").toLowerCase() === "expired") {
        const stillInFuture = form?.type === "hotel"
          ? (() => { const d = parseISODate(normalizeDateStr(form.checkIn)); return !!d && d >= new Date(new Date().toDateString()); })()
          : (() => { const d = parseISODateTime(form.departAt); return !!d && d >= new Date(); })();
        if (stillInFuture) payload.status = "active";
      }

      let publishedIds = [];
      if (mode === "edit") {
        const res = await updateListing(idForUpdate, payload);
        if (res?.error) throw res.error;
        publishedIds = [idForUpdate];
        Alert.alert(t("editListing.savedTitle", "Modifiche salvate"), t("editListing.savedMsg", "L’annuncio è stato aggiornato."));
      } else {
        if (splitDetected) {
          const baseTitle = String(payload.title || '').trim();
          const p1 = { ...payload, title: baseTitle ? `${baseTitle} (1 di 2)` : baseTitle };
          const p2 = { ...payload, title: baseTitle ? `${baseTitle} (2 di 2)` : baseTitle };
          const r1 = await insertListing(p1);
          const r2 = await insertListing(p2);
          if (r1?.error) throw r1.error;
          if (r2?.error) throw r2.error;
          await flushPendingPhotos(r1?.id); // le foto vanno solo sul primo dei due annunci
          await AsyncStorage.removeItem(DRAFT_KEY);
          publishedIds = [r1?.id, r2?.id];
          Alert.alert(t("createListing.splitPublishedTitle", "Pubblicati 2 annunci"), t("createListing.splitPublishedMsg", "Sono stati pubblicati due annunci separati con lo stesso prezzo. Puoi modificare i prezzi in seguito."));
        } else {
          const res = await insertListing(payload);
          if (res?.error) throw res.error;
          await flushPendingPhotos(res?.id);
          await AsyncStorage.removeItem(DRAFT_KEY);
          publishedIds = [res?.id];
          Alert.alert(t("createListing.publishedTitle", "Pubblicato!"), t("createListing.publishedMsg", "Il tuo annuncio è stato pubblicato con successo."));
        }
      }

      // Ricalcolo match fire-and-forget: pubblicare/aggiornare un annuncio
      // rigenera i tuoi suggerimenti "Per te" senza che tu debba aprire a mano
      // la schermata Suggeriti (che prima era l'UNICO punto da cui partiva il
      // ricalcolo — se la striscia "Per te" era vuota, non era raggiungibile).
      recomputeAIAndSnapshot().catch(() => {});
      // Matching PROATTIVO: aggiorna anche il "Per te" degli ALTRI utenti per
      // cui questo annuncio è un buon match (deterministico, nessun costo AI),
      // così il nuovo annuncio emerge subito senza che loro debbano ricalcolare.
      publishedIds.filter(Boolean).forEach((lid) => { propagateListing(lid).catch(() => {}); });

      initialJsonRef.current = JSON.stringify(form);
      onDirtyChange(false);
      navigation.goBack();
    } catch (e) {
      // Backstop DB: duplicato (errcode 23505 dal trigger) o tetto prezzo
      // (chk_price_le_purchase) — messaggi dedicati invece del generico.
      const emsg = String(e?.message || "").toLowerCase();
      const ecode = e?.code || e?.details || "";
      if (emsg.includes("duplicate active listing") || ecode === "23505") {
        Alert.alert(
          t("createListing.dupExactTitle", "Annuncio già pubblicato"),
          t("createListing.dupExactMsg", "Hai già un annuncio attivo identico. Modifica o rimuovi quello esistente invece di pubblicarne un altro uguale.")
        );
      } else if (emsg.includes("chk_price_le_purchase")) {
        Alert.alert(
          t("common.error", "Errore"),
          t("createListing.errors.priceAbovePurchaseShort", "Il prezzo di vendita non può superare quello di acquisto.")
        );
      } else {
        Alert.alert(
          t("common.error", "Errore"),
          mode === "edit"
            ? t("editListing.saveError", "Impossibile salvare le modifiche.")
            : t("createListing.publishError", "Impossibile pubblicare l’annuncio.")
        );
      }
    } finally {
      setPublishing(false);
      onSubmitEnd();
    }
  };

  /* ---------- DRAFT ---------- */
  const onSaveDraft = async () => {
    if (mode === "edit") {
      Alert.alert(t("createListing.draftUnavailableTitle", "Bozza non disponibile"), t("createListing.draftUnavailableMsg", "Salva direttamente le modifiche."));
      return;
    }
    try {
      setSaving(true);
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      await new Promise((r) => setTimeout(r, 350));
      Alert.alert(t("createListing.draftSavedTitle", "Bozza salvata"), t("createListing.draftSavedMsg", "Puoi riprenderla in qualsiasi momento."));
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.draftSaveError", "Non sono riuscito a salvare la bozza."));
    } finally {
      setSaving(false);
    }
  };

  /* ---------- AI IMPORT ---------- */
  const openImport = () => setImportSheet(true);
  const closeImport = () => setImportSheet(false);

  const handlePNRImport = async () => {
    const code = String(pnrInput || "").trim();
    if (!code) {
      Alert.alert(t("createListing.pnrMissingTitle", "PNR mancante"), t("createListing.pnrMissingMsg", "Inserisci un codice PNR o biglietto."));
      return;
    }
    try {
      setImportBusy(true);
      const data = await aiImportFromPNR(code);
      applyImportedData(data);
      closeImport();
      Alert.alert(t("createListing.aiImportTitle", "AI Import"), t("createListing.aiImportSuccess", "Dati importati correttamente."));
      goToManualStep(1);
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.aiImportError", "Impossibile importare dal PNR."));
    } finally {
      setImportBusy(false);
    }
  };

  const [cameraPermissionState, setCameraPermissionState] = useState(null);
  useEffect(() => {
    setCameraPermissionState(cameraPermission?.granted === true);
  }, [cameraPermission?.granted]);

  const requestQrPermissionAndOpen = async () => {
    try {
      if (!cameraPermission || cameraPermission.granted !== true) {
        const { granted } = await requestCameraPermission();
        if (!granted) {
          Alert.alert(t("createListing.cameraDeniedTitle", "Permesso negato"), t("createListing.cameraDeniedMsg", "Per usare lo scanner, consenti l’accesso alla fotocamera."));
          return;
        }
      }
      setQrVisible(true);
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.cameraRequestError", "Impossibile richiedere i permessi fotocamera."));
    }
  };

  const onQrScanned = async ({ data }) => {
    try {
      setImportBusy(true);
      const parsed = await aiImportFromQR(data);
      applyImportedData(parsed);
      setQrVisible(false);
      closeImport();
      Alert.alert(t("createListing.aiImportTitle", "AI Import"), t("createListing.aiImportFromQr", "Dati importati dal QR."));
      goToManualStep(1);
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.qrImportError", "Import da QR non riuscito."));
    } finally {
      setImportBusy(false);
    }
  };

  const applyImportedData = (data) => {
    if (!data || typeof data !== "object") return;
    if (data.type === "train") {
      const [impFrom, impTo] = splitRoute(data.location);
      update({
        type: "train",
        title: data.title ?? "",
        location: data.location ?? "",
        routeFrom: impFrom || "",
        routeTo: impTo || "",
        departAt: data.departAt ?? "",
        arriveAt: data.arriveAt ?? "",
        isNamedTicket: !!data.isNamedTicket,
        gender: data.gender ?? "",
        pnr: data.pnr ?? "",
        operator: data.provider ?? "",
        checkIn: "",
        checkOut: "",
        price: data.price ?? "",
        description: data.description ?? "",
      });
    } else {
      update({
        type: "hotel",
        cercoVendo: "VENDO",
        title: data.title ?? "",
        location: data.location ?? "",
        checkIn: data.checkIn ?? "",
        checkOut: data.checkOut ?? "",
        departAt: "",
        arriveAt: "",
        isNamedTicket: false,
        gender: "",
        pnr: "",
        price: data.price ?? "",
        description: data.description ?? "",
      });
    }
  };

  // Import da testo libero (conferma di prenotazione incollata): a
  // differenza di QR/PNR (mock locale, vedi aiImportFromPNR/aiImportFromQR
  // sopra) questo passa davvero dal backend AI (stesso parser di "Compila
  // con AI", parseListingFromTextAI -> /ai/parse-description), che ora
  // riconosce anche il fornitore. cercoVendo forzato a VENDO: una conferma
  // reale è sempre un bene reale da vendere, mai una richiesta (CERCO).
  const handleConfirmationImport = async () => {
    const text = String(confirmationText || "").trim();
    if (text.length < 20) {
      Alert.alert(
        t("createListing.confirmationMissingTitle", "Testo mancante"),
        t("createListing.confirmationMissingMsg", "Incolla il testo della conferma di prenotazione (almeno qualche riga).")
      );
      return;
    }
    try {
      setImportBusy(true);
      const parsed = await parseListingFromTextAI(text, locale);
      applyImportedData(parsed);
      update({ cercoVendo: "VENDO" });
      setConfirmationText("");
      closeImport();
      const provider = String(parsed?.provider || "").trim();
      Alert.alert(
        t("createListing.aiImportTitle", "AI Import"),
        provider
          ? t("createListing.aiImportFromTextWithProvider", "Dati importati dalla conferma. Fornitore rilevato: {provider}.", { provider })
          : t("createListing.aiImportFromText", "Dati importati dalla conferma.")
      );
      goToManualStep(1);
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.confirmationImportError", "Impossibile leggere la conferma. Riprova o compila i campi a mano."));
    } finally {
      setImportBusy(false);
    }
  };

  // Import da PDF del biglietto (assist anti-bagarinaggio): l'AI legge il
  // documento, precompila i campi e — punto chiave — il prezzo estratto è il
  // prezzo REALE pagato: finisce nel campo "prezzo di acquisto" (il tetto di
  // vendita). Se l'utente aveva dichiarato un prezzo di acquisto diverso da
  // quello del documento, la discrepanza viene segnalata. È un assist, non
  // una prova di autenticità: il PDF resta falsificabile, il vincolo duro è
  // il CHECK a DB (price <= purchase_price).
  const handlePdfImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res?.canceled) return;
      const asset = res?.assets?.[0];
      if (!asset?.uri) return;

      setImportBusy(true);

      let b64 = null;
      if (Platform.OS === "web") {
        if (asset.file) {
          b64 = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result).split(",")[1] || null);
            fr.onerror = reject;
            fr.readAsDataURL(asset.file);
          });
        } else if (String(asset.uri).startsWith("data:")) {
          b64 = String(asset.uri).split(",")[1] || null;
        }
      } else {
        b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
      }
      if (!b64) throw new Error("read failed");

      // prezzo di acquisto dichiarato PRIMA dell'import: serve al confronto
      const declared = parseLocalizedNumber(String(form.purchasePrice || "").trim());

      const parsed = await parseListingFromPdfAI(b64, locale);
      applyImportedData(parsed);

      // Una conferma/biglietto reale è sempre un bene da vendere (mai CERCO)
      const patch = { cercoVendo: "VENDO" };
      const pdfPrice = parsed?.price != null ? Number(String(parsed.price).replace(",", ".")) : NaN;
      if (Number.isFinite(pdfPrice) && pdfPrice > 0) {
        patch.purchasePrice = String(pdfPrice);
      }
      update(patch);
      closeImport();

      if (Number.isFinite(pdfPrice) && pdfPrice > 0 && Number.isFinite(declared) && declared !== pdfPrice) {
        Alert.alert(
          t("createListing.pdfPriceMismatchTitle", "Prezzo diverso dal documento"),
          t("createListing.pdfPriceMismatchMsg", "Nel PDF risulta un prezzo pagato di {pdf}€, ma avevi dichiarato {declared}€. Ho aggiornato il prezzo di acquisto col valore del documento.", { pdf: pdfPrice, declared })
        );
      } else {
        const provider = String(parsed?.provider || "").trim();
        Alert.alert(
          t("createListing.aiImportTitle", "AI Import"),
          provider
            ? t("createListing.aiImportFromTextWithProvider", "Dati importati dalla conferma. Fornitore rilevato: {provider}.", { provider })
            : t("createListing.aiImportFromPdf", "Dati importati dal PDF del biglietto.")
        );
      }
      goToManualStep(1);
    } catch (e) {
      Alert.alert(
        t("common.error", "Errore"),
        e?.message?.includes?.("413") || /troppo grande/i.test(String(e?.message || ""))
          ? t("createListing.pdfTooLarge", "PDF troppo grande (max ~6MB).")
          : t("createListing.pdfImportError", "Impossibile leggere il PDF. Riprova o compila i campi a mano.")
      );
    } finally {
      setImportBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /* ---------- UI ---------- */
  // Per un "Cerco" il campo prezzo rappresenta il BUDGET MASSIMO (quanto sei
  // disposto a pagare), non un prezzo di vendita. In Fase 2 l'algoritmo di
  // match userà questo valore come tetto: un Vendo dentro budget alza il match.
  const isCerco = String(form.cercoVendo || "").toUpperCase() === "CERCO";
  // "Opzioni avanzate" si apre da sola se contiene un errore, così un campo
  // obbligatorio (es. genere per un nominativo) non resta nascosto.
  const advancedForceOpen = !!(errors?.gender || errors?.purchasePrice);
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['left','right','bottom']}>
      {phase === "intro" ? (
      /* ===== SCHERMATA 1: Tipo/Titolo + import/AI (favorisce l'automatico) ===== */
      <View style={styles.topPanel}>
        <View style={styles.topHeaderRow}>
          <Text style={styles.topTitle}>{t("createListing.step1", "Dati principali")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TrustScoreBadge score={trustData?.trustScore} />
            <TrustInfo />
          </View>
        </View>

        {/* Import-first: la strada maestra per chi VENDE un biglietto reale è
            importarlo (QR/PDF/PNR/conferma) e lasciare che l'AI compili quasi
            tutto — molto meno faticoso della compilazione manuale. Prima
            l'import era una piccola icona persa nella toolbar, con lo stesso
            peso del manuale; qui è un invito esplicito in cima. Solo in
            creazione e per un VENDO (un CERCO non ha un biglietto da importare). */}
        {mode !== "edit" && !isCerco ? (
          <TouchableOpacity style={styles.importCard} onPress={openImport} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={t("createListing.importFirstCta", "Importa il biglietto")}>
            <MaterialCommunityIcons name="ticket-confirmation-outline" size={22} color={theme.colors.accentOn} />
            <View style={{ flex: 1 }}>
              <Text style={styles.importCardTitle}>{t("createListing.importFirstTitle", "Hai già il biglietto? Importalo")}</Text>
              <Text style={styles.importCardText}>{t("createListing.importFirstText", "Da QR, PDF, PNR o conferma di prenotazione: compiliamo noi quasi tutto.")}</Text>
            </View>
            <AntDesign name="right" size={16} color={theme.colors.accentOn} />
          </TouchableOpacity>
        ) : null}

        {/* Tipo, Tipo annuncio e Titolo: spostati qui (prima erano più in
            basso, nella prima pagina scorrevole) così sono visibili senza
            scroll appena si apre lo schermo — sono gli unici campi
            bloccanti per andare avanti. La Descrizione (facoltativa) è
            scesa nella pagina scorrevole subito sotto, insieme alla Foto. */}
        <View style={styles.row2}>
          <View style={styles.col}>
            <Text style={styles.label}>{t("createListing.type", "Tipo")}</Text>
            <View style={styles.segment}>
              {TYPES.map((tt) => {
                const active = form?.type === tt.key;
                return (
                  <TouchableOpacity key={tt.key} onPress={() => onChangeType(tt.key)} style={[styles.segBtn, active && styles.segBtnActive]}>
                    <Text style={[styles.segText, active && styles.segTextActive]}>{t(tt.labelKey, tt.key === "hotel" ? "Hotel" : "Treno")}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>{t("createListing.cercoVendoLabel", "Tipo annuncio")}</Text>
            <View style={styles.segment}>
              {["CERCO","VENDO"].map((cv) => {
                const active = form.cercoVendo === cv;
                return (
                  <TouchableOpacity key={cv} onPress={() => onChangeCercoVendo(cv)} style={[styles.segBtn, active && styles.segBtnActive]}>
                    <Text style={[styles.segText, active && styles.segTextActive]}>{cv === "CERCO" ? t("createListing.cerco","Cerco") : t("createListing.vendo","Vendo")}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Chiarisce il gergo Cerco/Vendo (e cosa significa il prezzo). */}
        <Text style={styles.cvHelper}>
          {isCerco
            ? t("createListing.cercoHelper", "Cerchi un biglietto: il prezzo indicato sarà il tuo budget massimo.")
            : t("createListing.vendoHelper", "Vendi un biglietto o una prenotazione che possiedi.")}
        </Text>

        <View style={styles.labelRow}>
          <Text style={styles.label}>{t("createListing.titleLabel", "Titolo *")}</Text>
          <TouchableOpacity accessibilityLabel="Modifica titolo" onPress={() => toggleEditable("title")} style={styles.iconBtn}>
            <AntDesign name={editableFields.title ? "unlock" : "edit"} size={18} color={theme.colors.boardingText || "#111827"} />
          </TouchableOpacity>
        </View>
        <TextInput
          editable={editableFields.title}
          selectTextOnFocus={editableFields.title}
          value={form.title}
          onChangeText={(v) => update({ title: v })}
          onBlur={() => markTouched("title")}
          placeholder={
            form?.type === "hotel"
              ? t("createListing.titlePlaceholderHotel", "Es. Camera doppia vicino Duomo")
              : t("createListing.titlePlaceholderTrain", "Es. Milano → Roma (FR 9520)")
          }
          style={[styles.input, !editableFields.title && styles.inputDisabled, fieldError("title") && styles.inputError]}
          placeholderTextColor={theme.colors.textMuted}
        />
        {!!fieldError("title") && <Text style={styles.errorText}>{fieldError("title")}</Text>}

        {/* Descrizione: alternativa all'Import (yellow box qui sopra), non un
            passo successivo — chi NON ha un documento scansionabile può
            descrivere il biglietto a parole e lasciare che "Compila con AI"
            lo interpreti. L'etichetta lo rende esplicito, altrimenti sembra
            un campo obbligatorio in mezzo al flusso. */}
        <Text style={styles.sectionAltLabel}>{t("createListing.descriptionAltTitle", "Non hai un documento a portata di mano? Descrivilo a parole")}</Text>
        <Text style={styles.label}>{t("createListing.description", "Descrizione")}</Text>
        <TextInput
          value={form.description}
          onChangeText={(v) => update({ description: v })}
          placeholder={t("createListing.descriptionPlaceholder", "Dettagli utili per chi è interessato…")}
          style={[styles.input, styles.multiline]}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <Text style={styles.note}>{t("createListing.descriptionAiHint", "Usata da \"Compila con AI\" per riconoscere tratta, date e prezzo.")}</Text>

        {/* Strumenti AI: "Compila con AI" resta un'azione a tutta larghezza
            (è quella più usata), le altre tre diventano icone sulla stessa
            riga invece di una griglia 2×2 — libera spazio verticale sopra
            ai campi obbligatori. */}
        <View style={styles.aiToolbar}>
          <View style={{ flex: 1 }}>
            <AIPill
              title={t("createListing.aiFill", "Compila con AI")}
              onPress={onAiFill}
              disabled={loadingAI || aiFilling || publishing || saving}
              loading={aiFilling}
              dark
              iconLib="mci"
              iconName="auto-fix"
            />
          </View>
          {/* Icona QR rimossa: ridondante col box giallo "Importa" qui sopra,
              che apre la stessa identica modale (openImport). "Check AI" si
              è spostata nello Step 2: valuta anche prezzo/tratta/date, che
              vivono lì — lanciarla da qui valuterebbe un annuncio ancora
              incompleto. */}
          <AIIconButton
            accessibilityLabel={t("common.clear", "Pulisci")}
            label={t("common.clear", "Pulisci")}
            onPress={clearAll}
            disabled={loadingAI || aiFilling || publishing || saving}
            iconLib="mci"
            iconName="broom"
          />
        </View>

        {/* Micro log + progress bar: qui riflette solo "Compila con AI"
            (unica azione AI rimasta in questo step). */}
        {showMicroLog && (
          <View style={styles.microWrap}>
            {microLog.map((line, idx) => (
              <Text key={idx} style={styles.microLine}>• {line}</Text>
            ))}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
            </View>
          </View>
        )}

        {/* "Inserisci manualmente": link leggero in fondo, non più un
            bottone pieno a metà flusso — è l'alternativa a Import/Compila
            con AI, non un passo obbligato dopo. Segna Titolo come
            "toccato" così, se è vuoto, l'errore compare al ritorno su
            questo step (stesso comportamento di "Avanti"). */}
        <TouchableOpacity
          onPress={() => { markTouched("title"); setPhase("manual"); }}
          style={styles.manualEntryLink}
          accessibilityRole="button"
          accessibilityLabel={t("createListing.manualEntry", "Inserisci manualmente")}
        >
          <Text style={styles.manualEntryLinkText}>{t("createListing.manualEntry", "Inserisci manualmente")}</Text>
          <AntDesign name="right" size={12} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>
      ) : (
      /* ===== SCHERMATA 2 (Step "manual"): tutti gli altri campi, a schermo
         intero — inclusa "Check AI" (valuta prezzo/tratta/date, che vivono
         solo qui). Raggiunta dal link "Inserisci manualmente" o in
         automatico dopo Import/Compila con AI (goToManualStep). Freccia
         indietro per tornare alla Schermata 1 e correggere Tipo/Titolo. */
      <>
      <View style={styles.topPanel}>
        <View style={styles.topHeaderRow}>
          <TouchableOpacity
            onPress={() => setPhase("intro")}
            accessibilityRole="button"
            accessibilityLabel={t("common.back", "Indietro")}
            style={{ paddingRight: 10 }}
          >
            <AntDesign name="left" size={18} color={theme.colors.boardingText} />
          </TouchableOpacity>
          <Text style={[styles.topTitle, { flex: 1 }]}>{t("createListing.step2", "Dettagli & pubblicazione")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TrustScoreBadge score={trustData?.trustScore} />
            <TrustInfo />
          </View>
        </View>
      </View>

      {/* ===== SOTTO: SLIDER ORIZZONTALE A PAGINE ===== */}
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <View style={styles.sliderWrap} onLayout={(e) => setSliderW(e.nativeEvent.layout.width)}>
          {/* Tab numerati: navigazione libera, la validazione blocca solo
              in fase di pubblicazione (come già faceva onPublishOrSave). */}
          <View style={styles.stepRow}>
            {[0, 1].map((idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <View style={[styles.stepBar, slideIndex >= idx && styles.stepBarActive]} />}
                <TouchableOpacity
                  onPress={() => goToSlide(idx)}
                  style={[styles.stepDot, slideIndex >= idx && styles.stepDotActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Vai al passo ${idx + 1}`}
                >
                  <Text style={[styles.stepDotText, slideIndex >= idx && styles.stepDotTextActive]}>{idx + 1}</Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>

          {/* Pagine orizzontali */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={() => Keyboard.dismiss()}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            scrollEnabled={!isKbOpen}
            // onMomentumScrollEnd/onScrollEndDrag bastano su iOS/Android, ma
            // react-native-web NON li implementa affatto (ScrollViewBase.js
            // del pacchetto: gestisce solo `onScroll`, il resto degli event
            // prop RN-only viene spalmato su un <div> che non li capisce e
            // non li emette mai) — su web quei due handler sono no-op, ecco
            // perché lì i pallini restavano fermi anche dopo il primo fix.
            // onScroll invece è implementato su TUTTE le piattaforme (su web
            // scatta anche a scroll fermo, grazie al debounce interno del
            // pacchetto), quindi è l'unico modo affidabile ovunque.
            onMomentumScrollEnd={(e) => setSlideIndexFromOffset(e.nativeEvent)}
            onScrollEndDrag={(e) => setSlideIndexFromOffset(e.nativeEvent)}
            onScroll={(e) => setSlideIndexFromOffset(e.nativeEvent)}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 0 }}
          >
            {/* ===== SLIDE 1 ===== */}
            <View style={[styles.slide, { width: sliderW }]}>
              <View style={styles.slideCard}>
                <ScrollView
                  contentContainerStyle={{ paddingBottom: FOOTER_H + 40 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {/* Località / Rotta */}
                  {form?.type === "train" ? (
                    <>
                      <View style={styles.labelRow}>
                        <Text style={styles.label}>{t("createListing.locationLabelTrain", "Tratta *")}</Text>
                        <TouchableOpacity accessibilityLabel="Modifica tratta" onPress={() => toggleEditable("location")} style={styles.iconBtn}>
                          <AntDesign name={editableFields.location ? "unlock" : "edit"} size={18} color={theme.colors.boardingText || "#111827"} />
                        </TouchableOpacity>
                      </View>
                      {/* Due campi separati Da/A con freccia fissa: niente più
                          frecce da digitare a mano nella tratta. */}
                      <View style={styles.routeRow}>
                        <StationAutocomplete
                          style={{ flex: 1, minWidth: 0 }}
                          editable={editableFields.location}
                          value={form.routeFrom}
                          onChangeText={(v) => update({ routeFrom: v })}
                          onBlur={() => markTouched("routeFrom")}
                          placeholder={t("createListing.routeFromPlaceholder", "Da: es. Milano Centrale")}
                          inputStyle={[styles.input, !editableFields.location && styles.inputDisabled, fieldError("routeFrom") && styles.inputError]}
                        />
                        <Text style={styles.routeArrow}>→</Text>
                        <StationAutocomplete
                          style={{ flex: 1, minWidth: 0 }}
                          editable={editableFields.location}
                          value={form.routeTo}
                          onChangeText={(v) => update({ routeTo: v })}
                          onBlur={() => markTouched("routeTo")}
                          placeholder={t("createListing.routeToPlaceholder", "A: es. Roma Termini")}
                          inputStyle={[styles.input, !editableFields.location && styles.inputDisabled, fieldError("routeTo") && styles.inputError]}
                        />
                      </View>
                      {!!fieldError("routeFrom") && <Text style={styles.errorText}>{fieldError("routeFrom")}</Text>}
                      {!!fieldError("routeTo") && <Text style={styles.errorText}>{fieldError("routeTo")}</Text>}
                    </>
                  ) : (
                    <>
                      <Text style={styles.label}>{t("createListing.locationLabelHotel", "Località *")}</Text>
                      <TextInput
                        value={form.location}
                        onChangeText={(v) => update({ location: v })}
                        onBlur={() => markTouched("location")}
                        placeholder={t("createListing.locationPlaceholderHotel", "Es. Milano, Navigli")}
                        editable={!hotelLocLocked}
                        selectTextOnFocus={!hotelLocLocked && editableFields.location}
                        style={[styles.input, hotelLocLocked && styles.inputDisabled, fieldError("location") && styles.inputError]}
                        placeholderTextColor={theme.colors.textMuted}
                      />
                      {!!fieldError("location") && <Text style={styles.errorText}>{fieldError("location")}</Text>}
                    </>
                  )}

                  {/* Date */}
                  {form?.type === "hotel" ? (
                    <>
                      <View style={styles.labelRow}>
                        <Text style={styles.label}>{t("createListing.checkIn", "Check-in")}</Text>
                        <TouchableOpacity accessibilityLabel="Modifica check-in" onPress={() => toggleEditable("checkIn")} style={styles.iconBtn}>
                          <AntDesign name={editableFields.checkIn ? "unlock" : "edit"} size={18} color={theme.colors.boardingText || "#111827"} />
                        </TouchableOpacity>
                      </View>
                      <View style={[styles.fieldContainer, { opacity: checkInLocked ? 0.7 : 1 }]}>
                        <DateField label="" required value={form.checkIn} onChange={(v) => update({ checkIn: normalizeDateStr(v) })} onBlur={() => markTouched("checkIn")} error={fieldError("checkIn")} disabled={checkInLocked} />
                        {checkInLocked && <View pointerEvents="auto" style={styles.disabledOverlay} /> }
                      </View>
                      <View style={styles.labelRow}>
                        <Text style={styles.label}>{t("createListing.checkOut", "Check-out")}</Text>
                        <TouchableOpacity accessibilityLabel="Modifica check-out" onPress={() => toggleEditable("checkOut")} style={styles.iconBtn}>
                          <AntDesign name={editableFields.checkOut ? "unlock" : "edit"} size={18} color={theme.colors.boardingText || "#111827"} />
                        </TouchableOpacity>
                      </View>
                      <View style={[styles.fieldContainer, { opacity: checkOutLocked ? 0.7 : 1 }]}>
                        <DateField label="" required value={form.checkOut} onChange={(v) => update({ checkOut: normalizeDateStr(v) })} onBlur={() => markTouched("checkOut")} error={fieldError("checkOut")} disabled={checkOutLocked} />
                        {checkOutLocked && <View pointerEvents="auto" style={styles.disabledOverlay} /> }
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.labelRow}>
                        <Text style={styles.label}>{t("createListing.departAt", "Partenza (data e ora)")}</Text>
                        <TouchableOpacity accessibilityLabel="Modifica partenza" onPress={() => toggleEditable("departAt")} style={styles.iconBtn}>
                          <AntDesign name={editableFields.departAt ? "unlock" : "edit"} size={18} color={theme.colors.boardingText || "#111827"} />
                        </TouchableOpacity>
                      </View>
                      <View style={[styles.fieldContainer, { opacity: departLocked ? 0.7 : 1 }]}>
                        <DateTimeField label="" required value={form.departAt} onChange={(v) => update({ departAt: v })} onBlur={() => markTouched("departAt")} error={fieldError("departAt")} disabled={departLocked} />
                        {departLocked && <View pointerEvents="auto" style={styles.disabledOverlay} /> }
                      </View>
                      <View style={styles.labelRow}>
                        <Text style={styles.label}>{t("createListing.arriveAt", "Arrivo (data e ora)")}</Text>
                        <TouchableOpacity accessibilityLabel="Modifica arrivo" onPress={() => toggleEditable("arriveAt")} style={styles.iconBtn}>
                          <AntDesign name={editableFields.arriveAt ? "unlock" : "edit"} size={18} color={theme.colors.boardingText || "#111827"} />
                        </TouchableOpacity>
                      </View>
                      <View style={[styles.fieldContainer, { opacity: arriveLocked ? 0.7 : 1 }]}>
                        <DateTimeField label="" required value={form.arriveAt} onChange={(v) => update({ arriveAt: v })} onBlur={() => markTouched("arriveAt")} error={fieldError("arriveAt")} disabled={arriveLocked} />
                        {arriveLocked && <View pointerEvents="auto" style={styles.disabledOverlay} /> }
                      </View>
                    </>
                  )}

                  {/* Foto: prima era una slide a sé (quasi vuota, solo per
                      caricare al massimo 2 foto) — accorpata qui con
                      Località/Date, così lo Step 2 passa da 3 pagine a 2. */}
                  <Text style={styles.label}>
                    {t("createListing.photos", "Foto")} ({totalPhotoCount}/{MAX_PHOTOS})
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                    {existingPhotos.map((img) => (
                      <View key={img.id} style={{ width: 72, height: 72 }}>
                        <Image source={{ uri: img.url }} style={{ width: 72, height: 72, borderRadius: 10 }} />
                        <TouchableOpacity
                          onPress={() => removeExistingPhoto(img)}
                          style={styles.photoRemoveBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.photoRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {pendingPhotos.map((a, idx) => (
                      <View key={`${a.uri}-${idx}`} style={{ width: 72, height: 72 }}>
                        <Image source={{ uri: a.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} />
                        <TouchableOpacity
                          onPress={() => removePendingPhoto(idx)}
                          style={styles.photoRemoveBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.photoRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {totalPhotoCount < MAX_PHOTOS && (
                    <TouchableOpacity
                      onPress={pickPhotos}
                      disabled={photoBusy}
                      style={styles.photoAddBtn}
                    >
                      {photoBusy ? (
                        <ActivityIndicator />
                      ) : (
                        <Text style={{ fontSize: 24, color: theme.colors.boardingText || "#111827" }}>＋</Text>
                      )}
                    </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.note}>
                    {t("createListing.photosHint", `Massimo ${MAX_PHOTOS} foto reali: solo il biglietto (treno) o la stanza/prenotazione (hotel). Foto non pertinenti abbassano l'affidabilità.`, { n: MAX_PHOTOS })}
                  </Text>

                  <View style={{ height: 2 }} />
                </ScrollView>
              </View>
            </View>

            {/* ===== SLIDE 2 ===== */}
            <View style={[styles.slide, { width: sliderW }]}>
              <View style={styles.slideCard}>
                <ScrollView
                  contentContainerStyle={{ paddingBottom: FOOTER_H + 40 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {/* Opzioni avanzate: raccoglie i campi tecnici/opzionali
                      (particolari treno, prezzo di acquisto) per non
                      appesantire il modulo — l'import compila già questi campi
                      da solo. Si apre da sola se dentro c'è un errore. */}
                  {(form?.type === "train" || !isCerco) ? (
                    <TouchableOpacity
                      style={styles.advancedHeader}
                      onPress={() => setAdvancedOpen((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel={t("createListing.advancedOptions", "Opzioni avanzate")}
                    >
                      <Text style={styles.advancedHeaderText}>{t("createListing.advancedOptions", "Opzioni avanzate")}</Text>
                      <AntDesign name={(advancedOpen || advancedForceOpen) ? "up" : "down"} size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                  ) : null}

                  {/* Particolari treno (se serve) */}
                  {form?.type === "train" && (advancedOpen || advancedForceOpen) && (
                    <View style={styles.subCard}>
                      <Text style={styles.subCardTitle}>{t("createListing.train.particulars", "Dati particolari treno")}</Text>

                      <View style={styles.switchRow}>
                        <Text style={styles.labelInline}>{t("createListing.train.namedTicket", "Biglietto nominativo")}</Text>
                        <Switch
                          value={form.isNamedTicket}
                          onValueChange={(v) => {
                            if (!v) update({ isNamedTicket: false, gender: "" });
                            else update({ isNamedTicket: true });
                          }}
                        />
                      </View>
                      <Text style={styles.noteSmall}>{t("createListing.train.genderNote", "Se attivo, indica il genere presente sul biglietto.")}</Text>

                      {form.isNamedTicket && (
                        <>
                          <Text style={[styles.label, { marginTop: 10 }]}>{t("createListing.train.genderLabel", "Genere *")}</Text>
                          <View style={styles.segment}>
                            {["M", "F"].map((g) => {
                              const active = form.gender === g;
                              return (
                                <TouchableOpacity key={g} onPress={() => update({ gender: g })} style={[styles.segBtn, active && styles.segBtnActive]}>
                                  <Text style={[styles.segText, active && styles.segTextActive]}>{g}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          {!!fieldError("gender") && <Text style={styles.errorText}>{fieldError("gender")}</Text>}
                        </>
                      )}

                      <Text style={[styles.label, { marginTop: 10 }]}>{t("createListing.train.pnrLabel", "PNR (opzionale)")}</Text>
                      <TextInput
                        value={form.pnr}
                        onChangeText={(v) => update({ pnr: v })}
                        placeholder={t("createListing.train.pnrPlaceholder", "Es. ABCDEF")}
                        style={styles.input}
                        autoCapitalize="characters"
                        placeholderTextColor={theme.colors.textMuted}
                      />
                      <Text style={styles.note}>🔒 {t("createListing.train.pnrPrivacy", "Il PNR non sarà visibile nell’annuncio.")}</Text>

                      {/* Operatore: ricavato dall'AI (Compila AI, import PDF/
                          conferma), mai richiesto esplicitamente — qui solo
                          per controllare/correggere. Mostrato poi SOLO nel
                          dettaglio annuncio, mai nelle card di Esplora. */}
                      <Text style={[styles.label, { marginTop: 10 }]}>{t("createListing.train.operatorLabel", "Operatore (rilevato automaticamente)")}</Text>
                      <TextInput
                        value={form.operator}
                        onChangeText={(v) => update({ operator: v })}
                        placeholder={t("createListing.train.operatorPlaceholder", "Es. Trenitalia, Italo")}
                        style={styles.input}
                        placeholderTextColor={theme.colors.textMuted}
                      />
                      <Text style={styles.note}>{t("createListing.train.operatorHint", "Ricavato da Compila AI o dall'import del biglietto/conferma. Puoi correggerlo se non è esatto.")}</Text>
                    </View>
                  )}

                  {/* Prezzo di acquisto (solo Vendo): anti-bagarinaggio. Il
                      prezzo di vendita non potrà superarlo. Dentro "Opzioni
                      avanzate". */}
                  {!isCerco && (advancedOpen || advancedForceOpen) && (
                    <>
                      <Text style={styles.label}>{t("createListing.purchasePrice", "Prezzo di acquisto (€)")}</Text>
                      <TextInput
                        value={String(form.purchasePrice)}
                        onChangeText={(v) => update({ purchasePrice: v.replace(",", ".") })}
                        onBlur={() => markTouched("purchasePrice")}
                        placeholder={t("createListing.purchasePricePlaceholder", "Es. 90 — quanto l'hai pagato")}
                        keyboardType="decimal-pad"
                        style={[styles.input, fieldError("purchasePrice") && styles.inputError]}
                        placeholderTextColor={theme.colors.textMuted}
                      />
                      <Text style={styles.note}>
                        {t("createListing.purchasePriceHint", "Per legge non puoi rivendere un biglietto sopra il prezzo pagato: lo useremo come tetto massimo di vendita.")}
                      </Text>
                      {!!fieldError("purchasePrice") && <Text style={styles.errorText}>{fieldError("purchasePrice")}</Text>}
                    </>
                  )}

                  {/* Prezzo (Vendo) / Budget massimo (Cerco) */}
                  <Text style={styles.label}>
                    {isCerco
                      ? t("createListing.budgetMax", "Budget massimo *")
                      : t("createListing.price", "Prezzo *")}
                  </Text>
                  <TextInput
                    value={String(form.price)}
                    onChangeText={(v) => update({ price: v.replace(",", ".") })}
                    onBlur={() => markTouched("price")}
                    placeholder={isCerco
                      ? t("createListing.budgetMaxPlaceholder", "Es. 60 — quanto vuoi pagare al massimo")
                      : t("createListing.pricePlaceholder", "Es. 120")}
                    keyboardType="decimal-pad"
                    style={[styles.input, fieldError("price") && styles.inputError]}
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  {isCerco && (
                    <Text style={styles.note}>
                      {t("createListing.budgetMaxHint", "È il prezzo massimo che sei disposto a pagare: lo useremo per proporti gli annunci più in linea con il tuo budget.")}
                    </Text>
                  )}
                  {!!fieldError("price") && <Text style={styles.errorText}>{fieldError("price")}</Text>}

                  {/* Info + Pulsante Analisi Prezzo con AI */}
                  <View style={styles.infoRow}>
                    <TouchableOpacity onPress={() => setPriceInfoOpen((v) => !v)} style={styles.infoButton}>
                      <AntDesign name="info-circle" size={16} color={theme.colors.boardingText} />
                      <Text style={styles.infoLink}> Info</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={analyzePriceAI} disabled={priceLoading} style={[styles.smallAIButton, priceLoading && {opacity:0.7}]}> 
                      {priceLoading ? <ActivityIndicator color={theme.colors.accentOn} /> : <Text style={styles.smallAIButtonText}>Analisi prezzo con AI</Text>}
                    </TouchableOpacity>
                  </View>
                  {priceInfoOpen && (
                    <Text style={[styles.note, { marginTop: 6 }]}>
                      Questo suggerimento di prezzo è pensato per aiutarti a decidere in autonomia.
                      Considera domanda, urgenza e qualità dell’offerta: sentiti libero di aumentare o ridurre il prezzo.
                    </Text>
                  )}

                  {/* Scambio (B): solo per VENDO — "accetti anche uno scambio?" */}
                  {!isCerco && (
                    <View style={styles.swapBox}>
                      <View style={styles.swapHeaderRow}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Text style={styles.label}>{t("createListing.swap.title", "Accetti anche uno scambio?")}</Text>
                          <Text style={styles.note}>{t("createListing.swap.subtitle", "Oltre alla vendita puoi ricevere in cambio un altro biglietto. Indica cosa cerchi: lo useremo per proporti scambi compatibili.")}</Text>
                        </View>
                        <Switch
                          value={!!form.acceptsSwap}
                          onValueChange={(v) => update({ acceptsSwap: v })}
                          trackColor={{ true: theme.colors.primary }}
                        />
                      </View>
                      {form.acceptsSwap && (
                        <View style={{ marginTop: 10 }}>
                          {form.type === "train" ? (
                            <>
                              <Text style={styles.label}>{t("createListing.swap.wantFrom", "Cerco in cambio — Da")}</Text>
                              <StationAutocomplete
                                value={form.swapWantedFrom}
                                onChangeText={(v) => update({ swapWantedFrom: v })}
                                placeholder={t("createListing.swap.wantFromPh", "Es. Roma")}
                                inputStyle={styles.input}
                              />
                              <Text style={styles.label}>{t("createListing.swap.wantTo", "Cerco in cambio — A")}</Text>
                              <StationAutocomplete
                                value={form.swapWantedTo}
                                onChangeText={(v) => update({ swapWantedTo: v })}
                                placeholder={t("createListing.swap.wantToPh", "Es. Milano")}
                                inputStyle={styles.input}
                              />
                            </>
                          ) : (
                            <>
                              <Text style={styles.label}>{t("createListing.swap.wantLocation", "Cerco in cambio — Località")}</Text>
                              <TextInput
                                value={form.swapWantedLocation}
                                onChangeText={(v) => update({ swapWantedLocation: v })}
                                placeholder={t("createListing.swap.wantLocationPh", "Es. Firenze")}
                                style={styles.input}
                                placeholderTextColor={theme.colors.textMuted}
                              />
                            </>
                          )}
                          <Text style={styles.label}>{t("createListing.swap.note", "Nota (facoltativa)")}</Text>
                          <TextInput
                            value={form.swapWantedNote}
                            onChangeText={(v) => update({ swapWantedNote: v })}
                            placeholder={t("createListing.swap.notePh", "Es. stesse date, anche alta velocità")}
                            style={styles.input}
                            placeholderTextColor={theme.colors.textMuted}
                          />
                        </View>
                      )}
                    </View>
                  )}

                  {/* Check AI: qui, non nello Step 1, perché valuta anche
                      prezzo/tratta/date — campi che vivono solo qui.
                      Parte comunque in automatico alla pubblicazione se non
                      ancora lanciata: questo bottone serve solo per vederne
                      subito l'esito, prima di "Pubblica". */}
                  <View style={styles.checkAiRow}>
                    <AIPill
                      title={t("createListing.checkAiCta", "Check AI")}
                      onPress={onTrustCheck}
                      disabled={trustLoading || loadingAI || aiFilling}
                      loading={loadingAI}
                      subtle
                      iconLib="mci"
                      iconName="shield-check"
                    />
                    <Text style={styles.note}>{t("createListing.checkAiHint", "Verifica affidabilità, prezzo e foto prima di pubblicare. Se non la lanci, parte comunque da sola alla pubblicazione.")}</Text>
                  </View>

                  {showMicroLog && (
                    <View style={styles.microWrap}>
                      {microLog.map((line, idx) => (
                        <Text key={idx} style={styles.microLine}>• {line}</Text>
                      ))}
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
                      </View>
                    </View>
                  )}

                  {lastTrustRunAt > 0 && trustData && (
                    <View style={styles.checkSummary}>
                      <View style={styles.checkSummaryChips}>
                        {trustData.aiAvailable === false && (
                          <View style={[styles.sumChip, styles.sumChipRed]}>
                            <Text style={styles.sumChipText}>{t("createListing.checkAi.aiUnavailable", "Verifica AI non disponibile")}</Text>
                          </View>
                        )}
                        {!!flagsNoImg?.length && (
                          <View style={[styles.sumChip, styles.sumChipYellow]}>
                            <Text style={styles.sumChipText}>{t(flagsNoImg.length === 1 ? "createListing.checkAi.problemsOne" : "createListing.checkAi.problemsMany", `${flagsNoImg.length} problemi`, { n: flagsNoImg.length })}</Text>
                          </View>
                        )}
                        {!!fixesNoImg?.length && (
                          <View style={[styles.sumChip, styles.sumChipGreen]}>
                            <Text style={styles.sumChipText}>{t(fixesNoImg.length === 1 ? "createListing.checkAi.suggestionsOne" : "createListing.checkAi.suggestionsMany", `${fixesNoImg.length} suggerimenti`, { n: fixesNoImg.length })}</Text>
                          </View>
                        )}
                        {splitDetected && (
                          <View style={[styles.sumChip, styles.sumChipBlue]}>
                            <Text style={styles.sumChipText}>{t("createListing.checkAi.twoListings", "2 annunci")}</Text>
                          </View>
                        )}
                        {trustData.aiAvailable !== false && !flagsNoImg?.length && !fixesNoImg?.length && !splitDetected && !trustExplain && (
                          <View style={[styles.sumChip, styles.sumChipGreen]}>
                            <Text style={styles.sumChipText}>{t("createListing.checkAi.noProblems", "Nessun problema rilevato")}</Text>
                          </View>
                        )}
                        {trustData.aiAvailable !== false && !flagsNoImg?.length && !!trustExplain && (
                          <View style={[styles.sumChip, styles.sumChipYellow]}>
                            <Text style={styles.sumChipText} numberOfLines={1}>{trustExplain}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Box Trust */}
                  {splitDetected && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#DBEAFE', borderWidth: 1, borderColor: '#60A5FA' }}>
                      <Text style={{ fontWeight: '800', marginBottom: 6 }}>{t("createListing.checkAi.splitTitle", "Rilevati 2 annunci distinti")}</Text>
                      <Text>{t("createListing.checkAi.splitBasis", `In base alla descrizione: ${splitReason || 'sono stati rilevati due elementi distinti (tratte/orari/hotel).'}`, { reason: splitReason || t("createListing.checkAi.splitFallbackReason", "sono stati rilevati due elementi distinti (tratte/orari/hotel).") })}</Text>
                      <Text style={{ marginTop: 6 }}>{t("createListing.checkAi.splitNote1", "Al momento della pubblicazione verranno creati ")}<Text style={{ fontWeight: '700' }}>{t("createListing.checkAi.splitNoteBold", "due annunci separati")}</Text>{t("createListing.checkAi.splitNote2", " con lo stesso prezzo. Potrai modificare i prezzi in seguito.")}</Text>
                    </View>
                  )}
                  {trustData && trustData.aiAvailable === false && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#F87171" }}>
                      <Text style={{ fontWeight: "800", marginBottom: 4 }}>
                        {t("createListing.aiUnavailableTitle", "Verifica AI non disponibile")}
                      </Text>
                      <Text>
                        {t("createListing.aiUnavailableMsg", "Il punteggio si basa solo sui controlli di base (prezzo, date, coerenza). L'analisi AI del testo e delle foto non è stata eseguita.")}
                      </Text>
                      {/* Dettaglio tecnico SOLO su web (versione di test): all'utente
                          finale dell'app nativa non deve apparire. */}
                      {Platform.OS === "web" && !!trustData.aiUnavailableReason && (
                        <Text style={{ marginTop: 8, fontSize: 12, fontStyle: "italic", color: "#7F1D1D" }}>
                          [debug web] {trustData.aiUnavailableReason}
                        </Text>
                      )}
                    </View>
                  )}

                  {!!flagsNoImg?.length && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#FFF4C5", borderWidth: 1, borderColor: "#FACC15" }}>
                      <Text style={{ fontWeight: "800", marginBottom: 6 }}>{t("createListing.checkAi.problemsTitle", "Possibili problemi")}</Text>
                      {flagsNoImg.map((f, i) => (
                        // Etichetta localizzata per codice; se il codice è ignoto
                        // resta il messaggio del server (già nella lingua utente
                        // per i flag AI, che ora rispondono nella locale scelta).
                        <Text key={i}>• {t(`createListing.checkAi.flags.${f.code}`, f.msg || "")}</Text>
                      ))}
                    </View>
                  )}

                  {!flagsNoImg?.length && !!trustExplain && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#FFF4C5", borderWidth: 1, borderColor: "#FACC15" }}>
                      <Text style={{ fontWeight: "800", marginBottom: 6 }}>{t("createListing.checkAi.whyTitle", "Perché questo punteggio")}</Text>
                      <Text>{trustExplain}</Text>
                    </View>
                  )}

                  {!!fixesNoImg?.length && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#E7F7C5", borderWidth: 1, borderColor: "#84CC16" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontWeight: "800" }}>{t("createListing.checkAi.suggestionsTitle", "Suggerimenti AI")}</Text>
                      </View>
                      <View style={{ height: 6 }} />
                      {fixesNoImg.map((s, i) => (
                        <Text key={i}>• {s.suggestion}</Text>
                      ))}
                    </View>
                  )}

                  <View style={{ marginBottom: 8 }} />
                </ScrollView>
              </View>
            </View>

          </ScrollView>

          {/* Footer azioni */}
          <View style={styles.footer}>
            {slideIndex > 0 ? (
              <TouchableOpacity onPress={onBackPress} style={[styles.footerBtn, styles.footerGhost]}>
                <Text style={[styles.footerText, { color: theme.colors.text }]}>{t("common.back", "Indietro")}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={onSaveDraft} disabled={saving || mode === "edit"} style={[styles.footerBtn, styles.footerGhost, (saving || mode === "edit") && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator /> : <Text style={[styles.footerText, { color: theme.colors.text }]}>{mode === "edit" ? t("editListing.draftDisabled","Bozza disattivata") : t("createListing.saveDraft","Salva bozza")}</Text>}
              </TouchableOpacity>
            )}

            {slideIndex < 1 ? (
              <TouchableOpacity onPress={onNextPress} style={[styles.footerBtn, styles.footerPrimary]}>
                <Text style={[styles.footerText, { color: theme.colors.accentOn }]}>{t("common.next", "Avanti")}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={onPublishOrSave} disabled={publishing} style={[styles.footerBtn, styles.footerPrimary]}>
                {publishing ? <ActivityIndicator color={theme.colors.accentOn} /> : <Text style={[styles.footerText, { color: theme.colors.accentOn }]}>{mode === "edit" ? "Modifica" : t("createListing.publish", "Pubblica")}</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
      </>
      )}

      {/* -------- Modal AI Import -------- */}
      <Modal visible={importSheet} animationType="slide" transparent onRequestClose={closeImport}>
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: "padding", android: undefined })}
          style={styles.sheetBackdrop}
        >
          <ScrollView style={{ width: "100%" }} contentContainerStyle={styles.sheetCard} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{t("createListing.aiImport", "AI Import 1-click")}</Text>
            <Text style={styles.sheetText}>{t("createListing.aiImportDesc", "Importa automaticamente i dati dell’annuncio leggendo un QR code, inserendo il PNR oppure incollando il testo della conferma di prenotazione.")}</Text>

            <View style={{ height: 8 }} />

            <TouchableOpacity onPress={requestQrPermissionAndOpen} style={[styles.sheetBtn, styles.sheetBtnPrimary]}>
              <Text style={[styles.sheetBtnText, { color: "#fff" }]}>{t("createListing.scanQr", "Scansiona QR")}</Text>
            </TouchableOpacity>

            <View style={{ height: 8 }} />

            <TouchableOpacity onPress={handlePdfImport} disabled={importBusy} style={[styles.sheetBtn, styles.sheetBtnGhost, importBusy && { opacity: 0.6 }]}>
              {importBusy ? <ActivityIndicator /> : <Text style={styles.sheetBtnText}>{t("createListing.importFromPdf", "Importa PDF del biglietto")}</Text>}
            </TouchableOpacity>
            <Text style={styles.note}>
              {t("createListing.importFromPdfHint", "L'AI legge il documento e usa il prezzo pagato come prezzo di acquisto (tetto di vendita).")}
            </Text>

            <View style={{ height: 10 }} />
            <Text style={styles.label}>{t("createListing.orEnterPnr", "Oppure inserisci PNR")}</Text>
            <TextInput
              value={pnrInput}
              onChangeText={setPnrInput}
              placeholder={t("createListing.train.pnrPlaceholder", "Es. ABCDEF")}
              autoCapitalize="characters"
              style={styles.input}
              placeholderTextColor={theme.colors.textMuted}
            />
            <TouchableOpacity onPress={handlePNRImport} style={[styles.sheetBtn, styles.sheetBtnGhost]}>
              {importBusy ? <ActivityIndicator /> : <Text style={styles.sheetBtnText}>{t("createListing.importFromPnr", "Importa da PNR")}</Text>}
            </TouchableOpacity>

            <View style={{ height: 10 }} />
            <Text style={styles.label}>{t("createListing.orPasteConfirmation", "Oppure incolla la conferma di prenotazione")}</Text>
            <TextInput
              value={confirmationText}
              onChangeText={setConfirmationText}
              placeholder={t("createListing.confirmationPlaceholder", "Incolla qui il testo della conferma (email di Booking.com, Trenitalia, ecc.)")}
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.input, styles.confirmationInput]}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity onPress={handleConfirmationImport} disabled={importBusy} style={[styles.sheetBtn, styles.sheetBtnGhost, importBusy && { opacity: 0.6 }]}>
              {importBusy ? <ActivityIndicator /> : <Text style={styles.sheetBtnText}>{t("createListing.importFromConfirmation", "Importa dalla conferma")}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={closeImport} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>{t("common.close", "Chiudi")}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* -------- Scanner QR (expo-camera) -------- */}
      <Modal visible={qrVisible} animationType="fade" transparent onRequestClose={() => setQrVisible(false)}>
        <View style={styles.qrOverlay}>
          <View style={styles.qrFrame}>
            <Text style={styles.qrTitle}>{t("createListing.qrPromptTitle", "Inquadra il QR del biglietto")}</Text>
            <View style={styles.qrCameraWrap}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "ean8", "code128", "code39", "pdf417", "upc_a", "upc_e"] }}
                onBarcodeScanned={importBusy ? undefined : onQrScanned}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => setQrVisible(false)} style={[styles.footerBtn, styles.footerGhost, { flex: 1 }]}>
                <Text style={[styles.footerText, { color: theme.colors.text }]}>{t("common.cancel", "Annulla")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* -------- Modal Applica tutti i fix -------- */}
      <Modal visible={showFixesModal} transparent animationType="fade" onRequestClose={() => setShowFixesModal(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheetCard, { maxWidth: 520, alignSelf: "center" }]}>
            <Text style={styles.sheetTitle}>Applica tutti i fix AI?</Text>
            <Text style={styles.sheetText}>Verranno aggiornati automaticamente i campi suggeriti (titolo, località, date/orari, prezzo, immagine…).</Text>
            <View style={{ height: 10 }} />
            <TouchableOpacity onPress={applyAllTrustFixes} style={[styles.sheetBtn, styles.sheetBtnPrimary]}>
              <Text style={[styles.sheetBtnText, { color: "#fff" }]}>Applica adesso</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowFixesModal(false)} style={[styles.sheetBtn, styles.sheetBtnGhost]}>
              <Text style={styles.sheetBtnText}>Annulla</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
    importCard: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: theme.colors.accent, borderRadius: theme.radius.lg,
      paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
    },
    importCardTitle: { color: theme.colors.accentOn, fontWeight: "800", fontSize: 14 },
    importCardText: { color: theme.colors.accentOn, opacity: 0.9, fontSize: 12, marginTop: 2 },
    // Etichetta che introduce Descrizione come ALTERNATIVA all'Import (non
    // un passo successivo): senza, sembra un campo obbligatorio in mezzo al
    // flusso invece che una scorciatoia per chi non ha un documento.
    sectionAltLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700", marginTop: 12, marginBottom: 2 },
    // Link leggero (non più un bottone pieno): "Inserisci manualmente" è
    // l'alternativa a Import/Compila con AI, non un passo obbligato — il
    // peso visivo di un link comunica meglio "opzionale" di un bottone pieno.
    manualEntryLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, marginTop: 8 },
    manualEntryLinkText: { color: theme.colors.textMuted, fontWeight: "700", fontSize: 13, textDecorationLine: "underline" },
    checkAiRow: { marginTop: 4, marginBottom: 4, gap: 6, alignItems: "flex-start" },
    cvHelper: { color: theme.colors.textMuted, fontSize: 12, marginTop: 6, marginBottom: 2 },
    advancedHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8,
      backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md || 10,
      borderWidth: 1, borderColor: theme.colors.border,
    },
    advancedHeaderText: { fontWeight: "800", color: theme.colors.text, fontSize: 14 },
    labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    iconBtn: { padding: 6, marginLeft: 8 },
    inputDisabled: { backgroundColor: theme.colors.surfaceMuted, color: theme.colors.textMuted },
    fieldContainer: { position: "relative" },
    disabledOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // --- top ---
  topPanel: { backgroundColor: theme.colors.surfaceMuted, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  topHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  topTitle: { fontFamily: theme.fonts.headingExtraBold, fontSize: 20, color: theme.colors.boardingText },

  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderWidth: 1 },
  pillLight: { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
  pillDark: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  // "Clear all" non è un'azione AI: stile neutro (trasparente, bordo
  // tratteggiato, testo muto) per staccarlo visivamente dal trio AI.
  pillSubtle: { backgroundColor: "transparent", borderColor: theme.colors.border, borderStyle: "dashed" },
  pillText: { fontWeight: "800", color: theme.colors.text },
  pillTextDark: { color: "#fff" },
  pillTextSubtle: { fontWeight: "700", color: theme.colors.textMuted },

  // Toolbar AI compatta: "Compila con AI" a tutta larghezza + 3 icone.
  aiToolbar: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 8, paddingBottom: 6 },
  aiIconBtnWrap: { alignItems: "center", width: 52 },
  aiIconBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border,
  },
  aiIconBtnLabel: { fontSize: 10, color: theme.colors.textMuted, marginTop: 3, fontWeight: "600" },

  // Sommario Check AI (chip a semaforo, stessi colori dei box di dettaglio)
  checkSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, marginBottom: 2 },
  checkSummaryChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 1 },
  sumChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  sumChipText: { fontSize: 12, fontWeight: "700", color: theme.colors.boardingText },
  sumChipRed: { backgroundColor: "#FEE2E2", borderColor: "#F87171" },
  sumChipYellow: { backgroundColor: "#FFF4C5", borderColor: "#FACC15" },
  sumChipGreen: { backgroundColor: "#E7F7C5", borderColor: "#84CC16" },
  sumChipBlue: { backgroundColor: "#DBEAFE", borderColor: "#60A5FA" },

  // Micro log + progress
  microWrap: { marginTop: 6, marginBottom: 4 },
  microLine: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 2 },
  progressBar: { height: 8, borderRadius: 6, backgroundColor: theme.colors.border, overflow: "hidden", marginTop: 6 },
  progressFill: { height: "100%", backgroundColor: theme.colors.boardingText },

  // --- slider ---
  sliderWrap: { flex: 1 },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginVertical: 10 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border,
  },
  stepDotActive: { backgroundColor: theme.colors.boardingText, borderColor: theme.colors.boardingText },
  stepDotText: { fontSize: 13, fontWeight: "700", color: theme.colors.textMuted },
  stepDotTextActive: { color: theme.colors.accentOn || "#fff" },
  stepBar: { width: 28, height: 3, borderRadius: 2, backgroundColor: theme.colors.border },
  stepBarActive: { backgroundColor: theme.colors.boardingText },

  slide: {
    flex: 1,
    paddingHorizontal: 16,
    marginBottom: FOOTER_H - 20 // spazio sopra i pulsanti
  },
  slideCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
    minHeight: 120,
    paddingBottom: 16,
  },

  // row with two equal columns
  row2: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0 },

  // tratta treno a due campi con freccia fissa
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeArrow: { fontSize: 18, fontWeight: "800", color: theme.colors.boardingText },

  // common
  card: { backgroundColor: theme.colors.surface, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: theme.colors.border, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 4 },
  subCard: { backgroundColor: theme.colors.surfaceMuted, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12 },
  subCardTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText, marginBottom: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText },

  label: { fontWeight: "700", color: theme.colors.boardingText, marginTop: 8, marginBottom: 6 },
  labelInline: { fontWeight: "700", color: theme.colors.boardingText },
  input: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, color: theme.colors.text },
  // Solo bordo (più marcato) in rosso: lo sfondo resta bianco/grigio
  // chiarissimo come il campo normale, altrimenti placeholder e testo
  // digitato perdono leggibilità sul fondo rosato.
  inputError: { borderColor: theme.colors.danger, borderWidth: 1.5 },
  errorText: { color: theme.colors.danger, marginTop: 4, fontWeight: "600" },
  note: { fontSize: 12, lineHeight: 16, color: theme.colors.textMuted, marginTop: 6 },
  swapBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  swapHeaderRow: { flexDirection: "row", alignItems: "center" },
  photoAddBtn: {
    width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderStyle: "dashed",
    borderColor: theme.colors.textMuted, alignItems: "center", justifyContent: "center",
  },
  photoRemoveBtn: {
    position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
  },
  photoRemoveText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  multiline: { minHeight: 96 },
  confirmationInput: { height: 110 },
  segment: { flexDirection: "row", gap: 8 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
  segBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.text },
  segText: { color: theme.colors.boardingText, fontWeight: "800" },
  segTextActive: { color: theme.colors.boardingText },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.boardingText },
  smallBtnText: { color: theme.colors.boardingText, fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteSmall: { color: theme.colors.textMuted, marginTop: 6 },
  previewPlaceholder: { height: 160, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center", marginTop: 10 },
  previewText: { color: theme.colors.textMuted, textAlign: "center", paddingHorizontal: 12 },
  previewImage: { width: "100%", height: 200, borderRadius: 12, backgroundColor: theme.colors.border, marginTop: 10 },

  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 12, paddingBottom: 12,
    paddingTop: 0,
    flexDirection: "row", gap: 10
  },
  footerBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 16, borderRadius: 14 },
  footerPrimary: {
    backgroundColor: theme.colors.accent,
    shadowColor: theme.colors.accent, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: {width:0, height:5},
    elevation: 4
  },
  footerGhost: {
    backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border,
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: {width:0, height:3},
    elevation: 2
  },
  footerText: { fontWeight: "800", color: theme.colors.boardingText },

  sheetBackdrop: { flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "flex-end" },
  sheetCard: { width: "100%", backgroundColor: theme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, borderTopWidth: 1, borderColor: theme.colors.border },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText },
  sheetText: { color: theme.colors.boardingText, marginTop: 4 },
  sheetBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetBtnPrimary: { backgroundColor: theme.colors.boardingText },
  sheetBtnGhost: { backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border },
  sheetBtnText: { fontWeight: "800", color: theme.colors.boardingText },
  sheetClose: { alignSelf: "center", marginTop: 10 },
  sheetCloseText: { color: theme.colors.textMuted },
  qrOverlay: { flex: 1, backgroundColor: "#000000CC", alignItems: "center", justifyContent: "center", padding: 16 },
  qrFrame: { width: "100%", maxWidth: 480, backgroundColor: theme.colors.primary, borderRadius: 16, padding: 12, gap: 12 },
  qrTitle: { fontWeight: "800", color: theme.colors.boardingText, alignSelf: "center" },
  qrCameraWrap: { height: 300, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border },

  // --- new for price info + AI button
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  infoButton: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingRight: 10 },
  infoLink: { fontWeight: "700", color: theme.colors.boardingText },
  smallAIButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.accent },
  smallAIButtonText: { color: theme.colors.accentOn, fontWeight: "800" },
});