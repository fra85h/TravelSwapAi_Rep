// screens/OfferDetailScreen.js (con CTA “Proponi scambio / acquisto”)
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
  useMemo, // 👈 necessario per visibleOffers
} from "react";
import { View, Text, ActivityIndicator, ScrollView, StyleSheet, Alert, TouchableOpacity } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { getListingById, listOffersForListing, getCurrentUser } from "../lib/db";
import { acceptOffer, declineOffer } from "../lib/offers";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
export default function OfferDetailScreen() {
  const route = useRoute();
  const { t, locale } = useI18n();
  const navigation = useNavigation();

  // Supporto a proposta specifica, mantenendo la compatibilità con i param esistenti
  const {
    listingId,
    id,
    offerId,
    proposalId,              // ID della proposta selezionata (freccina)
    showOnlyThisProposal,    // flag per mostrare solo quella proposta
  } = route.params ?? {};
  const effectiveId = listingId ?? id ?? offerId;

  const [me, setMe] = useState(null);
  const [listing, setListing] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const reqSeq = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({ title: t("offerDetail.title", "Dettaglio offerta") });
  }, [navigation, t, locale]);

  // Tutti i hook devono essere chiamati prima di qualsiasi return condizionale
  const visibleOffers = useMemo(() => {
    if (showOnlyThisProposal && proposalId) {
      return (offers || []).filter((o) => String(o?.id) === String(proposalId));
    }
    return offers || [];
  }, [offers, showOnlyThisProposal, proposalId]);

  if (!effectiveId) {
    return (
      <View style={s.center}>
        <Text style={{ color: "#6B7280" }}>{t("offerDetail.notFound", "Annuncio non trovato.")}</Text>
      </View>
    );
  }

  const load = useCallback(async () => {
    const reqId = ++reqSeq.current;
    setError(null);
    setLoading(true);
    try {
      const u = await getCurrentUser();
      const l = await getListingById(effectiveId);
      if (reqSeq.current !== reqId) return;
      setMe(u);
      setListing(l);

      const rows = await listOffersForListing(effectiveId);
      if (reqSeq.current !== reqId) return;

      const isOwnerNow = u?.id && l?.user_id === u.id;
      const onlyReceived =
        rows?.filter(
          (o) =>
            (o?.to_listing?.id && o.to_listing.id === l.id) ||
            (o?.to_listing_id && o.to_listing_id === l.id)
        ) ?? [];

      setOffers(isOwnerNow ? onlyReceived : rows || []);
      setData({});
    } catch (e) {
      if (reqSeq.current !== reqId) return;
      setError(e instanceof Error ? e.message : t("common.error", "Errore"));
    } finally {
      if (reqSeq.current === reqId) setLoading(false);
    }
  }, [effectiveId, t]);

  useEffect(() => {
    load();
    return () => {
      reqSeq.current++;
    };
  }, [load]);

  const isOwner = me?.id && listing?.user_id === me.id;

  const onAccept = async (id) => {
    try {
      setBusyId(id);
      await acceptOffer(id);
      await load();
      Alert.alert(t("common.ok", "OK"), t("offers.accepted", "Proposta accettata"));
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onDecline = async (id) => {
    try {
      setBusyId(id);
      await declineOffer(id);
      await load();
      Alert.alert(t("common.ok", "OK"), t("offers.declined", "Proposta rifiutata"));
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={{ color: "#B91C1C", marginBottom: 8 }}>{error}</Text>
        <TouchableOpacity style={s.btn} onPress={load}>
          <Text style={s.btnTxt}>{t("common.retry", "Riprova")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={s.title}>{t("offerDetail.proposals", "Dettaglio proposte")}</Text>

      {listing && (
        <View style={s.box}>
          <Text style={s.boxTitle}>{listing.title || t("offerDetail.listing", "Annuncio")}</Text>
          <Text style={s.boxMeta}>
            {listing.type} • {listing.location || listing.route_from || "-"}
          </Text>
          <Text style={[s.badge, { marginTop: 8 }]}>{listing.status}</Text>

          {/* CTA: visibili solo se NON sono il proprietario */}
          {!isOwner && (
            <View style={s.ctaRow}>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("OfferFlow", {
                    mode: "swap",
                    toListingId: effectiveId,
                    listingId: effectiveId,
                  })
                }
                style={[s.btn, { backgroundColor: "#111827" }]}
                accessibilityRole="button"
                accessibilityLabel={t("detail.actions.proposeSwap", "Proponi scambio")}
              >
                <Text style={[s.btnTxt, { color: "#fff" }]}>
                  {t("detail.actions.proposeSwap", "Proponi scambio")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("OfferFlow", {
                    mode: "buy",
                    toListingId: effectiveId,
                    listingId: effectiveId,
                  })
                }
                style={[s.btn, { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" }]}
                accessibilityRole="button"
                accessibilityLabel={t("detail.actions.proposeBuy", "Proponi acquisto")}
              >
                <Text style={[s.btnTxt, { color: "#111827" }]}>
                  {t("detail.actions.proposeBuy", "Proponi acquisto")}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <View style={{ height: 12 }} />

      {visibleOffers.map((o) => {
        const isBuy = o.type === "buy";
        const pending = o.status === "pending";
        return (
          <View key={o.id} style={s.card}>
            <Text style={s.cardTitle}>
              {isBuy
                ? t("offerDetail.buyProposal", "Proposta di acquisto")
                : t("offerDetail.swapProposal", "Proposta di scambio")}
            </Text>

            <Text style={s.cardSub}>
              {isBuy
                ? `${t("offerDetail.fromUser", "Da")}: ${t("offers.user", "utente")}`
                : `${t("offerDetail.from", "Da")}: ${o.from_listing?.title || o.from_listing?.id || "-"}`}
              {" "}\u2192{" "}
              {t("offerDetail.to", "per")}: {o.to_listing?.title || listing?.title || o.to_listing?.id}
            </Text>

            {isBuy && o.amount != null && (
              <Text style={s.cardMeta}>
                {t("offerDetail.offerAmount", "Offerta")}: {Number(o.amount).toFixed(2)} {o.currency || "EUR"}
              </Text>
            )}

            {o.message ? <Text style={{ marginTop: 6 }}>{o.message}</Text> : null}

            <View style={s.row}>
              <View style={[s.badgeWrap]}>
                <Text style={s.badgeTxt}>{o.status}</Text>
              </View>

              {isOwner && pending && (
                <View style={[s.row, { marginLeft: "auto" }]}>
                  <TouchableOpacity
                    style={[s.btnSm, s.accept, busyId === o.id && s.btnDisabled]}
                    disabled={busyId === o.id}
                    onPress={() => onAccept(o.id)}
                  >
                    <Text style={s.acceptTxt}>{busyId === o.id ? "..." : t("offers.accept", "Accetta")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.btnSm, s.decline, busyId === o.id && s.btnDisabled]}
                    disabled={busyId === o.id}
                    onPress={() => onDecline(o.id)}
                  >
                    <Text style={s.declineTxt}>{busyId === o.id ? "..." : t("offers.decline", "Rifiuta")}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        );
      })}

      {visibleOffers.length === 0 && (
        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <Text style={{ color: "#6B7280" }}>
            {showOnlyThisProposal && proposalId
              ? t("offers.noneOne", "Nessuna proposta trovata per l’ID selezionato")
              : t("offers.none", "Nessuna proposta")}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  box: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12 },
  boxTitle: { fontWeight: "800" },
  boxMeta: { color: "#6B7280", marginTop: 4 },
  badge: { color: "#374151", fontWeight: "700" },

  /* CTA sotto il box annuncio */
  ctaRow: { flexDirection: "row", gap: 10, marginTop: 12 },

  card: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: "#fff" },
  cardTitle: { fontWeight: "800" },
  cardSub: { color: "#6B7280", marginTop: 4 },
  cardMeta: { color: "#111827", marginTop: 4, fontWeight: "600" },

  row: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 10 },

  /* Bottoni */
  btn: { backgroundColor: "#111827", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center" },
  btnTxt: { color: "#fff", fontWeight: "800" },
  btnSm: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, alignItems: "center" },
  btnDisabled: { opacity: 0.6 },
  accept: { backgroundColor: "#DCFCE7" },
  acceptTxt: { color: "#166534", fontWeight: "800" },
  decline: { backgroundColor: "#FEE2E2" },
  declineTxt: { color: "#991B1B", fontWeight: "800" },

  badgeWrap: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#F3F4F6", borderRadius: 999 },
  badgeTxt: { fontWeight: "700", color: "#374151" },
});
