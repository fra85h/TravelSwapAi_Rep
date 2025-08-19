// screens/ListingDetailScreen.js
import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRoute } from "@react-navigation/native";
import { getPublicListingById } from "../lib/db"; // vedi punto 3
import { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../lib/i18n";
export default function ListingDetailScreen() {
  const route = useRoute();
  const listingId = route?.params?.listingId ?? route?.params?.id ?? null;
  const navigation = useNavigation();
  const { t, lang } = useI18n();
  useLayoutEffect(() => { navigation.setOptions({ title: t("listingDetail") }); }, [navigation, t, lang]);
 
  const [loading, setLoading] = useState(true);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!listingId) {
        setLoading(false);
        setError("ID annuncio mancante");
        return;
      }
      try {
        setLoading(true);
        const l = await getPublicListingById(listingId);
        if (mounted) setListing(l);
      } catch (e) {
        if (mounted) setError(e?.message || "Errore caricamento annuncio");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [listingId]);

  if (loading) return <View style={s.center}><ActivityIndicator /></View>;
  if (error || !listing) return <View style={s.center}><Text style={s.err}>{error || "Annuncio non trovato"}</Text></View>;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{listing.title || "Annuncio"}</Text>
      <Text style={s.sub}>
        {listing.type} • {listing.location || "—"}
      </Text>

      {listing.type === "hotel" ? (
        <Text style={s.meta}>
          Check-in {fmtDate(listing.check_in)} → Check-out {fmtDate(listing.check_out)}
        </Text>
      ) : (
        <Text style={s.meta}>
          {listing.route_from || "?"} → {listing.route_to || "?"} • {fmtDate(listing.depart_at)}
        </Text>
      )}

      {listing.price != null && (
        <Text style={s.meta}>
          {Number(listing.price).toFixed(2)} {listing.currency || "€"}
        </Text>
      )}
    </View>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return String(iso).split("-").reverse().join("/");
    return d.toLocaleDateString("it-IT");
  } catch { return String(iso).slice(0, 10); }
}

const s = StyleSheet.create({
  center:{flex:1,alignItems:"center",justifyContent:"center",padding:16},
  err:{color:"#B91C1C",textAlign:"center"},
  wrap:{padding:16},
  title:{fontSize:20,fontWeight:"700",marginBottom:6},
  sub:{fontSize:14,color:"#6B7280",marginBottom:6},
  meta:{fontSize:14,color:"#374151",marginTop:2},
});
