// components/OfferCTA.js
import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
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

  // A-2: "Ho questo biglietto" — il venditore pubblica un VENDO precompilato
  // con la stessa tratta/date del CERCO. Comparirà da solo tra i suggerimenti
  // di questa ricerca (nessuna offerta inversa, nessuna semantica denaro nuova).
  const onSellForCerco = () => {
    navigation.navigate("CreateListing", {
      prefill: {
        type: listing?.type,
        location: listing?.location,
        route_from: listing?.route_from,
        route_to: listing?.route_to,
        depart_at: listing?.depart_at,
        arrive_at: listing?.arrive_at,
        check_in: listing?.check_in,
        check_out: listing?.check_out,
      },
    });
  };

  // Un CERCO è una richiesta (nessun biglietto da comprare o scambiare): non si
  // offrono acquisto/scambio. Si spiega come collegarsi e si offre una scorciatoia
  // per pubblicare il proprio biglietto in vendita. Acquisto e scambio hanno senso
  // SOLO verso un VENDO. Gli annunci senza cerco_vendo (legacy) restano vendibili.
  if (String(listing?.cerco_vendo || "").toUpperCase() === "CERCO") {
    return (
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          {t("offers.cercoInfo", "Questo è un annuncio di ricerca: non si acquista né si scambia direttamente. Se hai il biglietto giusto, pubblicalo come “Vendo” — comparirà tra i suoi suggerimenti.")}
        </Text>
        <TouchableOpacity onPress={onSellForCerco} style={styles.sellBtn}>
          <Text style={styles.sellBtnText}>{t("offers.sellForCerco", "Ho questo biglietto → Pubblicalo in vendita")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onPurchase} style={[styles.btn, styles.btnGhost]} accessibilityRole="button" accessibilityLabel={labelPurchase}>
        <Ionicons name="pricetag-outline" size={16} color={theme.colors.text} style={{ marginRight: 6 }} />
        <Text style={[styles.btnText, styles.btnGhostText]}>{labelPurchase}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSwap} style={styles.btn} accessibilityRole="button" accessibilityLabel={labelSwap}>
        <Ionicons name="swap-horizontal-outline" size={16} color={theme.colors?.boardingText || "#fff"} style={{ marginRight: 6 }} />
        <Text style={styles.btnText}>{labelSwap}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginTop: 12 },
  btn: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors?.primary || "#111827",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
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
  sellBtn: {
    marginTop: 12,
    backgroundColor: theme.colors?.primary || "#111827",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  sellBtnText: {
    color: theme.colors?.boardingText || "#fff",
    fontWeight: "800",
  },
});
