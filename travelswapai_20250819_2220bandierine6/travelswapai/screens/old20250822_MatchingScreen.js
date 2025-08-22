
// screens/MatchingScreen.js — snapshot “Per te”
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getCurrentUser } from "../lib/db";
import { getUserSnapshot, recomputeUserSnapshot } from "../lib/backendApi"; // 👈 NOVITÀ
import { useI18n } from "../lib/i18n";

export default function MatchingScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();

  const [userId, setUserId] = useState(null);
  const [data, setData] = useState({ items: [], count: 0, generatedAt: null });
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState(null);

  // carica utente + snapshot
  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        if (!u?.id) throw new Error("missing user");
        setUserId(u.id);
        setLoading(true);
        const snap = await getUserSnapshot(u.id); // 👈 backend GET snapshot
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
      await recomputeUserSnapshot(userId, { topPerListing: 3, maxTotal: 50 }); // 👈 backend POST snapshot
      const snap = await getUserSnapshot(userId);
      setData(snap || { items: [], count: 0, generatedAt: null });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setRecomputing(false);
    }
  }, [userId]);

  const renderItem = ({ item }) => <MatchRow item={item} onPress={() => navigation.navigate("ListingDetail", { listingId: item.toId })} />;

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, color: "#6B7280" }}>{t("loading", "Caricamento...")}</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={{ color: "#B91C1C", marginBottom: 8 }}>{t("error", "Errore")}</Text>
        <Text style={{ color: "#6B7280" }}>{String(error)}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={s.header}>
        <Text style={s.h1}>{t("matching.forYou", "I tuoi match")}</Text>
        <TouchableOpacity onPress={onRefresh} disabled={recomputing} style={[s.refreshBtn, recomputing && { opacity: 0.6 }]}>
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={s.refreshTxt}>{recomputing ? t("matching.updating","Aggiornamento...") : t("matching.refresh","Aggiorna")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.metaTime}>
        {data.generatedAt
          ? t("matching.updatedAt", "Aggiornati: ") + new Date(data.generatedAt).toLocaleString()
          : t("matching.noSnapshot", "Nessuno snapshot — premi Aggiorna")}
      </Text>

      <FlatList
        data={data.items}
        keyExtractor={(x) => x.toId}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={recomputing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={{ color: "#6B7280", paddingHorizontal: 4 }}>{t("matching.empty", "Nessun match al momento")}</Text>}
      />
    </SafeAreaView>
  );
}

function MatchRow({ item, onPress }) {
  // item: { title, location, type, price, score, bidirectional, explanation, model, updatedAt }
  return (
    <TouchableOpacity onPress={onPress} style={s.card}>
      <View style={s.rowTop}>
        <Text style={s.title} numberOfLines={1}>{item.title}</Text>

        {/* 💫 Badge reciproco */}
        {item.bidirectional ? (
          <View style={s.badge}>
            <Text style={s.badgeTxt}>💫 {/**/}reciproco</Text>
          </View>
        ) : null}
      </View>

      <Text style={s.sub} numberOfLines={1}>
        {(item.location || "—") + " · " + (item.type || "—")}
      </Text>

      <Text style={s.meta}>
        {(item.price != null ? `€${item.price}` : "—") + " · " + `Score ${item.score}`}
      </Text>

      {/* explanation (se presente) */}
      {item.explanation ? (
        <Text style={s.expl} numberOfLines={2}>{item.explanation}</Text>
      ) : null}

      {/* model + updatedAt (se presenti) */}
      <View style={s.rowBottom}>
        {item.model ? <Text style={s.smallGrey}>model: {item.model}</Text> : <View />}
        {item.updatedAt ? <Text style={s.smallGrey}>upd: {new Date(item.updatedAt).toLocaleDateString()}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  center:{ flex:1, alignItems:"center", justifyContent:"center", padding:16 },
  header:{ paddingHorizontal:16, paddingTop:8, paddingBottom:4, flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  h1:{ fontSize:20, fontWeight:"800" },
  refreshBtn:{ flexDirection:"row", alignItems:"center", gap:6, backgroundColor:"#111827", paddingHorizontal:12, paddingVertical:8, borderRadius:10 },
  refreshTxt:{ color:"#fff", fontWeight:"700" },
  metaTime:{ color:"#6B7280", paddingHorizontal:16, marginBottom:6 },

  card:{ borderWidth:1, borderColor:"#E5E7EB", borderRadius:12, padding:12, backgroundColor:"#fff" },
  rowTop:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  title:{ fontWeight:"800", flex:1, marginRight:8 },
  sub:{ color:"#6B7280", marginTop:4 },
  meta:{ color:"#111827", marginTop:6, fontWeight:"700" },
  expl:{ color:"#374151", marginTop:8 },
  rowBottom:{ flexDirection:"row", justifyContent:"space-between", marginTop:8 },
  smallGrey:{ fontSize:12, color:"#6B7280" },

  badge:{ paddingHorizontal:8, paddingVertical:2, borderRadius:999, backgroundColor:"#EAF7FF", borderWidth:1, borderColor:"#BAE6FD" },
  badgeTxt:{ fontSize:12, color:"#0369A1", fontWeight:"700" },
});
