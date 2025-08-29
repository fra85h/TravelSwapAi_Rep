// screens/CreateListingScreen.js
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { insertListing } from "../lib/db";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Image,
  Switch,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "../lib/i18n";
// ✅ Replace deprecated expo-barcode-scanner with expo-camera
import { CameraView, useCameraPermissions } from "expo-camera";

const DRAFT_KEY = "@tsai:create_listing_draft";

const TYPES = [
  { key: "hotel", labelKey: "listing.type.hotel" }, // usa t("listing.type.hotel")
  { key: "train", labelKey: "listing.type.train" },
];

/* ---------- UTIL DATE/TIME ---------- */
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
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

// IATA -> città/airport name (subset utile)
const IATA = {
  FCO: "Roma Fiumicino",
  CIA: "Roma Ciampino",
  MXP: "Milano Malpensa",
  LIN: "Milano Linate",
  BGY: "Bergamo Orio",
  VCE: "Venezia",
  BLQ: "Bologna",
  NAP: "Napoli",
  CTA: "Catania",
  PMO: "Palermo",
  CAG: "Cagliari",
  PSA: "Pisa",
  TRN: "Torino",
  VRN: "Verona",
  BRI: "Bari",
  OLB: "Olbia",
};

const MONTHS_IT = {
  GENNAIO: 0, FEBBRAIO: 1, MARZO: 2, APRILE: 3, MAGGIO: 4, GIUGNO: 5,
  LUGLIO: 6, AGOSTO: 7, SETTEMBRE: 8, OTTOBRE: 9, NOVEMBRE: 10, DICEMBRE: 11,
};

// dd/mm/yyyy oppure dd-mm-yyyy oppure yyyy-mm-dd
const DATE_ANY_RE = /\b(?:(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})|(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2}))\b/;
// “10 Settembre 2025”
const DATE_TEXT_RE = new RegExp(String.raw`\\b(\\d{1,2})\\s([A-Za-zÀ-ÿ]{3,})\\s(\\d{4})\\b`, "i");
// hh:mm (24h)
const TIME_RE = /\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b/;
// Flight number es. FR1234
const FLIGHT_NO_RE = /\\b([A-Z]{2})\\s?(\\d{2,4})\\b/;
// IATA pair es. MXP-FCO
const IATA_PAIR_RE = /\\b([A-Z]{3})\\s*(?:-|–|—|>|→|to|verso)\\s*([A-Z]{3})\\b/;
// Treno keywords
const TRAIN_KEYWORDS_RE = /\\b(Trenitalia|Frecciarossa|FR\\s?\\d|Italo|NTV|Regionale|IC|Intercity|Frecciargento|Frecciabianca)\\b/i;
// Rotte
const ROUTE_TEXT_RE = /\\b(?:da|from)\\s([A-Za-zÀ-ÿ .'\\-]+)\\s(?:a|to)\\s([A-Za-zÀ-ÿ .'\\-]+)\\b/i;
const ROUTE_ARROW_RE = /([A-Za-zÀ-ÿ .'\\-]{3,})\\s*(?:-|–|—|>|→)\\s*([A-Za-zÀ-ÿ .'\\-]{3,})/;
// PNR
const PNR_RE = /\\b(?:PNR|booking\\s*reference|codice\\s*(?:prenotazione|biglietto)|record\\s*locator)\\s*[:=]?\\s*([A-Z0-9]{5,8})\\b/i;

function parseAnyDate(text) {
  if (!text) return null;
  let m = text.match(DATE_ANY_RE);
  if (m) {
    if (m[1] && m[2] && m[3]) {
      const d = parseInt(m[1], 10);
      const mn = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      const dt = new Date(y, mn, d);
      if (!isNaN(dt.getTime())) return toISODate(dt);
    } else if (m[4] && m[5] && m[6]) {
      const y = parseInt(m[4], 10);
      const mn = parseInt(m[5], 10) - 1;
      const d = parseInt(m[6], 10);
      const dt = new Date(y, mn, d);
      if (!isNaN(dt.getTime())) return toISODate(dt);
    }
  }
  m = text.match(DATE_TEXT_RE);
  if (m) {
    const d = parseInt(m[1], 10);
    const monthName = m[2].toUpperCase();
    const y = parseInt(m[3], 10);
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
  const h = pad2(parseInt(m[1], 10));
  const mm = pad2(parseInt(m[2], 10));
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
  const src = String(text || "").replace(/\\s/g, " ").trim();

  const out = { status: "active" };
  const pnr = (src.match(PNR_RE) || [])[1];
  if (pnr) out.pnr = pnr.toUpperCase();

  const hasTrain = TRAIN_KEYWORDS_RE.test(src);
  const flMatch = src.match(FLIGHT_NO_RE);
  const mentionsRyanair = /Ryanair|FR\\s?\\d{1,4}\\b/i.test(src);

  let routeFrom = null;
  let routeTo = null;

  const iata = src.match(IATA_PAIR_RE);
  if (iata) {
    const A = iata[1].toUpperCase();
    const B = iata[2].toUpperCase();
    routeFrom = IATA[A] || A;
    routeTo = IATA[B] || B;
  }

  if (!routeFrom || !routeTo) {
    const m1 = src.match(ROUTE_ARROW_RE);
    if (m1) {
      routeFrom = routeFrom || m1[1].trim();
      routeTo = routeTo || m1[2].trim();
    }
  }
  if (!routeFrom || !routeTo) {
    const m2 = src.match(ROUTE_TEXT_RE);
    if (m2) {
      routeFrom = routeFrom || m2[1].trim();
      routeTo = routeTo || m2[2].trim();
    }
  }

  const dateMatches = [...src.matchAll(DATE_ANY_RE)];
  const dateTextMatch = src.match(DATE_TEXT_RE);

  let dateDepart = null;
  let timeDepart = null;
  let dateArrive = null;
  let timeArrive = null;

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

  const isHotelish = /\\b(hotel|albergo|check[-\\s]?in|check[-\\s]?out|notti|night)\\b/i.test(src);
  const twoPlainDatesOnly = (dateMatches.length >= 2 || dateTextMatch) && times.length === 0;
  const isRyanair = mentionsRyanair || (flMatch && flMatch[1] === "FR");

  if (isHotelish || (twoPlainDatesOnly && !hasTrain && !isRyanair)) {
    out.type = "hotel";
    let d1 = dateDepart || parseAnyDate(src);
    let d2 = dateArrive || null;
    if (!d2 && dateMatches.length >= 2) d2 = parseAnyDate(dateMatches[1][0]);
    if (!d2 && d1) {
      const day2 = new Date(d1);
      day2.setDate(new Date(d1).getDate() + 2);
      d2 = toISODate(day2);
    }
    out.checkIn = d1 || "";
    out.checkOut = d2 || "";
    out.title = normalizeTitleFromRoute(routeFrom, routeTo, "Hotel") || "Soggiorno";
    out.location = routeTo || routeFrom || "Hotel";
    return out;
  }

  out.type = "train";
  const dD = dateDepart || parseAnyDate(src) || toISODate(new Date());
  const tD = parseAnyTime(timeDepart, "09:00");
  const dA = dateArrive || dD;
  const tA = parseAnyTime(timeArrive, "10:30");

  out.departAt = `${dD}T${tD}`;
  out.arriveAt = `${dA}T${tA}`;

  const carrierHint = isRyanair ? "Ryanair" : hasTrain ? "Trenitalia/Italo" : "";
  out.title =
    normalizeTitleFromRoute(routeFrom, routeTo, carrierHint) ||
    (isRyanair ? `Volo Ryanair ${flMatch ? flMatch[1] + flMatch[2] : ""}` : "Viaggio");
  out.location =
    routeFrom && routeTo ? `${routeFrom} → ${routeTo}` : isRyanair ? "Volo Ryanair" : "Treno";

  const pm = src.match(/(?:€|\\beur\\b|\\beuro\\b)\\s*([0-9](?:[\\,\\.][0-9]{1,2})?)/i);
  if (pm) out.price = String(pm[1]).replace(",", ".");

  if (isRyanair) out.imageUrl = "https://picsum.photos/seed/ryanair/1200/800";
  else if (hasTrain) out.imageUrl = "https://picsum.photos/seed/train/1200/800";

  return out;
}

/* ---------- DATE FIELD ---------- */
function DateField({ label, value, onChange, required, error }) {
  const { t } = useI18n();
  const [showPicker, setShowPicker] = useState(false);
  const [hasPickerLib, setHasPickerLib] = useState(null);
  const DateTimePicker = useMemo(() => {
    try {
      const mod = require("@react-native-community/datetimepicker");
      setHasPickerLib(true);
      return mod?.default || mod;
    } catch {
      setHasPickerLib(false);
      return null;
    }
  }, []);

  const baseDate = value && parseISODate(value) ? parseISODate(value) : new Date();

  if (hasPickerLib === false) {
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>
          {label} {required ? "*" : ""}
        </Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9CA3AF"
          style={[styles.input, error && styles.inputError]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.label}>
        {label} {required ? "*" : ""}
      </Text>

      <TouchableOpacity onPress={() => setShowPicker(true)} activeOpacity={0.8}>
        <View style={[styles.input, styles.inputRow, error && styles.inputError]}>
          <Text style={{ color: value ? "#111827" : "#9CA3AF" }}>{value || "YYYY-MM-DD"}</Text>
          <Text style={{ color: "#6B7280" }}>📅</Text>
        </View>
      </TouchableOpacity>
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {hasPickerLib && showPicker && DateTimePicker && (
        <>
          <DateTimePicker
            value={baseDate || new Date()}
            mode="date"
            display={Platform.select({ ios: "inline", android: "calendar" })}
            onChange={(event) => {
              if (Platform.OS === "android") {
                if (event.type === "set" && event.nativeEvent?.timestamp) {
                  onChange(toISODate(event.nativeEvent.timestamp));
                }
                setShowPicker(false);
              } else {
                const ts = event?.nativeEvent?.timestamp;
                if (ts) onChange(toISODate(ts));
              }
            }}
            style={{ alignSelf: "stretch" }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              onPress={() => setShowPicker(false)}
              style={[styles.smallBtn, { alignSelf: "flex-end", marginTop: 8 }]}
            >
              <Text style={styles.smallBtnText}>{t("common.ok", "OK")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

/* ---------- DATETIME FIELD ---------- */
function DateTimeField({ label, value, onChange, required, error }) {
  const { t } = useI18n();
  const [hasPickerLib, setHasPickerLib] = useState(null);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

  const DateTimePicker = useMemo(() => {
    try {
      const mod = require("@react-native-community/datetimepicker");
      setHasPickerLib(true);
      return mod?.default || mod;
    } catch {
      setHasPickerLib(false);
      return null;
    }
  }, []);

  const current = value && parseISODateTime(value) ? parseISODateTime(value) : new Date();
  const display = value ? value.replace("T", " ") : "YYYY-MM-DD HH:mm";

  if (hasPickerLib === false) {
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>
          {label} {required ? "*" : ""}
        </Text>
        <TextInput
          value={value ? value.replace("T", " ") : ""}
          onChangeText={(txt) => onChange(txt.replace(" ", "T"))}
          placeholder="YYYY-MM-DD HH:mm"
          placeholderTextColor="#9CA3AF"
          style={[styles.input, error && styles.inputError]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.label}>
        {label} {required ? "*" : ""}
      </Text>

      <TouchableOpacity onPress={() => setShowDate(true)} activeOpacity={0.8}>
        <View style={[styles.input, styles.inputRow, error && styles.inputError]}>
          <Text style={{ color: value ? "#111827" : "#9CA3AF" }}>{display}</Text>
          <Text style={{ color: "#6B7280" }}>🕒</Text>
        </View>
      </TouchableOpacity>
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {hasPickerLib && showDate && DateTimePicker && (
        <>
          <DateTimePicker
            value={current}
            mode="date"
            display={Platform.select({ ios: "inline", android: "calendar" })}
            onChange={(e) => {
              const ts = e?.nativeEvent?.timestamp;
              if (ts) {
                const d = new Date(ts);
                const dateStr = toISODate(d);
                const prev = value && parseISODateTime(value);
                const timeStr = prev ? toISOTime(prev) : "09:00";
                onChange(`${dateStr}T${timeStr}`);
              }
              if (Platform.OS === "android") {
                if (e.type !== "set") setShowDate(false);
                else {
                  setShowDate(false);
                  setShowTime(true);
                }
              }
            }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              onPress={() => {
                setShowDate(false);
                setShowTime(true);
              }}
              style={[styles.smallBtn, { alignSelf: "flex-end", marginTop: 8 }]}
            >
              <Text style={styles.smallBtnText}>{t("createListing.pickTime", "Scegli ora")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {hasPickerLib && showTime && DateTimePicker && (
        <>
          <DateTimePicker
            value={current}
            mode="time"
            is24Hour
            display={Platform.select({ ios: "spinner", android: "clock" })}
            onChange={(e) => {
              const ts = e?.nativeEvent?.timestamp;
              if (ts) {
                const d = new Date(ts);
                const timeStr = toISOTime(d);
                const prev = value && parseISODateTime(value);
                const dateStr = prev ? toISODate(prev) : toISODate(new Date());
                onChange(`${dateStr}T${timeStr}`);
              }
              if (Platform.OS === "android") setShowTime(false);
            }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              onPress={() => setShowTime(false)}
              style={[styles.smallBtn, { alignSelf: "flex-end", marginTop: 8 }]}
            >
              <Text style={styles.smallBtnText}>{t("common.ok", "OK")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

/* ---------- IMAGE PREVIEW ---------- */
function ImagePreview({ url }) {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  if (!String(url || "").trim()) {
    return (
      <View style={styles.previewPlaceholder}>
        <Text style={styles.previewText}>{t("createListing.imageHint", "Aggiungi un URL immagine per vedere l’anteprima")}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.previewPlaceholder, { borderColor: "#FECACA", backgroundColor: "#FEF2F2" }]}>
        <Text style={[styles.previewText, { color: "#991B1B" }]}>{t("createListing.imageLoadError", "Impossibile caricare l’immagine")}</Text>
      </View>
    );
  }
  return <Image source={{ uri: url }} onError={() => setError(true)} style={styles.previewImage} resizeMode="cover" />;
}

/* ---------- AI IMPORT RESOLVERS (usano smartParseTicket) ---------- */
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

  useLayoutEffect(() => {
    try {
      navigation.setOptions?.({
        headerShown: true,
        headerTitle: t("createListing.title", "Nuovo annuncio"),
        headerLeft: () => (
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingHorizontal: 12 }}>
            <Text style={{ color: "#111827", fontWeight: "700" }}>{t("common.back", "Indietro")}</Text>
          </TouchableOpacity>
        ),
      });
    } catch {}
  }, [navigation, t]);

  const editingFrom = route?.params?.draftFromId;

  const [step, setStep] = useState(1);
  const [loadingAI, setLoadingAI] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);

  // AI Import
  const [importSheet, setImportSheet] = useState(false);
  const [pnrInput, setPnrInput] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);

  // ✅ expo-camera permissions hook
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const qrSupported = true; // layout invariato; con expo-camera è supportato in Expo Go

  const [form, setForm] = useState({
    type: "hotel",
    cercoVendo: "VENDO",
    title: "",
    location: "",
    // HOTEL
    checkIn: "",
    checkOut: "",
    // TRENO
    departAt: "",
    arriveAt: "",

    // Opzioni treno
    isNamedTicket: false,
    gender: "",
    pnr: "",

    // COMMON
    description: "",
    price: "",
    imageUrl: "",
  });

  // snapshot form iniziale
  const initialJsonRef = useRef(null);

  const [errors, setErrors] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            setForm((prev) => {
              const next = { ...prev, ...parsed };
              initialJsonRef.current = JSON.stringify(next);
              return next;
            });
          }
        }
      } catch {}
      if (initialJsonRef.current === null) {
        initialJsonRef.current = JSON.stringify(form);
      }
    })();
  }, []); // non aggiungere form qui

  const isDirty = useMemo(() => {
    if (initialJsonRef.current == null) return false;
    try {
      return JSON.stringify(form) !== initialJsonRef.current;
    } catch {
      return false;
    }
  }, [form]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const saveTimer = useRef(null);
  const queueAutoSave = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      } catch {}
    }, 350);
  }, []);

  const update = useCallback(
    (patchOrUpdater) => {
      setForm((prev) => {
        const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(prev) : patchOrUpdater;
        const next = { ...prev, ...patch };
        queueAutoSave(next);
        return next;
      });
    },
    [queueAutoSave]
  );

  const onChangeType = (nextType) => {
    if (form.type === nextType) return;
    if (nextType === "hotel") {
      update({
        type: "hotel",
        departAt: "",
        arriveAt: "",
        isNamedTicket: false,
        gender: "",
        pnr: "",
      });
    } else {
      update({
        type: "train",
        checkIn: "",
        checkOut: "",
      });
    }
  };

  const stepTitles = useMemo(
    () => ({
      1: t("createListing.step1", "Dati principali"),
      2: t("createListing.step2", "Dettagli & pubblicazione"),
    }),
    [t]
  );

  const goNext = () => setStep((s) => Math.min(2, s + 1));
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  /** Magia AI ✨ */
  const runAI = async (currentStep) => {
    if (loadingAI || publishing || importBusy || saving) return;
    try {
      setLoadingAI(true);
      await new Promise((r) => setTimeout(r, 700));

      const ifEmpty = (val, fallback) =>
        val === null || val === undefined || String(val).trim() === "" ? fallback : val;

      const patch = {};
      if (currentStep === 1) {
        if (form.type === "hotel") {
          const today = new Date();
          const plusDays = (d, n) => {
            const dd = new Date(d);
            dd.setDate(dd.getDate() + n);
            return dd;
          };
          patch.title = ifEmpty(form.title, t("createListing.ai.hotelTitle", "Soggiorno 2 notti in centro"));
          patch.location = ifEmpty(form.location, t("createListing.ai.hotelLocation", "Milano, Duomo"));
          patch.checkIn = ifEmpty(form.checkIn, toISODate(today));
          patch.checkOut = ifEmpty(form.checkOut, toISODate(plusDays(today, 2)));
        } else {
          const base = new Date();
          base.setDate(base.getDate() + 1);
          base.setHours(9, 0, 0, 0);
          const arr = new Date(base.getTime() + 90 * 60000);
          patch.title = ifEmpty(form.title, t("createListing.ai.trainTitle", "Frecciarossa Milano → Roma"));
          patch.location = ifEmpty(form.location, t("createListing.ai.trainLocation", "Milano Centrale → Roma Termini"));
          patch.departAt = ifEmpty(form.departAt, `${toISODate(base)}T${toISOTime(base)}`);
          patch.arriveAt = ifEmpty(form.arriveAt, `${toISODate(arr)}T${toISOTime(arr)}`);
          if (!form.isNamedTicket) patch.gender = "";
        }
      } else if (currentStep === 2) {
        patch.description = ifEmpty(
          form.description,
          form.type === "hotel"
            ? t("createListing.ai.hotelDesc", "Camera doppia con colazione. Check-in flessibile, vicino ai mezzi.")
            : t("createListing.ai.trainDesc", "Posto a sedere confermato, vagone silenzio. Biglietto cedibile.")
        );
        patch.imageUrl = ifEmpty(form.imageUrl, "https://picsum.photos/1200/800");
        patch.price = ifEmpty(form.price, "120");
        if (form.type === "train" && form.isNamedTicket === false) {
          patch.isNamedTicket = false;
          patch.gender = "";
        }
      }

      update(patch);
      Alert.alert(t("createListing.ai.title", "Magia AI ✨"), t("createListing.ai.applied", "Ho suggerito alcuni campi per questo step. Puoi sempre modificarli."));
    } catch (e) {
      Alert.alert("AI", t("createListing.ai.error", "Impossibile generare suggerimenti."));
    } finally {
      setLoadingAI(false);
    }
  };

  /* ---------- VALIDAZIONI ---------- */
  const computeErrors = useCallback(() => {
    const e = {};
    if (!form.title.trim()) e.title = t("createListing.errors.titleRequired", "Titolo obbligatorio.");
    if (!form.location.trim()) e.location = t("createListing.errors.locationRequired", "Località obbligatoria.");

    if (form.type === "hotel") {
      if (!form.checkIn.trim()) e.checkIn = t("createListing.errors.checkInRequired", "Check-in obbligatorio.");
      if (!form.checkOut.trim()) e.checkOut = t("createListing.errors.checkOutRequired", "Check-out obbligatorio.");
      if (form.checkIn && !parseISODate(form.checkIn)) e.checkIn = t("createListing.errors.checkInInvalid", "Check-in non valido (YYYY-MM-DD).");
      if (form.checkOut && !parseISODate(form.checkOut)) e.checkOut = t("createListing.errors.checkOutInvalid", "Check-out non valido (YYYY-MM-DD).");
      if (form.checkIn && form.checkOut) {
        const a = parseISODate(form.checkIn);
        const b = parseISODate(form.checkOut);
        if (a && b && b < a) e.checkOut = t("createListing.errors.checkoutBeforeCheckin", "Il check-out non può precedere il check-in.");
      }
    } else {
      if (!form.departAt.trim()) e.departAt = t("createListing.errors.departRequired", "Data/ora partenza obbligatoria.");
      if (!form.arriveAt.trim()) e.arriveAt = t("createListing.errors.arriveRequired", "Data/ora arrivo obbligatoria.");
      if (form.departAt && !parseISODateTime(form.departAt)) e.departAt = t("createListing.errors.departInvalid", "Partenza non valida (YYYY-MM-DD HH:mm).");
      if (form.arriveAt && !parseISODateTime(form.arriveAt)) e.arriveAt = t("createListing.errors.arriveInvalid", "Arrivo non valido (YYYY-MM-DD HH:mm).");
      if (form.departAt && form.arriveAt) {
        const a = parseISODateTime(form.departAt);
        const b = parseISODateTime(form.arriveAt);
        if (a && b && b < a) e.arriveAt = t("createListing.errors.arriveBeforeDepart", "L’arrivo non può precedere la partenza.");
      }
      if (form.isNamedTicket && !/^(M|F)$/.test(form.gender)) {
        e.gender = t("createListing.errors.genderRequired", "Seleziona M o F.");
      }
    }

    const priceStr = String(form.price || "").trim();
    if (!priceStr) e.price = t("createListing.errors.priceRequired", "Prezzo obbligatorio.");
    else if (!isFinite(Number(priceStr.replace(",", ".")))) e.price = t("createListing.errors.priceInvalid", "Prezzo non valido.");

    return e;
  }, [form, t]);

  useEffect(() => {
    setErrors(computeErrors());
  }, [computeErrors]);

  const validate = () => {
    const e = computeErrors();
    setErrors(e);
    return Object.keys(e).length === 0;
    };

  /* ---------- PUBBLICA (DB) ---------- */
  const onPublish = async () => {
    if (!validate()) {
      setStep(1);
      return;
    }
    try {
      setPublishing(true);
      onSubmitStart();

      const priceNum = Number(String(form.price).replace(",", "."));

      const basePayload = {
        type: form.type,
        title: form.title.trim(),
        location: form.location.trim(),
        description: form.description.trim() || null,
        price: Number.isFinite(priceNum) ? priceNum : null,
        image_url: form.imageUrl?.trim() || null,
        cerco_vendo: form.cercoVendo === "CERCO" ? "CERCO" : "VENDO",
        status: "active",
      };

      const payload =
        form.type === "hotel"
          ? { ...basePayload, check_in: form.checkIn, check_out: form.checkOut }
          : { ...basePayload, depart_at: form.departAt, arrive_at: form.arriveAt };

      await insertListing(payload);

      await AsyncStorage.removeItem(DRAFT_KEY);
      Alert.alert(t("createListing.publishedTitle", "Pubblicato 🎉"), t("createListing.publishedMsg", "Il tuo annuncio è stato pubblicato con successo."));

      initialJsonRef.current = JSON.stringify(form);
      onDirtyChange(false);

      navigation.goBack();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), t("createListing.publishError", "Impossibile pubblicare l’annuncio."));
    } finally {
      setPublishing(false);
      onSubmitEnd();
    }
  };

  /* ---------- DRAFT ---------- */
  const onSaveDraft = async () => {
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

  /* ---------- AI IMPORT (UI & LOGICA) ---------- */
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
      setStep(2);
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), t("createListing.aiImportError", "Impossibile importare dal PNR."));
    } finally {
      setImportBusy(false);
    }
  };

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
      setStep(2);
    } catch (e) {
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
        imageUrl: data.imageUrl ?? "",
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
        imageUrl: data.imageUrl ?? "",
        description: data.description ?? "",
      });
    }
  };

  /* ---------- UI ---------- */
  const Step1 = (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, { marginBottom: 8 }]}>{stepTitles[1]}</Text>

      <View style={styles.actionsCol}>
        <TouchableOpacity onPress={openImport} style={[styles.aiBtn, styles.aiBtnAlt]}>
          <Text style={[styles.aiBtnText, { color: "#111827" }]}>{t("createListing.aiImport", "AI Import 1-click")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t("createListing.aiMagic", "Magia AI ✨")}
          onPress={() => runAI(1)}
          disabled={loadingAI || publishing || importBusy || saving}
          style={styles.aiBtn}
        >
          {loadingAI ? <ActivityIndicator size="small" /> : <Text style={styles.aiBtnText}>{t("createListing.aiMagic", "Magia AI ✨")}</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>{t("createListing.type", "Tipo")}</Text>
      <View style={styles.segment}>
        {TYPES.map((tt) => {
          const active = form.type === tt.key;
          return (
            <TouchableOpacity key={tt.key} onPress={() => onChangeType(tt.key)} style={[styles.segBtn, active && styles.segBtnActive]}>
              <Text style={[styles.segText, active && styles.segTextActive]}>{t(tt.labelKey, tt.key === "hotel" ? "Hotel" : "Treno")}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* CERCO/VENDO */}
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

      <Text style={styles.label}>{t("createListing.titleLabel", "Titolo *")}</Text>
      <TextInput
        value={form.title}
        onChangeText={(v) => update({ title: v })}
        placeholder={
          form.type === "hotel"
            ? t("createListing.titlePlaceholderHotel", "Es. Camera doppia vicino Duomo")
            : t("createListing.titlePlaceholderTrain", "Es. Milano → Roma (FR 9520)")
        }
        style={[styles.input, errors.title && styles.inputError]}
        placeholderTextColor="#9CA3AF"
      />
      {!!errors.title && <Text style={styles.errorText}>{errors.title}</Text>}

      <Text style={styles.label}>{t("createListing.locationLabel", "Località *")}</Text>
      <TextInput
        value={form.location}
        onChangeText={(v) => update({ location: v })}
        placeholder={
          form.type === "hotel"
            ? t("createListing.locationPlaceholderHotel", "Es. Milano, Navigli")
            : t("createListing.locationPlaceholderTrain", "Es. Milano Centrale → Roma Termini")
        }
        style={[styles.input, errors.location && styles.inputError]}
        placeholderTextColor="#9CA3AF"
      />
      {!!errors.location && <Text style={styles.errorText}>{errors.location}</Text>}

      {form.type === "hotel" ? (
        <>
          <DateField
            label={t("createListing.checkIn", "Check-in")}
            required
            value={form.checkIn}
            onChange={(v) => update({ checkIn: v })}
            error={errors.checkIn}
          />
          <DateField
            label={t("createListing.checkOut", "Check-out")}
            required
            value={form.checkOut}
            onChange={(v) => update({ checkOut: v })}
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
    </View>
  );

  const TrainParticulars = form.type === "train" && (
    <View style={styles.subCard}>
      <Text style={styles.subCardTitle}>{t("createListing.train.particulars", "Dati particolari treno")}</Text>

      <View style={styles.switchRow}>
        <Text style={styles.labelInline}>{t("createListing.train.namedTicket", "Biglietto nominativo")}</Text>
        <Switch
          value={form.isNamedTicket}
          onValueChange={(v) => {
            if (!v) {
              update({ isNamedTicket: false, gender: "" });
            } else {
              update({ isNamedTicket: true });
            }
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
  );

  const Step2 = (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, { marginBottom: 8 }]}>{stepTitles[2]}</Text>

      <View style={styles.actionsCol}>
        <TouchableOpacity onPress={openImport} style={[styles.aiBtn, styles.aiBtnAlt]}>
          <Text style={[styles.aiBtnText, { color: "#111827" }]}>{t("createListing.aiImport", "AI Import 1-click")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t("createListing.aiMagic", "Magia AI ✨")}
          onPress={() => runAI(2)}
          disabled={loadingAI || publishing || importBusy || saving}
          style={styles.aiBtn}
        >
          {loadingAI ? <ActivityIndicator size="small" /> : <Text style={styles.aiBtnText}>{t("createListing.aiMagic", "Magia AI ✨")}</Text>}
        </TouchableOpacity>
      </View>

      {TrainParticulars}

      <Text style={styles.label}>{t("createListing.description", "Descrizione")}</Text>
      <TextInput
        value={form.description}
        onChangeText={(v) => update({ description: v })}
        placeholder={t("createListing.descriptionPlaceholder", "Dettagli utili per chi è interessato…")}
        style={[styles.input, styles.multiline]}
        placeholderTextColor="#9CA3AF"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

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

      <Text style={styles.label}>{t("createListing.imageUrl", "URL immagine")}</Text>
      <TextInput
        value={form.imageUrl}
        onChangeText={(v) => update({ imageUrl: v })}
        placeholder="https://…"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholderTextColor="#9CA3AF"
      />

      <ImagePreview url={form.imageUrl} />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          <View style={styles.stepRow}>
            <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]} />
            <View style={[styles.stepBar, step >= 2 && styles.stepBarActive]} />
            <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]} />
          </View>

          {step === 1 ? Step1 : Step2}
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 ? (
            <TouchableOpacity onPress={goPrev} style={[styles.footerBtn, styles.footerGhost]}>
              <Text style={[styles.footerText, { color: "#111827" }]}>{t("common.back", "Indietro")}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onSaveDraft} disabled={saving} style={[styles.footerBtn, styles.footerGhost, saving && { opacity: 0.6 }]}>
              {saving ? <ActivityIndicator /> : <Text style={[styles.footerText, { color: "#111827" }]}>{t("createListing.saveDraft", "Salva bozza")}</Text>}
            </TouchableOpacity>
          )}

          {step === 1 ? (
            <TouchableOpacity onPress={goNext} style={[styles.footerBtn, styles.footerPrimary]}>
              <Text style={[styles.footerText, { color: "#fff" }]}>{t("common.next", "Avanti")}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onPublish} disabled={publishing} style={[styles.footerBtn, styles.footerPrimary]}>
              {publishing ? <ActivityIndicator color="#fff" /> : <Text style={[styles.footerText, { color: "#fff" }]}>{t("createListing.publish", "Pubblica")}</Text>}
            </TouchableOpacity>
          )}
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
              <Text style={[styles.sheetBtnText, { color: "#fff" }]}>
                {qrSupported ? t("createListing.scanQr", "Scansiona QR") : t("createListing.scanQrUnavailable", "Scansiona QR (non disponibile)")}
              </Text>
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
              {/* CameraView con barcode scanner */}
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{
                  // supporta QR e formati comuni
                  barcodeTypes: ["qr", "ean13", "ean8", "code128", "code39", "pdf417", "upc_a", "upc_e"],
                }}
                onBarcodeScanned={importBusy ? undefined : onQrScanned}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => setQrVisible(false)} style={[styles.footerBtn, styles.footerGhost, { flex: 1 }]}>
                <Text style={[styles.footerText, { color: "#111827" }]}>{t("common.cancel", "Annulla")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  onQrScanned({ data: "Ryanair FR1234 MXP-FCO 10/09/2025 08:10 09:20 PNR ABCDEF €49" })
                }
                style={[styles.footerBtn, styles.footerPrimary, { flex: 1 }]}
              >
                {importBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.footerText, { color: "#fff" }]}>{t("createListing.simulateScan", "Simula scan")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  subCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },

  actionsCol: {
    flexDirection: "column",
    gap: 8,
    alignSelf: "stretch",
    marginBottom: 8,
  },

  label: { fontWeight: "700", color: "#111827", marginTop: 8, marginBottom: 6 },
  labelInline: { fontWeight: "700", color: "#111827" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#111827",
  },
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inputError: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  errorText: { color: "#B91C1C", marginTop: 4 },
  note: { fontSize: 12, lineHeight: 16, color: "#6B7280", marginTop: 6 },

  multiline: { minHeight: 96 },

  segment: { flexDirection: "row", gap: 8 },
  segBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F3F4F6",
  },
  segBtnActive: { backgroundColor: "#111827", borderColor: "#111827" },
  segText: { color: "#111827", fontWeight: "800" },
  segTextActive: { color: "#fff" },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#111827" },
  smallBtnText: { color: "#fff", fontWeight: "800" },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteSmall: { color: "#6B7280", marginTop: 6 },

  previewPlaceholder: {
    height: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  previewText: { color: "#6B7280", textAlign: "center", paddingHorizontal: 12 },
  previewImage: { width: "100%", height: 200, borderRadius: 12, backgroundColor: "#E5E7EB", marginTop: 10 },

  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 12 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#E5E7EB" },
  stepDotActive: { backgroundColor: "#111827" },
  stepBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB" },
  stepBarActive: { backgroundColor: "#111827" },

  aiBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#111827" },
  aiBtnAlt: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  aiBtnText: { color: "#fff", fontWeight: "800" },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#fff",
    padding: 12,
    flexDirection: "row",
    gap: 10,
  },
  footerBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 12 },
  footerPrimary: { backgroundColor: "#111827" },
  footerGhost: { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  footerText: { fontWeight: "800" },

  sheetBackdrop: { flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "flex-end" },
  sheetCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    borderTopWidth: 1,
    borderColor: "#E5E7EB",
  },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  sheetText: { color: "#6B7280", marginTop: 4 },
  sheetBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetBtnPrimary: { backgroundColor: "#111827" },
  sheetBtnGhost: { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  sheetBtnText: { fontWeight: "800", color: "#111827" },
  sheetClose: { alignSelf: "center", marginTop: 10 },
  sheetCloseText: { color: "#6B7280" },

  qrOverlay: { flex: 1, backgroundColor: "#000000CC", alignItems: "center", justifyContent: "center", padding: 16 },
  qrFrame: { width: "100%", maxWidth: 480, backgroundColor: "#fff", borderRadius: 16, padding: 12, gap: 12 },
  qrTitle: { fontWeight: "800", color: "#111827", alignSelf: "center" },
  qrCameraWrap: {
    height: 300,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
});
