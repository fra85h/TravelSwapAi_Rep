import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useI18n } from "../lib/i18n";
import { useListingTranslation } from "../lib/useListingTranslation";
import { theme } from "../lib/theme";

export default function TranslatedDescription({ listingId, title, description }) {
  const { locale } = typeof useI18n === "function" ? useI18n() : { locale: "it" };
  const { getTranslated, loading, error } = useListingTranslation();
  const [trans, setTrans] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      if (!listingId || !locale) return;
      const r = await getTranslated(listingId, locale);
      if (stop) return;
      setTrans(r);
      setShowOriginal(false);
    })();
    return () => { stop = true; };
  }, [listingId, locale]);

  const titleShown = trans?.translated && !showOriginal ? (trans?.title || title) : title;
  const descShown  = trans?.translated && !showOriginal ? (trans?.description || description) : description;

  return (
    <View style={{ marginTop: 12 }}>
      {loading ? (
        <Text style={{ color: theme.colors.boardingText, opacity: 0.7 }}>Traduzione in corso…</Text>
      ) : error ? (
        <Text style={{ color: "#B91C1C" }}>Traduzione non disponibile ({String(error).slice(0,80)})</Text>
      ) : trans?.translated ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <Text style={{ color: theme.colors.boardingText, opacity: 0.8 }}>
            Tradotto automaticamente{trans?.lang ? ` in ${trans.lang}` : ""}{trans?.originalLang ? ` (origine: ${trans.originalLang})` : ""}
          </Text>
          <TouchableOpacity onPress={() => setShowOriginal(v => !v)} style={{
            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
            borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F8FAFC"
          }}>
            <Text style={{ fontWeight: "700", color: "#111827" }}>{showOriginal ? "Mostra tradotto" : "Vedi originale"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={{ fontSize: 18, fontWeight: "800", color: theme.colors.boardingText, marginBottom: 6 }}>{titleShown}</Text>
      {!!descShown && <Text style={{ color: theme.colors.boardingText, lineHeight: 20 }}>{descShown}</Text>}
    </View>
  );
}
