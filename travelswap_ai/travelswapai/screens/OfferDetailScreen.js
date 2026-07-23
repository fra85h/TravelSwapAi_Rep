// screens/OfferDetailScreen.js (con CTA “Proponi scambio / acquisto”)
import React, {
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
  useMemo, // 👈 necessario per visibleOffers
} from "react";
import { View, Text, ActivityIndicator, ScrollView, StyleSheet, Alert, TouchableOpacity } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { getListingById, listOffersForListing, getCurrentUser } from "../lib/db";
import { acceptOffer, declineOffer } from "../lib/offers";
import { getOfferHandshake } from "../lib/chat";
import OfferExpiryBadge from "../components/OfferExpiryBadge";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import { normStatusKey } from "../lib/listingStatus";
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
  // Stato di conferma delle proposte accettate (offerId -> handshake), STESSA
  // fonte di verità (get_offer_handshake) usata da ChatScreen e da Attività:
  // qui si vede lo stesso stato "chi ha confermato", coerente con l'altro
  // punto d'ingresso alla chat, senza dover andare su Attività per saperlo.
  const [handshakes, setHandshakes] = useState({});
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
        <Text style={{ color: theme.colors.textMuted }}>{t("offerDetail.notFound", "Annuncio non trovato.")}</Text>
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

      const finalOffers = isOwnerNow ? onlyReceived : rows || [];
      setOffers(finalOffers);
      setData({});

      // Handshake delle proposte accettate: serve a mostrare qui "chi ha
      // confermato" senza dover andare su Attività per scoprirlo.
      const acceptedIds = finalOffers.filter((o) => o.status === "accepted").map((o) => o.id);
      if (acceptedIds.length) {
        const entries = await Promise.all(
          acceptedIds.map(async (oid) => {
            try { return [oid, await getOfferHandshake(oid)]; }
            catch { return [oid, null]; }
          })
        );
        if (reqSeq.current !== reqId) return;
        setHandshakes(Object.fromEntries(entries));
      } else {
        setHandshakes({});
      }
    } catch (e) {
      if (reqSeq.current !== reqId) return;
      setError(e instanceof Error ? e.message : t("common.error", "Errore"));
    } finally {
      if (reqSeq.current === reqId) setLoading(false);
    }
  }, [effectiveId, t]);

  // useFocusEffect (non solo al mount): tornando indietro dalla chat dopo
  // aver confermato, lo stato mostrato qui si aggiorna da solo — altrimenti
  // questa schermata restava con l'ultimo stato visto, disallineata da
  // quello che nel frattempo si vede in Attività/Chat.
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        reqSeq.current++;
      };
    }, [load])
  );

  const isOwner = me?.id && listing?.user_id === me.id;
  // Si può proporre SOLO verso un annuncio attivo (stesso vincolo lato DB,
  // vedi trigger before_insert_offers_enforce: "Puoi proporre solo verso
  // annunci attivi"): un annuncio riservato da un'altra proposta in corso
  // non deve mostrare bottoni che poi il DB rifiuterebbe comunque.
  const isTargetActive = normStatusKey(listing?.status) === "active";

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
        <Text style={{ color: theme.colors.danger, marginBottom: 8 }}>{error}</Text>
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
            {t(`listing.type.${String(listing.type || "").toLowerCase()}`, listing.type || "")} • {listing.location || listing.route_from || "-"}
          </Text>
          <Text style={[s.badge, { marginTop: 8 }]}>{t(`listing.state.${String(listing.status || "").toLowerCase()}`, listing.status || "")}</Text>

          {/* CTA: visibili solo se NON sono il proprietario E l'annuncio è
              attivo (vedi isTargetActive sopra) */}
          {!isOwner && isTargetActive && (
            <View style={s.ctaRow}>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("OfferFlow", {
                    mode: "swap",
                    toListingId: effectiveId,
                    listingId: effectiveId,
                  })
                }
                style={[s.btn, { backgroundColor: theme.colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel={t("detail.actions.proposeSwap", "Proponi scambio")}
              >
                <Text style={[s.btnTxt, { color: theme.colors.boardingText }]}>
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
                style={[s.btn, { backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={t("detail.actions.proposeBuy", "Proponi acquisto")}
              >
                <Text style={[s.btnTxt, { color: theme.colors.text }]}>
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
              {" \u2192 "}
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
                <Text style={s.badgeTxt}>{t(`offers.status.${String(o.status || "").toLowerCase()}`, o.status || "")}</Text>
              </View>
              {pending && <OfferExpiryBadge expiresAt={o.expires_at} />}

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

            {/* Accettata: da qui in poi la conferma finale avviene in chat
                (entrambe le parti devono confermare, vedi "Riservato").
                Stato mostrato con la stessa logica di Attività, così è
                coerente con quello che vede l'altra persona. */}
            {o.status === "accepted" && (
              <>
                <TouchableOpacity
                  style={s.chatLink}
                  onPress={() =>
                    navigation.navigate("Chat", {
                      offerId: o.id,
                      type: o.type,
                      amount: o.amount,
                      currency: o.currency,
                      title: o.to_listing?.title,
                      fromTitle: o.from_listing?.title,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.open", "Apri la chat")}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={15} color={theme.colors.accent} />
                  <Text style={s.chatLinkText}>{t("chat.open", "Apri la chat")}</Text>
                </TouchableOpacity>
                {handshakes[o.id] && (
                  <Text
                    style={[
                      s.cardMeta,
                      handshakes[o.id].disputed && { color: theme.colors.danger, fontWeight: "800" },
                    ]}
                  >
                    {handshakes[o.id].disputed
                      ? t("chat.disputedShort", "⚠️ Problema segnalato")
                      : handshakes[o.id].status === "finalized"
                      ? (isBuy ? t("chat.completedBuy", "Acquisto completato") : t("chat.completed", "Scambio completato"))
                      : handshakes[o.id].iConfirmed
                      ? t("chat.youConfirmedShort", "Hai confermato — attendi l'altra persona")
                      : handshakes[o.id].otherConfirmed
                      ? t("chat.otherConfirmedShort", "In attesa della tua conferma")
                      : (isBuy
                        ? t("chat.pendingConfirmBuy", "Quando l'acquisto è avvenuto, confermate entrambi per chiuderlo.")
                        : t("chat.pendingConfirm", "Quando lo scambio è avvenuto, confermate entrambi per chiuderlo."))}
                  </Text>
                )}
              </>
            )}
          </View>
        );
      })}

      {visibleOffers.length === 0 && (
        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <Text style={{ color: theme.colors.textMuted }}>
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
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: theme.fonts.headingExtraBold, fontSize: 20, marginBottom: 12 },
  box: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  boxTitle: { fontWeight: "800" },
  boxMeta: { color: theme.colors.textMuted, marginTop: 4 },
  badge: { color: theme.colors.textMuted, fontWeight: "700" },

  /* CTA sotto il box annuncio */
  ctaRow: { flexDirection: "row", gap: 10, marginTop: 12 },

  card: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, marginBottom: 10, backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  cardTitle: { fontWeight: "800" },
  cardSub: { color: theme.colors.textMuted, marginTop: 4 },
  cardMeta: { color: theme.colors.text, marginTop: 4, fontWeight: "600" },

  row: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 10 },
  chatLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  chatLinkText: { color: theme.colors.accent, fontWeight: "700" },

  /* Bottoni */
  btn: { backgroundColor: theme.colors.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center" },
  btnTxt: { color: theme.colors.accentOn, fontWeight: "800" },
  btnSm: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, alignItems: "center" },
  btnDisabled: { opacity: 0.6 },
  accept: { backgroundColor: "#DCFCE7" },
  acceptTxt: { color: "#166534", fontWeight: "800" },
  decline: { backgroundColor: "#FEE2E2" },
  declineTxt: { color: "#991B1B", fontWeight: "800" },

  badgeWrap: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.colors.surfaceMuted, borderRadius: 999 },
  badgeTxt: { fontWeight: "700", color: theme.colors.textMuted },
});
