// screens/OffersScreen.js — Tab "Proposte" con due sezioni: Ricevute & Inviate
import React, { useCallback, useEffect, useState, useLayoutEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, FlatList } from "react-native";
import { acceptOffer, declineOffer, cancelOffer } from "../lib/offers";
import { listIncomingOffersAny, listOutgoingOffersAny } from "../lib/offers_lists_rpc";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

function IncomingRow({ offer, onAccept, onDecline, busyId, t }) {
  const isBuy = offer.type === "buy";
  const pending = offer.status === "pending";
  const spinning = busyId === offer.id;

  return (
    <View style={s.card}>
      <Text style={s.title}>
        {isBuy ? t("offers.buy", "Acquisto") : t("offers.swap", "Scambio")} • {String(offer.status || "").toUpperCase()}
      </Text>
      <Text style={s.sub}>
        {t("offers.for", "Per")}: {offer.to_listing?.title || offer.to_listing?.id} — {t("offers.from", "Da")}:{" "}
        {isBuy ? t("offers.user", "utente") : (offer.from_listing?.title || offer.from_listing?.id || "-")}
      </Text>
      {isBuy && offer.amount != null && (
        <Text style={s.meta}>
          {t("offers.amount", "Importo")}: {Number(offer.amount).toFixed(2)} {offer.currency || "EUR"}
        </Text>
      )}
      {offer.message ? <Text style={s.msg}>{offer.message}</Text> : null}

      {pending ? (
        <View style={s.row}>
          <TouchableOpacity
            style={[s.btn, s.accept, spinning && s.btnDisabled]}
            disabled={spinning}
            onPress={() => onAccept(offer.id)}
          >
            <Text style={s.acceptTxt}>{spinning ? "..." : t("offers.accept", "Accetta")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, s.decline, spinning && s.btnDisabled]}
            disabled={spinning}
            onPress={() => onDecline(offer.id)}
          >
            <Text style={s.declineTxt}>{spinning ? "..." : t("offers.decline", "Rifiuta")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[s.row, { justifyContent: "flex-start" }]}>
          <View style={s.badge}><Text style={s.badgeTxt}>{offer.status}</Text></View>
        </View>
      )}
    </View>
  );
}

function OutgoingRow({ offer, onCancel, busyId, t }) {
  const isBuy = offer.type === "buy";
  const pending = offer.status === "pending";
  const spinning = busyId === offer.id;

  return (
    <View style={s.card}>
      <Text style={s.title}>
        {isBuy ? t("offers.buy", "Acquisto") : t("offers.swap", "Scambio")} • {String(offer.status || "").toUpperCase()}
      </Text>
      <Text style={s.sub}>
        {t("offers.to", "A")}: {offer.to_listing?.title || offer.to_listing?.id}{" "}
        {!isBuy ? `— ${t("offers.offered", "Offerto")}: ${offer.from_listing?.title || offer.from_listing?.id || "-"}` : ""}
      </Text>
      {isBuy && offer.amount != null && (
        <Text style={s.meta}>
          {t("offers.amount", "Importo")}: {Number(offer.amount).toFixed(2)} {offer.currency || "EUR"}
        </Text>
      )}
      {offer.message ? <Text style={s.msg}>{offer.message}</Text> : null}

      <View style={s.row}>
        <View style={s.badge}><Text style={s.badgeTxt}>{offer.status}</Text></View>
        {pending && (
          <TouchableOpacity
            style={[s.btn, s.decline, spinning && s.btnDisabled]}
            disabled={spinning}
            onPress={() => onCancel(offer.id)}
          >
            <Text style={s.declineTxt}>{spinning ? "..." : t("offers.cancel", "Cancella")}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function OffersScreen() {
  const [tab, setTab] = useState("in"); // "in" / "out"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const navigation = useNavigation();
  const { t, locale } = useI18n();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: tab === "in"
        ? t("offers.receivedOffers", "Offerte ricevute")
        : t("offers.sentOffers", "Offerte inviate"),
    });
  }, [navigation, t, locale, tab]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [inb, outb] = await Promise.all([
        listIncomingOffersAny(),
        listOutgoingOffersAny(),
      ]);
      setIncoming(inb);
      setOutgoing(outb);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const onCancel = async (id) => {
    try {
      setBusyId(id);
      await cancelOffer(id);
      await load();
      Alert.alert(t("common.ok", "OK"), t("offers.canceled", "Proposta cancellata"));
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator /></View>;
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={{ color: "#B91C1C", marginBottom: 12 }}>{error}</Text>
        <TouchableOpacity style={s.btnOutline} onPress={load}>
          <Text style={s.btnOutlineTxt}>{t("common.retry", "Riprova")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const data = tab === "in" ? incoming : outgoing;
  const renderItem = tab === "in"
    ? ({ item }) => <IncomingRow offer={item} onAccept={onAccept} onDecline={onDecline} busyId={busyId} t={t} />
    : ({ item }) => <OutgoingRow offer={item} onCancel={onCancel} busyId={busyId} t={t} />;

  return (
    <View style={s.container}>
      <Text style={s.screenTitle}>{t("offers.proposals", "Proposte")}</Text>

      <View style={s.segmWrap}>
        <TouchableOpacity style={[s.segmBtn, tab === "in" && s.segmActive]} onPress={() => setTab("in")}>
          <Text style={[s.segmTxt, tab === "in" && s.segmTxtActive]}>{t("offers.incoming", "Ricevute")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.segmBtn, tab === "out" && s.segmActive]} onPress={() => setTab("out")}>
          <Text style={[s.segmTxt, tab === "out" && s.segmTxtActive]}>{t("offers.outgoing", "Inviate")}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={data}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <Text style={{ color: "#6B7280" }}>{t("offers.none", "Nessuna proposta")}</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  screenTitle: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  segmWrap: { flexDirection: "row", gap: 8, marginBottom: 12 },
  segmBtn: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 999, paddingVertical: 10, alignItems: "center" },
  segmActive: { backgroundColor: "#111827", borderColor: "#111827" },
  segmTxt: { fontWeight: "800", color: "#111827" },
  segmTxtActive: { color: "#fff" },
  card: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12, backgroundColor: "#fff" },
  title: { fontWeight: "800" },
  sub: { color: "#6B7280", marginTop: 4 },
  meta: { color: "#111827", marginTop: 4, fontWeight: "600" },
  msg: { marginTop: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 12, alignItems: "center" },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignItems: "center" },
  accept: { backgroundColor: "#DCFCE7" },
  acceptTxt: { color: "#166534", fontWeight: "800" },
  decline: { backgroundColor: "#FEE2E2" },
  declineTxt: { color: "#991B1B", fontWeight: "800" },
  btnDisabled: { opacity: 0.6 },
  btnOutline: { borderWidth: 1, borderColor: "#E5E7EB", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  btnOutlineTxt: { fontWeight: "700", color: "#111827" },
  badge: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#F3F4F6", borderRadius: 999 },
  badgeTxt: { fontWeight: "700", color: "#374151" },
});
