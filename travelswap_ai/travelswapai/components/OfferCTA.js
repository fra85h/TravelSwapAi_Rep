// components/OfferCTA.js
import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function OfferCTAs({ listing, me }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const isMine =
    me?.id && (listing?.owner_id || listing?.user_id || listing?.created_by) &&
    String(me.id) === String(listing.owner_id || listing.user_id || listing.created_by);

  if (isMine) return null;

  const labelPurchase = t("offers.proposePurchase", "Proponi acquisto");
  const labelSwap     = t("offers.proposeSwap", "Proponi scambio");

  const onPurchase = () => {
    if (!listing?.id) return;
    navigation.navigate("OfferFlow", { mode: "buy", listingId: listing.id });
  };
  const onSwap = () => {
    if (!listing?.id) return;
    navigation.navigate("OfferFlow", { mode: "swap", listingId: listing.id });
  };

  // Un CERCO è una richiesta (nessun biglietto da comprare o scambiare): non si
  // offrono acquisto/scambio. Si spiega come collegarsi (pubblicare un VENDO).
  // Acquisto e scambio hanno senso SOLO verso un VENDO. Gli annunci senza
  // cerco_vendo (legacy) restano trattati come vendibili.
  if (String(listing?.cerco_vendo || "").toUpperCase() === "CERCO") {
    return (
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          {t("offers.cercoInfo", "Questo è un annuncio di ricerca: non si acquista né si scambia direttamente. Se hai il biglietto giusto, pubblicalo come “Vendo” — comparirà tra i suoi suggerimenti.")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onPurchase} style={[styles.btn, styles.btnGhost]}>
        <Text style={[styles.btnText, styles.btnGhostText]}>{labelPurchase}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSwap} style={styles.btn}>
        <Text style={styles.btnText}>{labelSwap}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginTop: 12 },
  btn: {
    flex: 1,
    backgroundColor: theme.colors?.primary || "#111827",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: {
    color: theme.colors?.boardingText || "#fff",
    fontWeight: "800",
  },
  btnGhost: {
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  btnGhostText: {
    color: theme.colors.text,
  },
  infoBox: {
    marginTop: 12,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 12,
  },
  infoText: {
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
});
