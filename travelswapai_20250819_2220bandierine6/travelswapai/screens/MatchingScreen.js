// screens/MatchingScreen.js
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getCurrentUser } from "../lib/db";
import { getUserSnapshot, recomputeUserSnapshot } from "../lib/backendApi";
import MatchCard from "../components/MatchCard";

export default function MatchingScreen() {
  const navigation = useNavigation();
  const [userId, setUserId] = useState(null);
  const [data, setData] = useState({ items: [], count: 0, generatedAt: null });
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        if (!u?.id) throw new Error("missing user");
        setUserId(u.id);
        setLoading(true);
        const snap = await getUserSnapshot(u.id);
        setData(snap || { items: [], count: 0, generatedAt: null });
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRecomputing(true);
    try {
      await recomputeUserSnapshot(userId, { topPerListing: 3, maxTotal: 50 });
      const snap = await getUserSnapshot(userId);
      setData(snap || { items: [], count: 0, generatedAt: null });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setRecomputing(false);
    }
  }, [userId]);

  const renderItem = ({ item }) => (
    <MatchCard item={item} onPress={() => navigation.navigate("OfferDetail", { listingId: item.toId })} />
  );

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator /><Text style={{ marginTop: 12, color: "#6B7280" }}>Caricamento…</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={{ color: "#B91C1C", marginBottom: 8 }}>Errore</Text>
        <Text style={{ color: "#6B7280" }}>{String(error)}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={s.header}>
        <Text style={s.h1}>I tuoi match</Text>
        <TouchableOpacity onPress={onRefresh} disabled={recomputing} style={[s.refreshBtn, recomputing && { opacity: 0.6 }]}>
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={s.refreshTxt}>{recomputing ? "Aggiornamento…" : "Aggiorna"}</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.metaTime}>
        {data.generatedAt ? `Aggiornati: ${new Date(data.generatedAt).toLocaleString()}` : "Nessuno snapshot — premi Aggiorna"}
      </Text>

      <FlatList
        data={data.items}
        keyExtractor={(x) => x.toId}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={recomputing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={{ color: "#6B7280", paddingHorizontal: 4 }}>Nessun match al momento</Text>}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  center:{ flex:1, alignItems:"center", justifyContent:"center", padding:16 },
  header:{ paddingHorizontal:16, paddingTop:8, paddingBottom:4, flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  h1:{ fontSize:20, fontWeight:"800" },
  refreshBtn:{ flexDirection:"row", alignItems:"center", gap:6, backgroundColor:"#111827", paddingHorizontal:12, paddingVertical:8, borderRadius:10 },
  refreshTxt:{ color:"#fff", fontWeight:"700" },
  metaTime:{ color:"#6B7280", paddingHorizontal:16, marginBottom:6 },
});
