// screens/CreateListingScreen.js

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AntDesign } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { insertListing, updateListing, getListingById } from "../lib/db";
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
import DateField from "../components/DateField";
import DateTimeField from "../components/DateTimeField";
import { parseListingFromTextAI } from "../lib/descriptionParser"; // OpenAI parser (server-side)

/* ---------- CONST ---------- */
const FOOTER_H = 96; // usato per dare spazio sotto alle slide
const DRAFT_KEY = "@tsai:create_listing_draft";
const AUTO_HIDE_MS = 4500;   // tempo dopo cui spariscono micro log e barra

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

function AIPill({ title, onPress, disabled, dark, loading }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.pill,
        dark ? styles.pillDark : styles.pillLight,
        (disabled || loading) && { opacity: 0.6 }
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {loading ? (
        <ActivityIndicator size="small" color={dark ? "#fff" : "#111827"} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <AntDesign name="star" size={16} style={{ marginRight: 6 }} color={dark ? "#fff" : theme.colors.boardingText} />
          <Text style={[styles.pillText, dark && styles.pillTextDark]} numberOfLines={1}>{title}</Text>
        </View>
      )}
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
  const { t } = useI18n();
  const navigation = useNavigation();
  const p = route?.params ?? {};
  const passedListing = p.listing ?? null; // <-- keep same API
  const listingId = p.listingId ?? passedListing?.id ?? passedListing?._id ?? null;
  const mode = (p.mode === "edit" || listingId != null || passedListing != null) ? "edit" : "create";

  // TrustScore hook + UI state
  const { loading: trustLoading, data: trustData, error: trustError, evaluate } = useTrustScore();
  const [lastTrustRunAt, setLastTrustRunAt] = useState(0);
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

  const [slideIndex, setSlideIndex] = useState(0);
  const [sliderW, setSliderW] = useState(Dimensions.get("window").width);
  const scrollRef = useRef(null); // ref for horizontal ScrollView

  const [insightsOpen, setInsightsOpen] = useState(false);
  const hasInsights = (trustData?.flags?.length || trustData?.suggestedFixes?.length);

  // Stato form
  const [form, setForm] = useState({
    type: "hotel",
    cercoVendo: "VENDO",
    title: "",
    location: "",
    checkIn: "",
    checkOut: "",
    departAt: "",
    arriveAt: "",
    isNamedTicket: false,
    gender: "",
    pnr: "",
    description: "",
    price: "",
  });

  const initialJsonRef = useRef(null);
  const [errors, setErrors] = useState({});

  const flagsNoImg = useMemo(() => {
    const rx = /(image|imageurl|image_url|foto|immagine)/i;
    let arr = Array.isArray(trustData?.flags)
      ? trustData.flags.filter(f => !rx.test(String(f?.field || f?.msg || "")))
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
  }, [trustData, form?.type]);

  const fixesNoImg = useMemo(() => {
    const rx = /(image|imageurl|image_url|foto|immagine)/i;
    let arr = Array.isArray(trustData?.suggestedFixes)
      ? trustData.suggestedFixes.filter(s => !rx.test(String(s?.field || s?.suggestion || "")))
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

  // ---------- EDIT MODE: prefill ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (mode === "edit" && route?.params?.listingId && typeof getListingById === "function") {
          const l = await getListingById(route.params.listingId);
          if (!cancelled && l) {
            setForm((prev) => ({
              ...prev,
              type: l.type || prev.type,
              cercoVendo: l.cerco_vendo || l.cercoVendo || prev.cercoVendo,
              title: l.title ?? prev.title,
              location: l.location ?? prev.location,
              description: l.description ?? prev.description,
              price: l.price != null ? String(l.price) : prev.price,
              checkIn: l.check_in || "",
              checkOut: l.check_out || "",
              departAt: l.depart_at || "",
              arriveAt: l.arrive_at || "",
            }));
          }
          return;
        }
        if (route?.params?.draftFromId && typeof getListingById === "function") {
          const l = await getListingById(route.params.draftFromId);
          if (!cancelled && l) {
            setForm((prev) => ({
              ...prev,
              title: l.title || prev.title,
              location: l.location || prev.location,
              description: l.description || prev.description,
              price: l.price != null ? String(l.price) : prev.price,
              imageUrl: l.image_url || prev.imageUrl,
              checkIn: l.check_in || "",
              checkOut: l.check_out || "",
              departAt: l.depart_at || "",
              arriveAt: l.arrive_at || "",
            }));
          }
        } else {
          const raw = await AsyncStorage.getItem(DRAFT_KEY);
          if (raw && mode !== "edit") {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") setForm((p) => ({ ...p, ...parsed }));
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
    if (form?.type === nextType) return;
    if (nextType === "hotel") {
      update({ type: "hotel", departAt: "", arriveAt: "", isNamedTicket: false, gender: "", pnr: "" });
    } else {
      update({ type: "train", checkIn: "", checkOut: "" });
    }
  };

  /* ---------- CHECK AI (comprende ex “Magia IA”) ---------- */
  const [loadingAI, setLoadingAI] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importSheet, setImportSheet] = useState(false);
  const [pnrInput, setPnrInput] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

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

  const onTrustCheck = useCallback(async () => {
    const now = Date.now();
    if (now - lastTrustRunAt < 10_000) {
      const secs = Math.ceil((10_000 - (now - lastTrustRunAt)) / 1000);
      Alert.alert("Attendi un attimo", `Puoi rilanciare la verifica tra ~${secs}s.`);
      return;
    }

    try {
      setLoadingAI(true);
      setShowMicroLog(true);
      setMicroLog([]);
      setProgress(0);
      logStep("Inizio controllo…", 5);

      // 1) Analisi descrizione (ex Magia IA)
      logStep("Analisi descrizione con AI…", 20);
      const text = String(form.description || "").trim();
      let parsed = null;
      if (text) {
        try {
          parsed = await parseListingFromTextAI(text, "it");
        } catch {}
      }

      // 1.1) Determina cerco/vendo
      let cercoFromText = guessCercoVendoFromText(text);
      let nextCercoVendo =
        (parsed?.cercoVendo === "CERCO" || parsed?.cercoVendo === "VENDO")
          ? parsed.cercoVendo
          : (cercoFromText || form.cercoVendo);

      // 1.2) Costruisci patch dai suggerimenti AI
      const patch = {};
if (parsed?.type) patch.type = parsed.type;
      if (parsed?.title) patch.title = parsed.title;
      if (parsed?.location) patch.location = parsed.location;
      if (parsed?.checkIn) patch.checkIn = normalizeDateStr(parsed.checkIn);
      if (parsed?.checkOut) patch.checkOut = normalizeDateStr(parsed.checkOut);
      if (parsed?.departAt) patch.departAt = parsed.departAt.replace(" ", "T");
      if (parsed?.arriveAt) patch.arriveAt = parsed.arriveAt.replace(" ", "T");
      if (typeof parsed?.isNamedTicket === "boolean") patch.isNamedTicket = parsed.isNamedTicket;
      if (parsed?.gender) patch.gender = parsed.gender;
      if (parsed?.pnr) patch.pnr = parsed.pnr;
      
      // Build route and title from parsed origin/destination when available
      if (parsed?.origin || parsed?.destination) {
        const a = String(parsed.origin || "").trim();
        const b = String(parsed.destination || "").trim();
        const routeStr = (a && b) ? `${a}-->${b}` : (a || b);
        if (routeStr) {
          patch.location = routeStr;
          patch.title = `Vendo treno ${routeStr} solo andata`;
        }
      }
if (parsed?.price) patch.price = String(parsed.price).replace(",", ".");
      if (nextCercoVendo) patch.cercoVendo = nextCercoVendo;

      try {
        const combinedLoc = (patch.location || form.location || "");
        const hasArrow = /-->/.test(combinedLoc) || /→/.test(combinedLoc);
        const [locFrom, locTo] = hasArrow ? combinedLoc.split("-->").length>1?combinedLoc.split("-->"):combinedLoc.split("→").map(s => s.trim()) : [combinedLoc, ""];
        const routeStr = (locFrom && locTo) ? `${locFrom}-->${locTo}` : (locFrom || locTo || "");
if ((patch.type || form.type) === "train" && routeStr) {
  patch.location = routeStr;
  patch.title = `Vendo treno ${routeStr} solo andata`;
}
      } catch {}

      if (Object.keys(patch).length) {
        update(patch);
        logStep("Suggerimenti AI applicati.", 40);
      } else {
        logStep("Nessun suggerimento AI da applicare.", 40);
      }

      // 2) Coerenza/validazioni locali (warning)
      logStep("Controllo coerenza e date…", 60);
      const localFlags = [];
      const nowDate = new Date();

      if (form?.type === "hotel") {
        const a = parseISODate(normalizeDateStr(patch.checkIn || form.checkIn));
        const b = parseISODate(normalizeDateStr(patch.checkOut || form.checkOut));
        if (a && b) {
          const ms = b - a;
          const days = ms / (1000 * 60 * 60 * 24);
          if (days > 30) localFlags.push({ field: "checkOut", msg: "Durata soggiorno oltre 30 giorni." });
        }
        if (a && a < new Date(nowDate.toDateString())) localFlags.push({ field: "checkIn", msg: "Check-in nel passato." });
        if (b && b < new Date(nowDate.toDateString())) localFlags.push({ field: "checkOut", msg: "Check-out nel passato." });
      } else {
        const da = parseISODateTime(patch.departAt || form.departAt);
        const ar = parseISODateTime(patch.arriveAt || form.arriveAt);
        if (da && ar) {
          const hrs = (ar - da) / (1000 * 60 * 60);
          if (hrs > 48) localFlags.push({ field: "arriveAt", msg: "Durata tratta oltre 48 ore." });
        }
        if (da && da < new Date()) localFlags.push({ field: "departAt", msg: "Partenza nel passato." });
        if (ar && ar < new Date()) localFlags.push({ field: "arriveAt", msg: "Arrivo nel passato." });
      }

      // 3) TrustScore remoto
      logStep("Verifica affidabilità annuncio…", 80);
      const hasArrow = (patch.type || form?.type) === "train" && ((patch.location || form.location || "").includes("-->") || /→/.test((patch.location || form.location || "")));
      const [locFrom, locTo] = hasArrow ? ((patch.location || form.location).includes("-->")
  ? (patch.location || form.location).split("-->").map(s => s.trim())
  : (patch.location || form.location).split("→").map(s => s.trim())) : [null, null];

      const payload = {
        id: passedListing?.id || listingId || null,
        type: patch.type || form?.type,
        title: patch.title || form.title,
        description: form.description,
        origin: (patch.type || form?.type) === "train" ? (locFrom || null) : null,
        destination: (patch.type || form?.type) === "train"
          ? (locTo || null)
          : ((patch.location || form.location) || null),
        checkIn: (patch.type || form?.type) === "hotel" ? (patch.checkIn || form.checkIn) : null,
        checkOut: (patch.type || form?.type) === "hotel" ? (patch.checkOut || form.checkOut) : null,
        departAt: (patch.type || form?.type) === "train" ? (patch.departAt || form.departAt) : null,
        arriveAt: (patch.type || form?.type) === "train" ? (patch.arriveAt || form.arriveAt) : null,
        price: (patch.price || form.price) ? Number(String(patch.price || form.price).replace(",", ".")) : null,
        currency: "EUR",
        trustscore:trustData?.trustScore,
      };
      const res = await evaluate(payload);

      if (Array.isArray(localFlags) && localFlags.length) {
        const existing = Array.isArray(res?.flags) ? res.flags : [];
        const merged = uniqBy([...existing, ...localFlags], f => `${f.field}|${f.msg}`.toLowerCase());
        localFlags.forEach(f => logStep(`⚠︎ ${f.msg}`, 90));
        void merged;
      }

      logStep("Fatto.", 100);
      setLastTrustRunAt(Date.now()); // <-- mark that Check AI has been run
      clearLogSoon();
      if (!res && trustError) {
        Alert.alert("AI TrustScore", trustError);
      }
    } catch (err) {
      logStep("Errore durante il Check AI.", 100);
      clearLogSoon();
      Alert.alert("AI TrustScore", "Qualcosa è andato storto durante la verifica.");
    } finally {
      setLoadingAI(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, lastTrustRunAt, trustError, evaluate, update, logStep, clearLogSoon, passedListing?.id, listingId]);

  const applyAllTrustFixes = () => {
    try {
      const fixes = Array.isArray(trustData?.suggestedFixes) ? trustData.suggestedFixes : [];
      if (!fixes.length) {
        Alert.alert("Nessun fix", "Non ci sono suggerimenti da applicare.");
        return;
      }
      const patch = {};
      const mapKey = (k) => {
        const key = String(k || "").toLowerCase();
        if (["title","titolo"].includes(key)) return "title";
        if (["location","località","destinazione","destination"].includes(key)) return "location";
        if (["checkin","check_in","check-out","check-in"].includes(key)) return "checkIn";
        if (["checkout","check_out"].includes(key)) return "checkOut";
        if (["departat","depart_at","departure","partenza"].includes(key)) return "departAt";
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
        patch[k] = String(v);
      }
      try {
        const combinedLoc = (patch.location || form.location || "");
        const hasArrow = /-->/.test(combinedLoc) || /→/.test(combinedLoc);
        const [locFrom, locTo] = hasArrow ? combinedLoc.split("-->").length>1?combinedLoc.split("-->"):combinedLoc.split("→").map(s => s.trim()) : [combinedLoc, ""];
        const routeStr = (locFrom && locTo) ? `${locFrom}-->${locTo}` : (locFrom || locTo || "");
if ((patch.type || form.type) === "train" && routeStr) {
  patch.location = routeStr;
  patch.title = `Vendo treno ${routeStr} solo andata`;
}
      } catch {}

      if (Object.keys(patch).length) {
        update(patch);
        setShowFixesModal(false);
        Alert.alert("Fix applicati", "Ho applicato i suggerimenti AI. Puoi comunque modificarli.");
      } else {
        Alert.alert("Nulla da applicare", "I suggerimenti non riguardano campi modificabili.");
      }
    } catch {
      Alert.alert("Errore", "Impossibile applicare i fix.");
    }
  };

  /* ---------- VALIDAZIONI ---------- */
  const computeErrors = useCallback(() => {
    const ciNorm = normalizeDateStr(form.checkIn);
    const coNorm = normalizeDateStr(form.checkOut);
    const e = {};

    if (!form.title.trim()) e.title = t("createListing.errors.titleRequired", "Titolo obbligatorio.");
    if (!form.location.trim()) e.location = t("createListing.errors.locationRequired", "Località obbligatoria.");

    if (form?.type === "hotel") {
      if (!ciNorm) e.checkIn = t("createListing.errors.checkInRequired", "Check-in obbligatorio.");
      if (!coNorm) e.checkOut = t("createListing.errors.checkOutRequired", "Check-out obbligatorio.");
      if (ciNorm && !parseISODate(ciNorm)) e.checkIn = t("createListing.errors.checkInInvalid", "Check-in non valido (YYYY-MM-DD).");
      if (coNorm && !parseISODate(coNorm)) e.checkOut = t("createListing.errors.checkOutInvalid", "Check-out non valido (YYYY-MM-DD).");
      if (ciNorm && coNorm) {
        const a = parseISODate(ciNorm), b = parseISODate(coNorm);
        if (a && b && b < a) e.checkOut = t("createListing.errors.checkoutBeforeCheckin", "Il check-out non può precedere il check-in.");
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
      if (form.isNamedTicket && !/^(M|F)$/.test(form.gender)) {
        e.gender = t("createListing.errors.genderRequired", "Seleziona M o F.");
      }
    }
    const priceStr = String(form.price || "").trim();
if (priceStr && !Number.isFinite(Number(priceStr.replace(",", ".")))) e.price = t("createListing.errors.priceInvalid", "Prezzo non valido.");
    return e;
  }, [form, t]);
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
  const onNextPress = () => goToSlide(1);
  const onBackPress = () => goToSlide(0);
  const clearAll = useCallback(() => {
    setMicroLog([]); setProgress(0); setShowMicroLog(false);
    update({
      title: "",
      location: "",
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
      let suggestion = Number(String(form.price || "").replace(",", "."));
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
      Alert.alert("Suggerimento prezzo", `In base ai dati inseriti, potresti proporre circa ${suggestion}€.\nÈ solo un consiglio: sentiti libero di adattarlo.`);
    } catch {
      Alert.alert("Errore", "Impossibile stimare il prezzo al momento.");
    } finally {
      setPriceLoading(false);
    }
  };

  /* ---------- PUBBLICA / SALVA MODIFICHE ---------- */
  const onPublishOrSave = async () => {
    // Regola: richiedi Check AI prima di pubblicare (solo in create)
    const hasRunCheckAI = lastTrustRunAt > 0;
    if (mode !== "edit" && !hasRunCheckAI) {
      Alert.alert(
        "Esegui prima il Check AI",
        "Per pubblicare l’annuncio, devi prima eseguire il 'Check AI' per una verifica rapida dei dati."
      );
      return;
    }

    if (!validate()) { return; }
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

      const priceNum = Number(String(form.price).replace(",", "."));

      const basePayload = {
        type: form?.type,
        title: form.title.trim(),
        location: form.location.trim(),
        description: form.description.trim() || null,
        price: Number.isFinite(priceNum) ? priceNum : null,
        cerco_vendo: form.cercoVendo === "CERCO" ? "CERCO" : "VENDO",
        ...(mode !== "edit" ? { status: "active" , trustScore: trustData?.trustScore ?? null,} : {})
      };

      const payload = form?.type === "hotel"
        ? { ...basePayload, check_in: form.checkIn, check_out: form.checkOut }
        : { ...basePayload, depart_at: form.departAt, arrive_at: form.arriveAt,
            route_from: (form.location && (form.location.includes("-->") ? form.location.split("-->")[0].trim() : (form.location.includes("→") ? form.location.split("→")[0].trim() : null))),
            route_to: (form.location && (form.location.includes("-->") ? form.location.split("-->")[1].trim() : (form.location.includes("→") ? form.location.split("→")[1].trim() : null)))
          };
const toServerDt = s => s ? s.replace("T", " ") : s;
payload.depart_at = toServerDt(form.departAt);
payload.arrive_at = toServerDt(form.arriveAt);
      if (mode === "edit") {
        const res = await updateListing(idForUpdate, payload);
        if (res?.error) throw res.error;
        Alert.alert(t("editListing.savedTitle", "Modifiche salvate"), t("editListing.savedMsg", "L’annuncio è stato aggiornato."));
      } else {
        console.log("PAYLOAD CHE INVIO:", JSON.stringify(payload, null, 2));
        const res = await insertListing(payload);
                console.log("PAYLOAD CHE INVIO2:", JSON.stringify(payload, null, 2));

        if (res?.error) throw res.error;
        await AsyncStorage.removeItem(DRAFT_KEY);
        Alert.alert(t("createListing.publishedTitle", "Pubblicato 🎉"), t("createListing.publishedMsg", "Il tuo annuncio è stato pubblicato con successo."));
      }

      initialJsonRef.current = JSON.stringify(form);
      onDirtyChange(false);
      navigation.goBack();
    } catch (e) {
      Alert.alert(
        t("common.error", "Errore"),
        mode === "edit"
          ? t("editListing.saveError", "Impossibile salvare le modifiche.")
          : t("createListing.publishError", "Impossibile pubblicare l’annuncio.")
      );
    } finally {
      setPublishing(false);
      onSubmitEnd();
    }
  };

  /* ---------- DRAFT ---------- */
  const onSaveDraft = async () => {
    if (mode === "edit") {
      Alert.alert("Bozza non disponibile", "Salva direttamente le modifiche.");
      return;
    }
    try {
      setSaving(true);
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      await new Promise((r) => setTimeout(r, 350));
      Alert.alert("Bozza salvata", "Puoi riprenderla in qualsiasi momento.");
    } catch {
      Alert.alert("Errore", "Non sono riuscito a salvare la bozza.");
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
      Alert.alert("AI Import", t("createListing.aiImportSuccess", "Dati importati correttamente."));
      goToSlide(1);
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
      Alert.alert("AI Import", t("createListing.aiImportFromQr", "Dati importati dal QR."));
      goToSlide(1);
    } catch {
      Alert.alert(t("common.error", "Errore"), t("createListing.qrImportError", "Import da QR non riuscito."));
    } finally {
      setImportBusy(false);
    }
  };

  const applyImportedData = (data) => {
    if (!data || typeof data !== "object") return;
    if (data.type === "train") {
      update({
        type: "train",
        title: data.title ?? "",
        location: data.location ?? "",
        departAt: data.departAt ?? "",
        arriveAt: data.arriveAt ?? "",
        isNamedTicket: !!data.isNamedTicket,
        gender: data.gender ?? "",
        pnr: data.pnr ?? "",
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

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /* ---------- UI ---------- */
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['left','right','bottom']}>
      {/* ===== TOP PANNELLO FISSO ===== */}
      <View style={styles.topPanel}>
        <View style={styles.topHeaderRow}>
          <Text style={styles.topTitle}>{t("createListing.step1", "Dati principali")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TrustScoreBadge score={trustData?.trustScore} />
            <TrustInfo />
          </View>
        </View>

        {/* Descrizione */}
        <Text style={styles.label}>{t("createListing.description", "Descrizione")}</Text>
        <TextInput
          value={form.description}
          onChangeText={(v) => update({ description: v })}
          placeholder={t("createListing.descriptionPlaceholder", "Dettagli utili per chi è interessato…")}
          style={[styles.input, styles.multiline, styles.inputSurface]}
          placeholderTextColor="#9CA3AF"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Azioni */}
        <View style={styles.pillsRow}>
          <AIPill
            title={t("createListing.aiImport", "AI Import 1-click")}
            onPress={openImport}
            disabled={importBusy || saving || publishing}
          />
          <AIPill
            title={"Check AI"}
            onPress={onTrustCheck}
            disabled={trustLoading || loadingAI}
            loading={loadingAI}
          />
          <AIPill
            title={"Clear all"}
            onPress={clearAll}
            disabled={loadingAI || publishing || saving}
          />

        </View>

        {/* Micro log + progress bar */}
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
      </View>

      {/* ===== SOTTO: SLIDER ORIZZONTALE A PAGINE ===== */}
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <View style={styles.sliderWrap} onLayout={(e) => setSliderW(e.nativeEvent.layout.width)}>
          {/* Dots */}
          <View style={styles.stepRow}>
            <View style={[styles.stepDot, slideIndex >= 0 && styles.stepDotActive]} />
            <View style={[styles.stepBar, slideIndex >= 1 && styles.stepBarActive]} />
            <View style={[styles.stepDot, slideIndex >= 1 && styles.stepDotActive]} />
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
            onMomentumScrollEnd={(e) => {
              const w = e.nativeEvent.layoutMeasurement.width || sliderW || 1;
              const x = e.nativeEvent.contentOffset.x || 0;
              const idx = Math.round(x / w);
              setSlideIndex(idx);
            }}
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
                  {/* Tipo + Cerco/Vendo */}
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
                            <TouchableOpacity key={cv} onPress={() => update({ cercoVendo: cv })} style={[styles.segBtn, active && styles.segBtnActive]}>
                              <Text style={[styles.segText, active && styles.segTextActive]}>{cv === "CERCO" ? t("createListing.cerco","Cerco") : t("createListing.vendo","Vendo")}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>

                  {/* Titolo */}
                  <Text style={styles.label}>{t("createListing.titleLabel", "Titolo *")}</Text>
                  <TextInput
                    value={form.title}
                    onChangeText={(v) => update({ title: v })}
                    placeholder={
                      form?.type === "hotel"
                        ? t("createListing.titlePlaceholderHotel", "Es. Camera doppia vicino Duomo")
                        : t("createListing.titlePlaceholderTrain", "Es. Milano → Roma (FR 9520)")
                    }
                    style={[styles.input, errors.title && styles.inputError]}
                    placeholderTextColor="#9CA3AF"
                  />
                  {!!errors.title && <Text style={styles.errorText}>{errors.title}</Text>}

                  {/* Località / Rotta */}
                  <Text style={styles.label}>
                    { form?.type === "hotel"
                      ? t("createListing.locationLabelHotel", "Località *")
                      : t("createListing.locationLabelTrain", "Tratta *")
                    }
                  </Text>
                  <TextInput
                    value={form.location}
                    onChangeText={(v) => update({ location: v })}
                    placeholder={
                      form?.type === "hotel"
                        ? t("createListing.locationPlaceholderHotel", "Es. Milano, Navigli")
                        : t("createListing.locationPlaceholderTrain", "Es. Milano Centrale → Roma Termini")
                    }
                    style={[styles.input, errors.location && styles.inputError]}
                    placeholderTextColor="#9CA3AF"
                  />
                  {!!errors.location && <Text style={styles.errorText}>{errors.location}</Text>}

                  {/* Date */}
                  {form?.type === "hotel" ? (
                    <>
                      <DateField
                        label={t("createListing.checkIn", "Check-in")}
                        required
                        value={form.checkIn}
                        onChange={(v) => update({ checkIn: normalizeDateStr(v) })}
                        error={errors.checkIn}
                      />
                      <DateField
                        label={t("createListing.checkOut", "Check-out")}
                        required
                        value={form.checkOut}
                        onChange={(v) => update({ checkOut: normalizeDateStr(v) })}
                        error={errors.checkOut}
                      />
                    </>
                  ) : (
                    <>
                      <DateTimeField
                        label={t("createListing.departAt", "Partenza (data e ora)")}
                        required
                        value={form.departAt}
                        onChange={(v) => update({ departAt: v })}
                        error={errors.departAt}
                      />
                      <DateTimeField
                        label={t("createListing.arriveAt", "Arrivo (data e ora)")}
                        required
                        value={form.arriveAt}
                        onChange={(v) => update({ arriveAt: v })}
                        error={errors.arriveAt}
                      />
                    </>
                  )}

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
                  {/* Particolari treno (se serve) */}
                  {form?.type === "train" && (
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
                          {!!errors.gender && <Text style={styles.errorText}>{errors.gender}</Text>}
                        </>
                      )}

                      <Text style={[styles.label, { marginTop: 10 }]}>{t("createListing.train.pnrLabel", "PNR (opzionale)")}</Text>
                      <TextInput
                        value={form.pnr}
                        onChangeText={(v) => update({ pnr: v })}
                        placeholder={t("createListing.train.pnrPlaceholder", "Es. ABCDEF")}
                        style={styles.input}
                        autoCapitalize="characters"
                        placeholderTextColor="#9CA3AF"
                      />
                      <Text style={styles.note}>🔒 {t("createListing.train.pnrPrivacy", "Il PNR non sarà visibile nell’annuncio.")}</Text>
                    </View>
                  )}

                  {/* Prezzo */}
                  <Text style={styles.label}>{t("createListing.price", "Prezzo *")}</Text>
                  <TextInput
                    value={String(form.price)}
                    onChangeText={(v) => update({ price: v.replace(",", ".") })}
                    placeholder={t("createListing.pricePlaceholder", "Es. 120")}
                    keyboardType="decimal-pad"
                    style={[styles.input, errors.price && styles.inputError]}
                    placeholderTextColor="#9CA3AF"
                  />
                  {!!errors.price && <Text style={styles.errorText}>{errors.price}</Text>}

                  {/* Info + Pulsante Analisi Prezzo con AI */}
                  <View style={styles.infoRow}>
                    <TouchableOpacity onPress={() => setPriceInfoOpen((v) => !v)} style={styles.infoButton}>
                      <AntDesign name="infocirlceo" size={16} color={theme.colors.boardingText} />
                      <Text style={styles.infoLink}> Info</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={analyzePriceAI} disabled={priceLoading} style={[styles.smallAIButton, priceLoading && {opacity:0.7}]}> 
                      {priceLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.smallAIButtonText}>Analisi prezzo con AI</Text>}
                    </TouchableOpacity>
                  </View>
                  {priceInfoOpen && (
                    <Text style={[styles.note, { marginTop: 6 }]}>
                      Questo suggerimento di prezzo è pensato per aiutarti a decidere in autonomia.
                      Considera domanda, urgenza e qualità dell’offerta: sentiti libero di aumentare o ridurre il prezzo.
                    </Text>
                  )}

                  {/* Box Trust */}
                  {!!flagsNoImg?.length && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#FFF4C5", borderWidth: 1, borderColor: "#FACC15" }}>
                      <Text style={{ fontWeight: "800", marginBottom: 6 }}>Possibili problemi</Text>
                      {flagsNoImg.map((f, i) => (
                        <Text key={i}>• {f.msg}</Text>
                      ))}
                    </View>
                  )}

                  {!!fixesNoImg?.length && (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#E7F7C5", borderWidth: 1, borderColor: "#84CC16" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontWeight: "800" }}>Suggerimenti AI</Text>
                      </View>
                      <View style={{ height: 6 }} />
                      {fixesNoImg.map((s, i) => (
                        <Text key={i}>• {s.field}: {s.suggestion}</Text>
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
                <Text style={[styles.footerText, { color: "#111827" }]}>{t("common.back", "Indietro")}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={onSaveDraft} disabled={saving || mode === "edit"} style={[styles.footerBtn, styles.footerGhost, (saving || mode === "edit") && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator /> : <Text style={[styles.footerText, { color: "#111827" }]}>{mode === "edit" ? t("editListing.draftDisabled","Bozza disattivata") : t("createListing.saveDraft","Salva bozza")}</Text>}
              </TouchableOpacity>
            )}

            {slideIndex === 0 ? (
              <TouchableOpacity onPress={onNextPress} style={[styles.footerBtn, styles.footerPrimary]}>
                <Text style={[styles.footerText, { color: theme.colors.boardingText }]}>{t("common.next", "Avanti")}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={onPublishOrSave} disabled={publishing} style={[styles.footerBtn, styles.footerPrimary]}>
                {publishing ? <ActivityIndicator color={theme.colors.boardingText} /> : <Text style={[styles.footerText, { color: theme.colors.boardingText }]}>{mode === "edit" ? "Modifica" : t("createListing.publish", "Pubblica")}</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* -------- Modal AI Import -------- */}
      <Modal visible={importSheet} animationType="slide" transparent onRequestClose={closeImport}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetCard}>
            <Text style={styles.sheetTitle}>{t("createListing.aiImport", "AI Import 1-click")}</Text>
            <Text style={styles.sheetText}>{t("createListing.aiImportDesc", "Importa automaticamente i dati dell’annuncio leggendo un QR code oppure inserendo il PNR.")}</Text>

            <View style={{ height: 8 }} />

            <TouchableOpacity onPress={requestQrPermissionAndOpen} style={[styles.sheetBtn, styles.sheetBtnPrimary]}>
              <Text style={[styles.sheetBtnText, { color: "#fff" }]}>{t("createListing.scanQr", "Scansiona QR")}</Text>
            </TouchableOpacity>

            <View style={{ height: 10 }} />
            <Text style={styles.label}>{t("createListing.orEnterPnr", "Oppure inserisci PNR")}</Text>
            <TextInput
              value={pnrInput}
              onChangeText={setPnrInput}
              placeholder={t("createListing.train.pnrPlaceholder", "Es. ABCDEF")}
              autoCapitalize="characters"
              style={styles.input}
              placeholderTextColor="#9CA3AF"
            />
            <TouchableOpacity onPress={handlePNRImport} style={[styles.sheetBtn, styles.sheetBtnGhost]}>
              {importBusy ? <ActivityIndicator /> : <Text style={styles.sheetBtnText}>{t("createListing.importFromPnr", "Importa da PNR")}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={closeImport} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>{t("common.close", "Chiudi")}</Text>
            </TouchableOpacity>
          </View>
        </View>
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
                <Text style={[styles.footerText, { color: "#111827" }]}>{t("common.cancel", "Annulla")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onQrScanned({ data: "Ryanair FR1234 MXP-FCO 10/09/2025 08:10 09:20 PNR ABCDEF €49" })}
                style={[styles.footerBtn, styles.footerPrimary, { flex: 1 }]}
              >
                {importBusy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.footerText, { color: "#fff" }]}>{t("createListing.simulateScan", "Simula scan")}</Text>}
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
  // --- top ---
  topPanel: { backgroundColor: "#F4F7FB", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  topHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  topTitle: { fontSize: 20, fontWeight: "900", color: theme.colors.boardingText },

  pillsRow: { flexDirection: "row", gap: 12, paddingTop: 8, paddingBottom: 6 },
  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderWidth: 1 },
  pillLight: { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
  pillDark: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  pillText: { fontWeight: "800", color: "#111827" },
  pillTextDark: { color: "#fff" },

  inputSurface: { backgroundColor: "#FBFDFF" },

  // Micro log + progress
  microWrap: { marginTop: 6, marginBottom: 4 },
  microLine: { fontSize: 12, color: "#374151", marginBottom: 2 },
  progressBar: { height: 8, borderRadius: 6, backgroundColor: "#E5E7EB", overflow: "hidden", marginTop: 6 },
  progressFill: { height: "100%", backgroundColor: theme.colors.boardingText },

  // --- slider ---
  sliderWrap: { flex: 1 },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginVertical: 10 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary },
  stepDotActive: { backgroundColor: theme.colors.boardingText },
  stepBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.primary },
  stepBarActive: { backgroundColor: theme.colors.boardingText },

  slide: {
    paddingHorizontal: 16,
    marginBottom: FOOTER_H - 20 // spazio sopra i pulsanti
  },
  slideCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
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

  // common
  card: { backgroundColor: "#fff", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#0F172A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 4 },
  subCard: { backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 12 },
  subCardTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText, marginBottom: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText },

  label: { fontWeight: "700", color: theme.colors.boardingText, marginTop: 8, marginBottom: 6 },
  labelInline: { fontWeight: "700", color: theme.colors.boardingText },
  input: { borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, color: "#111827" },
  inputError: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  errorText: { color: "#B91C1C", marginTop: 4 },
  note: { fontSize: 12, lineHeight: 16, color: "#6B7280", marginTop: 6 },
  multiline: { minHeight: 96 },
  segment: { flexDirection: "row", gap: 8 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F3F4F6" },
  segBtnActive: { backgroundColor: theme.colors.primary, borderColor: "#111827" },
  segText: { color: theme.colors.boardingText, fontWeight: "800" },
  segTextActive: { color: theme.colors.boardingText },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.boardingText },
  smallBtnText: { color: theme.colors.boardingText, fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteSmall: { color: "#6B7280", marginTop: 6 },
  previewPlaceholder: { height: 160, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", alignItems: "center", justifyContent: "center", marginTop: 10 },
  previewText: { color: "#6B7280", textAlign: "center", paddingHorizontal: 12 },
  previewImage: { width: "100%", height: 200, borderRadius: 12, backgroundColor: "#E5E7EB", marginTop: 10 },

  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 12, paddingBottom: 12,
    paddingTop: 0,
    flexDirection: "row", gap: 10
  },
  footerBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 16, borderRadius: 14 },
  footerPrimary: {
    backgroundColor: theme.colors.primary,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: {width:0, height:4},
    elevation: 3
  },
  footerGhost: {
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: {width:0, height:3},
    elevation: 2
  },
  footerText: { fontWeight: "800", color: theme.colors.boardingText },

  sheetBackdrop: { flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "flex-end" },
  sheetCard: { width: "100%", backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, borderTopWidth: 1, borderColor: "#E5E7EB" },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText },
  sheetText: { color: theme.colors.boardingText, marginTop: 4 },
  sheetBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetBtnPrimary: { backgroundColor: theme.colors.boardingText },
  sheetBtnGhost: { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  sheetBtnText: { fontWeight: "800", color: theme.colors.boardingText },
  sheetClose: { alignSelf: "center", marginTop: 10 },
  sheetCloseText: { color: "#6B7280" },
  qrOverlay: { flex: 1, backgroundColor: "#000000CC", alignItems: "center", justifyContent: "center", padding: 16 },
  qrFrame: { width: "100%", maxWidth: 480, backgroundColor: theme.colors.primary, borderRadius: 16, padding: 12, gap: 12 },
  qrTitle: { fontWeight: "800", color: theme.colors.primary, alignSelf: "center" },
  qrCameraWrap: { height: 300, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },

  // --- new for price info + AI button
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  infoButton: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingRight: 10 },
  infoLink: { fontWeight: "700", color: theme.colors.boardingText },
  smallAIButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.boardingText },
  smallAIButtonText: { color: "#fff", fontWeight: "800" },
});