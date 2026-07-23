// components/OfferCTA.js
import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, Text, StyleSheet, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { listMyListings } from "../lib/db";
import { sendListingPing } from "../lib/backendApi";
import ActionSheet from "./ui/ActionSheet";

export default function OfferCTAs({ listing, me }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const isMine =
    me?.id && (listing?.owner_id || listing?.user_id || listing?.created_by) &&
    String(me.id) === String(listing.owner_id || listing.user_id || listing.created_by);

  const isCerco = String(listing?.cerco_vendo || "").toUpperCase() === "CERCO";

  // Ping: annunci VENDO attivi MIEI dello stesso tipo del CERCO che sto
  // guardando — se ne ho almeno uno, posso segnalarlo al proprietario del
  // CERCO invece di limitarmi a pubblicarne uno nuovo.
  const [myVendos, setMyVendos] = useState([]);
  const [pingSent, setPingSent] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingPickerOpen, setPingPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (isMine || !isCerco || !me?.id) { setMyVendos([]); return; }
    listMyListings({ status: "active" })
      .then((rows) => {
        if (!alive) return;
        const mine = (rows || []).filter(
          (l) => String(l.cerco_vendo || "").toUpperCase() === "VENDO" && l.type === listing?.type
        );
        setMyVendos(mine);
      })
      .catch(() => { if (alive) setMyVendos([]); });
    return () => { alive = false; };
  }, [isMine, isCerco, me?.id, listing?.type]);

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

  // Ping: segnala un proprio VENDO già pubblicato al proprietario del CERCO
  // (niente offerta, niente chat — solo un avviso con link diretto). Se ho
  // più annunci VENDO compatibili, chiedo quale segnalare.
  const doPing = async (fromListingId) => {
    if (!listing?.id || pinging) return;
    setPinging(true);
    try {
      await sendListingPing(fromListingId, listing.id);
      setPingSent(true);
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("offers.pingError", "Non è stato possibile inviare la segnalazione."));
    } finally {
      setPinging(false);
    }
  };

  // Alert.alert con più di 2 bottoni non è affidabile su web (vedi
  // lib/webAlert.js): con più VENDO compatibili serve l'ActionSheet, che
  // mostra davvero tutte le opzioni invece di collassarle in un OK/Annulla.
  const onPing = () => {
    if (!myVendos.length) return;
    if (myVendos.length === 1) {
      doPing(myVendos[0].id);
      return;
    }
    setPingPickerOpen(true);
  };

  // Un CERCO è una richiesta (nessun biglietto da comprare o scambiare): non si
  // offrono acquisto/scambio. Si spiega come collegarsi e si offre una scorciatoia
  // per pubblicare il proprio biglietto in vendita. Acquisto e scambio hanno senso
  // SOLO verso un VENDO. Gli annunci senza cerco_vendo (legacy) restano vendibili.
  if (isCerco) {
    return (
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          {t("offers.cercoInfo", "Questo è un annuncio di ricerca: non si acquista né si scambia direttamente. Se hai il biglietto giusto, pubblicalo come “Vendo” — comparirà tra i suoi suggerimenti.")}
        </Text>
        <TouchableOpacity onPress={onSellForCerco} style={styles.sellBtn}>
          <Text style={styles.sellBtnText}>{t("offers.sellForCerco", "Ho questo biglietto → Pubblicalo in vendita")}</Text>
        </TouchableOpacity>
        {!!myVendos.length && (
          <TouchableOpacity
            onPress={onPing}
            disabled={pinging || pingSent}
            style={[styles.sellBtn, styles.pingBtn, (pinging || pingSent) && styles.btnDisabled]}
          >
            <Text style={styles.sellBtnText}>
              {pingSent ? t("offers.pingSent", "Segnalazione inviata ✓") : t("offers.pingSend", "Ho già un annuncio → Segnalalo a chi cerca")}
            </Text>
          </TouchableOpacity>
        )}
        <ActionSheet
          visible={pingPickerOpen}
          title={t("offers.pingPickTitle", "Quale annuncio segnalo?")}
          message={t("offers.pingPickBody", "Hai più annunci che potrebbero fare al caso: scegli quale segnalare.")}
          cancelLabel={t("common.cancel", "Annulla")}
          onClose={() => setPingPickerOpen(false)}
          options={myVendos.map((l) => ({ label: l.title || l.id, onPress: () => doPing(l.id) }))}
        />
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
  pingBtn: {
    backgroundColor: theme.colors?.secondary || theme.colors?.primary || "#111827",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
