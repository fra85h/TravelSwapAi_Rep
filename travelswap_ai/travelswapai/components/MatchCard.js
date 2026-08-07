// components/MatchCard.js — un suggerimento nel dettaglio annuncio.
//
// Due cose stavano scritte qui a mano: l'etichetta "reciproco" e il punteggio,
// in italiano per chiunque; e una riga "model: gpt-4o-mini", che nominava un
// pezzo del sistema a chi voleva solo sapere perché quell'annuncio gli veniva
// proposto. Il nome del modello serve a noi nei log, non a chi legge.
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function MatchCard({ item, onPress }) {
  const { t, locale } = useI18n();
  return (
    <TouchableOpacity onPress={onPress} style={s.card}>
      <View style={s.topRow}>
        <Text style={s.title} numberOfLines={1}>{item.title}</Text>
        {item.bidirectional ? (
          <View style={s.badge}><Text style={s.badgeTxt}>💫 {t("match.reciprocal", "reciproco")}</Text></View>
        ) : null}
      </View>

      <Text style={s.sub} numberOfLines={1}>
        {(item.location || "—") + " · " + (item.type || "—")}
      </Text>

      <Text style={s.meta}>
        {(item.price != null ? `€${item.price}` : "—") + " · " + t("match.score", "Affinità {n}", { n: item.score })}
      </Text>

      {item.explanation ? <Text style={s.expl} numberOfLines={2}>{item.explanation}</Text> : null}

      {item.updatedAt ? (
        <View style={s.bottomRow}>
          <Text style={s.small}>
            {t("match.updatedAt", "Aggiornato il {date}", { date: new Date(item.updatedAt).toLocaleDateString(locale || undefined) })}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card:{
    borderWidth:1, borderColor:theme.colors.border, borderRadius:theme.radius.lg,
    padding:14, backgroundColor:theme.colors.surface, ...theme.shadow.sm,
  },
  topRow:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  title:{ fontWeight:"800", flex:1, marginRight:8, color: theme.colors.text },
  sub:{ color:theme.colors.textMuted, marginTop:4 },
  meta:{ color:theme.colors.text, marginTop:6, fontWeight:"700" },
  expl:{ color:theme.colors.textMuted, marginTop:8 },
  bottomRow:{ flexDirection:"row", justifyContent:"space-between", marginTop:8 },
  small:{ fontSize:12, color:theme.colors.textMuted },
  // badge oro per il match reciproco: un momento "premium" della UI, non un blu generico
  badge:{ paddingHorizontal:8, paddingVertical:2, borderRadius:999, backgroundColor:theme.colors.accentSoft, borderWidth:1, borderColor:theme.colors.accent },
  badgeTxt:{ fontSize:12, color:theme.colors.accentOn, fontWeight:"700" },
});
