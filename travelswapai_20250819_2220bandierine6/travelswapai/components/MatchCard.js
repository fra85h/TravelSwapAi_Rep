import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { theme } from "../lib/theme";

export default function MatchCard({ item, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.card}>
      <View style={s.topRow}>
        <Text style={s.title} numberOfLines={1}>{item.title}</Text>
        {item.bidirectional ? (
          <View style={s.badge}><Text style={s.badgeTxt}>💫 reciproco</Text></View>
        ) : null}
      </View>

      <Text style={s.sub} numberOfLines={1}>
        {(item.location || "—") + " · " + (item.type || "—")}
      </Text>

      <Text style={s.meta}>
        {(item.price != null ? `€${item.price}` : "—") + " · " + `Score ${item.score}`}
      </Text>

      {item.explanation ? <Text style={s.expl} numberOfLines={2}>{item.explanation}</Text> : null}

      <View style={s.bottomRow}>
        {item.model ? <Text style={s.small}>model: {item.model}</Text> : <View />}
        {item.updatedAt ? <Text style={s.small}>upd: {new Date(item.updatedAt).toLocaleDateString()}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card:{ borderWidth:1, borderColor:"#E5E7EB", borderRadius:12, padding:12, backgroundColor:"#fff" },
  topRow:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  title:{ fontWeight:"800", flex:1, marginRight:8 },
  sub:{ color:"#6B7280", marginTop:4 },
  meta:{ color:"#111827", marginTop:6, fontWeight:"700" },
  expl:{ color:"#374151", marginTop:8 },
  bottomRow:{ flexDirection:"row", justifyContent:"space-between", marginTop:8 },
  small:{ fontSize:12, color:"#6B7280" },
  badge:{ paddingHorizontal:8, paddingVertical:2, borderRadius:999, backgroundColor:"#EAF7FF", borderWidth:1, borderColor:"#BAE6FD" },
  badgeTxt:{ fontSize:12, color:"#0369A1", fontWeight:"700" },
});
