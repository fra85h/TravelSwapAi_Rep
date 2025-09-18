// screens/OfferFlow.js — flussi completi Proponi acquisto / Proponi scambio
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Alert, FlatList } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getCurrentUser, getPublicListingById } from "../lib/db";
import {
  createOfferBuy,
  createOfferSwap,
  getMyPendingOfferFor,
  cancelOffer,
  listMyActiveListings
} from "../lib/offers";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

export default function OfferFlow() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useI18n();

  const { mode = "BUY", listingId } = route.params || {};

  const [me, setMe] = useState(null);
  const [target, setTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // BUY fields
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [message, setMessage] = useState("");

  // SWAP fields
  const [myListings, setMyListings] = useState([]);
  const [selectedMyListing, setSelectedMyListing] = useState(null);

  // Existing pending
  const [pendingOffer, setPendingOffer] = useState(null);
  const isBuy = mode === "BUY";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const u = await getCurrentUser().catch(() => null);
      setMe(u);

      const l = await getPublicListingById(listingId);
      setTarget(l);

      // controlli base
      if (u?.id && l?.user_id === u.id) {
        setError(t("offerFlow.cantOfferOwn", "Non puoi proporre un'offerta al tuo stesso annuncio."));
        return;
      }
      if (l?.status !== "active") {
        setError(t("offerFlow.listingNotActive", "Questo annuncio non è attivo."));
        return;
      }

      // pending esistente
      const p = await getMyPendingOfferFor(listingId);
      setPendingOffer(p);

      // carica i miei annunci per SWAP
      if (!isBuy && u?.id) {
        const mine = await listMyActiveListings();
        setMyListings(mine);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [listingId, isBuy, t]);

  useEffect(() => { load(); }, [load]);

  const canSubmit = useMemo(() => {
    if (!me || !target || pendingOffer) return false;
    if (isBuy) return true; // amount è opzionale
    return !!selectedMyListing;
  }, [me, target, pendingOffer, isBuy, selectedMyListing]);

  const onSubmit = async () => {
    try {
      if (!me) { Alert.alert(t("offerFlow.loginRequiredTitle", "Login richiesto"), t("offerFlow.loginRequiredMsg", "Accedi per inviare proposte.")); return; }
      if (pendingOffer) { Alert.alert(t("offerFlow.alreadySentTitle", "Già inviata"), t("offerFlow.alreadySentMsg", "Hai già una proposta in attesa per questo annuncio.")); return; }

      if (isBuy) {
        const parsed = amount ? Number(amount) : null;
        if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
          Alert.alert(t("offerFlow.invalidAmountTitle", "Importo non valido"), t("offerFlow.invalidAmountMsg", "Inserisci un importo valido oppure lascia vuoto."));
          return;
        }
        await createOfferBuy(listingId, { amount: parsed, currency, message });
      } else {
        if (!selectedMyListing) {
          Alert.alert(t("offerFlow.selectListingTitle", "Seleziona annuncio"), t("offerFlow.selectListingMsg", "Scegli uno dei tuoi annunci da proporre in scambio."));
          return;
        }
        await createOfferSwap(selectedMyListing.id, listingId, { message });
      }

      Alert.alert(t("offerFlow.sentTitle", "Proposta inviata"), t("offerFlow.sentMsg", "Il proprietario riceverà subito la tua proposta."));
      navigation.goBack();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    }
  };

  const onCancelPending = async () => {
    try {
      if (!pendingOffer?.id) return;
      await cancelOffer(pendingOffer.id);
      setPendingOffer(null);
      Alert.alert(t("common.ok", "OK"), t("offerFlow.canceled", "Proposta cancellata"));
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator /></View>;
  }
  if (error) {
    return (
      <View style={s.center}>
        <Text style={{ color: "#B91C1C", marginBottom: 12 }}>{error}</Text>
        <TouchableOpacity style={s.btn} onPress={load}><Text style={s.btnTxt}>{t("common.retry", "Riprova")}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>
        {isBuy ? t("offers.proposePurchase", "Proponi acquisto") : t("offers.proposeSwap", "Proponi scambio")}
      </Text>

      <View style={s.target}>
        <Text style={s.tTitle}>{target?.title || t("offerFlow.listing", "Annuncio")}</Text>
        <Text style={s.tMeta}>
          {target?.type} • {target?.location || target?.route_from || "-"}
        </Text>
      </View>

      {pendingOffer ? (
        <View style={s.pendingBox}>
          <Text style={s.pendingTitle}>{t("offerFlow.pendingAlready", "Hai già una proposta in attesa")}</Text>
          {pendingOffer.message ? <Text style={s.pendingMsg}>{pendingOffer.message}</Text> : null}
          <View style={s.row}>
            <TouchableOpacity style={[s.btnOutline]} onPress={onCancelPending}>
              <Text style={s.btnOutlineTxt}>{t("offerFlow.cancelProposal", "Cancella proposta")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn]} onPress={() => navigation.goBack()}>
              <Text style={s.btnTxt}>{t("common.close", "Chiudi")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          {isBuy ? (
            <>
              <Text style={s.label}>{t("offerFlow.amountLabel", "Importo offerto (opzionale)")}</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={t("offerFlow.amountPlaceholder", "Es. 120.00")}
                keyboardType="decimal-pad"
                style={s.input}
              />
              <Text style={s.label}>{t("offerFlow.currencyLabel", "Valuta")}</Text>
              <TextInput
                value={currency}
                onChangeText={setCurrency}
                style={s.input}
              />
              <Text style={s.label}>{t("offerFlow.messageOptional", "Messaggio (opzionale)")}</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={t("offerFlow.addDetailsOrRequests", "Aggiungi dettagli o richieste")}
                style={[s.input, { height: 100, textAlignVertical: "top" }]}
                multiline
              />
            </>
          ) : (
            <>
              <Text style={s.label}>{t("offerFlow.chooseOwnListing", "Scegli un tuo annuncio")}</Text>
              <FlatList
                data={myListings}
                keyExtractor={(it) => String(it.id)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[s.card, selectedMyListing?.id === item.id && s.cardSelected]}
                    onPress={() => setSelectedMyListing(item)}
                  >
                    <Text style={s.cardTitle}>{item.title || t("offerFlow.listing", "Annuncio")}</Text>
                    <Text style={s.cardMeta}>{item.type} • {item.location || item.route_from || "-"}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ color: "#6B7280" }}>{t("offerFlow.noActiveListings", "Non hai annunci attivi.")}</Text>}
                style={{ maxHeight: 240 }}
              />
              <Text style={[s.label, { marginTop: 16 }]}>{t("offerFlow.messageOptional", "Messaggio (opzionale)")}</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={t("offerFlow.addDetailsForSwap", "Aggiungi dettagli per lo scambio")}
                style={[s.input, { height: 100, textAlignVertical: "top" }]}
                multiline
              />
            </>
          )}

          <TouchableOpacity
            style={[s.btn, { marginTop: 18 }, !canSubmit && s.btnDisabled]}
            disabled={!canSubmit}
            onPress={onSubmit}
          >
            <Text style={s.btnTxt}>{t("offerFlow.sendProposal", "Invia proposta")}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 16 },
  target: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12, marginBottom: 12 },
  tTitle: { fontWeight: "800" },
  tMeta: { color: "#6B7280", marginTop: 4 },
  label: { fontWeight: "700", marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  btn: { backgroundColor: "#111827", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnTxt: { color: "#fff", fontWeight: "700" },
  btnOutline: { borderWidth: 1, borderColor: "#E5E7EB", paddingVertical: 12, borderRadius: 12, alignItems: "center", paddingHorizontal: 14 },
  btnOutlineTxt: { color: "#111827", fontWeight: "700" },
  btnDisabled: { opacity: 0.5 },
  card: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12, marginBottom: 10 },
  cardSelected: { borderColor: "#111827", backgroundColor: "#F3F4F6" },
  cardTitle: { fontWeight: "800" },
  cardMeta: { color: "#6B7280", marginTop: 4 },
  pendingBox: { borderWidth: 1, borderColor: "#F59E0B", backgroundColor: "#FFFBEB", borderRadius: 12, padding: 12, marginTop: 8 },
  pendingTitle: { fontWeight: "800", color: "#92400E" },
  pendingMsg: { marginTop: 6, color: "#92400E" },
  row: { flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "space-between" },
});
