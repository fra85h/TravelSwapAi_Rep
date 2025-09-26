// components/OfferCTA.js
import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function OfferCTAs({ listing, me }) {
  const { t } = useI18n();
  const isMine =
    me?.id && (listing?.owner_id || listing?.user_id || listing?.created_by) &&
    String(me.id) === String(listing.owner_id || listing.user_id || listing.created_by);

  if (isMine) return null;

  const labelPurchase = t("offers.proposePurchase", "Proponi acquisto");
  const labelSwap     = t("offers.proposeSwap", "Proponi scambio");

  const onPurchase = () => {
    // TODO: collega al tuo flow acquisto
    console.log("propose purchase", listing?.id);
  };
  const onSwap = () => {
    // TODO: collega al tuo flow scambio
    console.log("propose swap", listing?.id);
  };

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
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  btnGhostText: {
    color: "#111827",
  },
});
