// screens/ListingDetailScreen.js
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRoute } from "@react-navigation/native";
import { getListingMatches, recomputeForListing } from "../lib/backendApi";
import MatchCard from "../components/MatchCard";
import { getListingById } from "../lib/db.js";
import { theme } from "../lib/theme";
import TrustScoreBadge from "../components/TrustScoreBadge";
import OfferCTAs from "../components/OfferCTA";

/* ========= Utils ========= */

const pad2 = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:MI:SS" (24h) – lasciata per compatibilità dove già usata */
function toYMDHMS(input) {
  if (!input) return "—";
  const s = String(input).trim();
  const m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [_, Y, M, D, h = "00", i = "00", sec = "00"] = m;
    return `${Y}-${M}-${D} ${h}:${i}:${sec}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const Y = d.getFullYear();
    const M = pad2(d.getMonth() + 1);
    const D = pad2(d.getDate());
    const h = pad2(d.getHours());
    const i = pad2(d.getMinutes());
    const sec = pad2(d.getSeconds());
    return `${Y}-${M}-${D} ${h}:${i}:${sec}`;
  }
  return s;
}

/** "YYYY-MM-DD hh:mi:ss AM/PM" (12h) – per hotel/treno nei chip */
function toYMDHMS_AMPM(input) {
  if (!input) return "—";
  const d = new Date(String(input));
  if (isNaN(d.getTime())) {
    const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return String(input);
    let [, Y, M, D, hh, mm, ss = "00"] = m;
    let hNum = parseInt(hh, 10);
    const ampm = hNum >= 12 ? "PM" : "AM";
    hNum = hNum % 12;
    if (hNum === 0) hNum = 12;
    return `${Y}-${M}-${D} ${String(hNum).padStart(2, "0")}:${mm}:${ss} ${ampm}`;
  }
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${Y}-${M}-${D} ${pad2(h)}:${m}:${s} ${ampm}`;
}

const safeStr = (v) => (v == null || v === "" ? "—" : String(v));
const fmtMoney = (v, c) => (v == null || isNaN(Number(v)) ? "—" : `${Number(v).toFixed(2)} ${c || "€"}`);

/** rimuove prezzi inseriti nel titolo (€, EUR, “prezzo: …”) */
function stripPriceFromTitle(s) {
  if (!s) return s;
  let out = String(s);
  // es. "… - 120€", "… 120 EUR", "… €120", "… 120,00 €"
  out = out.replace(/\s*[-–—]?\s*(?:€|\bEUR\b)?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  // es. "… prezzo: 120€" / "… price 120 EUR"
  out = out.replace(/\s*(?:prezzo|price)\s*[:\-]?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  return out.trim();
}

/** time-ago (it) */
function timeAgo(input) {
  if (!input) return null;
  const d = new Date(String(input));
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return "pochi secondi fa";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h fa`;
  const g = Math.floor(h / 24);
  return `${g} gg fa`;
}
function isNew(createdAt) {
  if (!createdAt) return false;
  const d = new Date(String(createdAt));
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < 24 * 60 * 60 * 1000; // <24h
}

/** Palette gradient basata su TrustScore e tipo */
function paletteByTrust(score, type) {
  const baseA = type === "hotel" ? "#f2f7ff" : type === "train" ? "#fff7f2" : "#f7fafc";
  if (typeof score === "number") {
    if (score >= 85) return ["#ffffff", baseA, "#ecfdf5"];
    if (score >= 70) return ["#ffffff", baseA, "#fffbeb"];
    return ["#ffffff", baseA, "#fef2f2"];
  }
  return ["#ffffff", baseA];
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

/* ========= Screen ========= */

export default function ListingDetailScreen() {
  const route = useRoute();
  const listingId = route.params?.listingId ?? route.params?.id;

  const [listing, setListing] = useState(null);
  const [matches, setMatches] = useState({ items: [], count: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setListing(await getListingById(listingId));
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    try {
      setMatches(await getListingMatches(listingId, 100));
    } finally {
      setLoadingMatches(false);
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMatches(); }, [loadMatches]);

  const doRecompute = async () => {
    setRecomputing(true);
    try {
      await recomputeForListing(listingId);
      await loadMatches();
    } finally {
      setRecomputing(false);
    }
  };

  const textColor = theme?.colors?.boardingText || "#111827";

  const trustScore = useMemo(() => {
    const raw =
      typeof listing?.trustscore === "number" ? listing.trustscore :
      typeof listing?.trust_score === "number" ? listing.trust_score :
      null;
    return raw != null ? Number(raw) : null;
  }, [listing]);

  // date/meta
  const checkIn   = listing?.check_in   ?? listing?.checkIn   ?? null;
  const checkOut  = listing?.check_out  ?? listing?.checkOut  ?? null;
  const departAt  = listing?.depart_at  ?? listing?.departAt  ?? null;
  const arriveAt  = listing?.arrive_at  ?? listing?.arriveAt  ?? null;
  const createdAt = listing?.created_at ?? listing?.createdAt ?? null;
  const publishedAgo = timeAgo(createdAt);
  const isNewBadge   = isNew(createdAt);

  // === determinazione soft: è mio?
  const meId =
    route.params?.me?.id ??
    listing?.me?.id ??
    listing?.current_user_id ?? null;

  const ownerId =
    listing?.owner_id ??
    listing?.user_id ??
    listing?.created_by ??
    listing?.author_id ?? null;

  const isMine = meId && ownerId && String(meId) === String(ownerId);

  const gradColors = paletteByTrust(trustScore, listing?.type);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: textColor }}>Caricamento…</Text>
      </View>
    );
  }

  // train-only extra fields
  const tripType  = listing?.trip_type ?? listing?.tripType ?? null; // "oneway" | "roundtrip" | etc
  const operator  = listing?.operator  ?? listing?.carrier  ?? null; // "Trenitalia" | "Italo" | "Trenord" | ...

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
                  refreshControl={<RefreshControl refreshing={recomputing} onRefresh={doRecompute} />}>
        {/* ===== Header con gradient dinamico + Ribbon "Nuovo" (NO PREZZO NEL TITOLO) ===== */}
        <View style={styles.headerCard}>
          {isNewBadge ? (
            <View style={styles.ribbonWrap} pointerEvents="none">
              <View style={styles.ribbon}><Text style={styles.ribbonText}>NUOVO</Text></View>
            </View>
          ) : null}

          <LinearGradient colors={gradColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headerGradient}>
            {/* Riga alta: SOLO titolo + meta (niente Affidabilità qui) */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>
                  {stripPriceFromTitle(safeStr(listing?.title))}
                </Text>
                <Text style={[styles.subtitle, { color: textColor }]}>
                  {safeStr(listing?.type)} • {safeStr(listing?.location || listing?.route_from)}
                  {publishedAgo ? <Text style={{ color: textColor }}>{`  •  pubblicato ${publishedAgo}`}</Text> : null}
                </Text>
              </View>
              {/* TrustScore spostato sotto */}
            </View>

            {/* Separatore */}
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E7EB", marginTop: 12, marginBottom: 12 }} />

            {/* Riga bassa: Affidabilità a SX, Prezzo a DX */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexShrink: 1 }}>
                {typeof trustScore === "number" ? <TrustScoreBadge score={trustScore} /> : <View />}
              </View>
              <Text style={[styles.price, { color: textColor }]}>{fmtMoney(listing?.price, listing?.currency)}</Text>
            </View>
          </LinearGradient>
        </View>

        {/* ===== Info principali ===== */}
        <SectionCard title="Informazioni" textColor={textColor}>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {/* HOTEL (AM/PM) */}
            {listing?.type === "hotel" ? (
              <>
                <Chip icon="📅" label={`Check-in: ${toYMDHMS_AMPM(checkIn)}`} textColor={textColor} />
                <Chip icon="📅" label={`Check-out: ${toYMDHMS_AMPM(checkOut)}`} textColor={textColor} />
                {listing?.pnr ? <Chip icon="🎫" label={`PNR: ${String(listing.pnr)}`} textColor={textColor} /> : null}
              </>
            ) : null}

            {/* TRAIN (AM/PM + nuovi campi) */}
            {listing?.type === "train" ? (
              <>
                <Chip icon="🕒" label={`Partenza: ${toYMDHMS_AMPM(departAt)}`} textColor={textColor} />
                <Chip icon="🕒" label={`Arrivo: ${toYMDHMS_AMPM(arriveAt)}`} textColor={textColor} />
                <Chip
                  icon="🎟"
                  label={`Viaggio: ${
                    tripType
                      ? /round|ar|a\/r/i.test(String(tripType)) ? "A/R"
                        : /one|solo/i.test(String(tripType)) ? "Solo andata"
                        : String(tripType)
                      : "—"
                  }`}
                  textColor={textColor}
                />
                <Chip icon="🚄" label={`Operatore: ${operator || "—"}`} textColor={textColor} />
                {listing?.is_named_ticket != null ? (
                  <Chip icon="👤" label={`Nominativo: ${listing.is_named_ticket ? "Sì" : "No"}`} textColor={textColor} />
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

        {/* Descrizione */}
        {listing?.description ? (
          <SectionCard title="Descrizione" textColor={textColor}>
            <ExpandableText numberOfLines={5} textColor={textColor}>
              {listing.description}
            </ExpandableText>
          </SectionCard>
        ) : null}

        {/* Match */}
        <View style={{ marginTop: 8, marginBottom: 2, paddingHorizontal: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: textColor }}>Match per questo annuncio</Text>
            <TouchableOpacity onPress={doRecompute} disabled={recomputing} style={styles.recomputeBtn}>
              <Text style={styles.recomputeText}>{recomputing ? "Aggiorno…" : "⟳ Ricalcola"}</Text>
            </TouchableOpacity>
          </View>

          {loadingMatches ? (
            <View style={{ marginTop: 16, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 8, color: textColor }}>Caricamento match…</Text>
            </View>
          ) : !matches?.items?.length ? (
            <Text style={{ marginTop: 12, color: textColor }}>Nessun match</Text>
          ) : (
            <View style={{ marginTop: 12, gap: 8 }}>
              {matches.items.map((it) => (<MatchCard key={it.id} item={it} onPress={() => {}} />))}
            </View>
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Footer CTA: SOLO se NON è mio */}
      {!isMine ? (
        <View style={styles.footer}>
          <OfferCTAs listing={listing} me={{ id: meId }} />
        </View>
      ) : null}
    </View>
  );
}

/* ========= Styles ========= */

const styles = StyleSheet.create({
  headerCard: {
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    overflow: "hidden",
    position: "relative",
  },
  headerGradient: { padding: 16 },
  ribbonWrap: { position: "absolute", top: 10, left: -6, zIndex: 10, transform: [{ rotate: "-10deg" }] },
  ribbon: {
    backgroundColor: "#22C55E", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  ribbonText: { color: "#fff", fontWeight: "800", letterSpacing: 0.5, fontSize: 12 },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { marginTop: 6 },
  price: { fontSize: 22, fontWeight: "800" },
  card: {
    marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 14,
    backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  chip: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1,
    borderColor: "#E5E7EB", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginBottom: 8,
  },
  imageWrap: { borderRadius: 20, overflow: "hidden", backgroundColor: "#E5E7EB" },
  image: { width: "100%", aspectRatio: 16 / 9 },
  recomputeBtn: { backgroundColor: theme.colors?.primary || "#111827", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  recomputeText: { color: theme.colors?.boardingText || "#fff", fontWeight: "700" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: "#FFFFFF",
    borderTopWidth: 1, borderTopColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, elevation: 8,
  },
});
