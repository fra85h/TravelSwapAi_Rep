// screens/ListingDetailScreen.js
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useRoute } from "@react-navigation/native";
import { getListingById } from "../lib/offers"; // se già presente
import { getListingMatches, recomputeForListing } from "../lib/backendApi";
import MatchCard from "../components/MatchCard";

export default function ListingDetailScreen() {
  const route = useRoute();
  const listingId = route.params?.listingId;

  const [listing, setListing] = useState(null);
  const [matches, setMatches] = useState({ items: [], count: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const l = await getListingById(listingId);
      setListing(l);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    try {
      const res = await getListingMatches(listingId, 100);
      setMatches(res || { items: [], count: 0 });
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

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
        <ActivityIndicator /><Text style={{ marginTop:12 }}>Caricamento…</Text>
      </View>
    );
  }
  if (err) {
    return (
      <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
        <Text style={{ color:"#B91C1C" }}>{String(err)}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding:16 }}
                refreshControl={<RefreshControl refreshing={recomputing} onRefresh={doRecompute} />}>
      {/* Dettaglio annuncio */}
      <Text style={{ fontSize:22, fontWeight:"800" }}>{listing?.title}</Text>
      <Text style={{ color:"#6B7280", marginTop:4 }}>
        {(listing?.location || "—") + " · " + (listing?.type || "—")}
      </Text>
      <Text style={{ marginTop:8, fontWeight:"700" }}>
        {listing?.price != null ? `€${listing.price}` : "—"}
      </Text>
      {listing?.description ? (
        <Text style={{ marginTop:12 }}>{listing.description}</Text>
      ) : null}

      {/* Sezione Match per questo annuncio */}
      <View style={{ height:16 }} />
      <View style={{ flexDirection:"row", alignItems:"center", justifyContent:"space-between" }}>
        <Text style={{ fontSize:18, fontWeight:"800" }}>Match per questo annuncio</Text>
        <TouchableOpacity onPress={doRecompute} disabled={recomputing}
                          style={{ backgroundColor:"#111827", paddingHorizontal:12, paddingVertical:8, borderRadius:8 }}>
          <Text style={{ color:"#fff", fontWeight:"700" }}>{recomputing ? "Aggiorno…" : "⟳ Ricalcola"}</Text>
        </TouchableOpacity>
      </View>

      {loadingMatches ? (
        <View style={{ marginTop:16, alignItems:"center" }}>
          <ActivityIndicator /><Text style={{ marginTop:8, color:"#6B7280" }}>Caricamento match…</Text>
        </View>
      ) : matches.items.length === 0 ? (
        <Text style={{ marginTop:12, color:"#6B7280" }}>Nessun match</Text>
      ) : (
        <View style={{ marginTop:12, gap:8 }}>
          {matches.items.map((it) => (
            <MatchCard key={it.id} item={it} onPress={() => { /* navigate OfferDetail(it.id) se hai un'altra route */ }} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
