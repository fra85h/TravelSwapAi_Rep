import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useRoute } from "@react-navigation/native";
import { getListingMatches, recomputeForListing } from "../lib/backendApi";
import MatchCard from "../components/MatchCard";
// importa come leggi i dettagli del listing (usa la tua funzione esistente)
import { getListingById } from "../lib/offers"; // adegua se diverso

export default function ListingDetailScreen() {
  const route = useRoute();
  const listingId = route.params?.listingId;

  const [listing, setListing] = useState(null);
  const [matches, setMatches] = useState({ items: [], count: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setListing(await getListingById(listingId)); }
    finally { setLoading(false); }
  }, [listingId]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    try { setMatches(await getListingMatches(listingId, 100)); }
    finally { setLoadingMatches(false); }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMatches(); }, [loadMatches]);

  const doRecompute = async () => {
    setRecomputing(true);
    try { await recomputeForListing(listingId); await loadMatches(); }
    finally { setRecomputing(false); }
  };

  if (loading) return <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}><ActivityIndicator /><Text>Caricamento…</Text></View>;

  return (
    <ScrollView contentContainerStyle={{ padding:16 }}
                refreshControl={<RefreshControl refreshing={recomputing} onRefresh={doRecompute} />}>
      <Text style={{ fontSize:22, fontWeight:"800" }}>{listing?.title}</Text>
      <Text style={{ color:"#6B7280", marginTop:4 }}>{(listing?.location || "—") + " · " + (listing?.type || "—")}</Text>
      <Text style={{ marginTop:8, fontWeight:"700" }}>{listing?.price != null ? `€${listing.price}` : "—"}</Text>
      {listing?.description ? <Text style={{ marginTop:12 }}>{listing.description}</Text> : null}

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
            <MatchCard key={it.id} item={it} onPress={() => { /* navigate OfferDetail(it.id) se serve */ }} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
