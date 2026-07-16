// screens/AttivitaScreen.js — la casella "Attività": un unico posto per
// tutto ciò che ti riguarda. Quattro sezioni: cose da fare (proposte
// ricevute, catene da confermare), in attesa degli altri, annunci
// trovati dai tuoi avvisi, e lo storico degli scambi.
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useActivity, notifyActivityChanged } from "../lib/ActivityContext";
import { acceptOffer, declineOffer, cancelOffer } from "../lib/offers";
import { markMatchSeen } from "../lib/savedSearches";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

function formatDate(iso, locale) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale || undefined, { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function describeListing(listing, t, locale) {
  if (!listing) return t("chains.unknownListing", "Annuncio non disponibile");
  if (listing.type === "hotel") {
    const city = listing.location || t("chains.unknownCity", "città sconosciuta");
    const d = formatDate(listing.check_in, locale);
    return d ? `${city} · ${d}` : city;
  }
  const from = listing.route_from || "?";
  const to = listing.route_to || "?";
  const d = formatDate(listing.depart_at, locale);
  return d ? `${from} → ${to} · ${d}` : `${from} → ${to}`;
}

function Section({ title, hint, count, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count > 0 ? <View style={styles.countPill}><Text style={styles.countPillText}>{count}</Text></View> : null}
      </View>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export default function AttivitaScreen({ navigation }) {
  const { t, locale } = useI18n();
  const { summary, loading, refresh } = useActivity();
  const [busyId, setBusyId] = useState(null);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // notifyActivityChanged() propaga il cambiamento anche fuori dalla casella
  // Attività (es. Esplora): dopo accettare/rifiutare/annullare uno scambio la
  // disponibilità degli annunci cambia, e il feed si aggiorna da solo.
  const onAccept = useCallback(async (offerId) => {
    setBusyId(offerId);
    try { await acceptOffer(offerId); await refresh(); notifyActivityChanged(); Alert.alert(t("common.ok", "OK"), t("offers.accepted", "Proposta accettata")); }
    catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
    finally { setBusyId(null); }
  }, [refresh, t]);

  const onDecline = useCallback(async (offerId) => {
    setBusyId(offerId);
    try { await declineOffer(offerId); await refresh(); notifyActivityChanged(); }
    catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
    finally { setBusyId(null); }
  }, [refresh, t]);

  const onCancel = useCallback(async (offerId) => {
    setBusyId(offerId);
    try { await cancelOffer(offerId); await refresh(); notifyActivityChanged(); }
    catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
    finally { setBusyId(null); }
  }, [refresh, t]);

  const goChain = useCallback(() => {
    navigation?.navigate?.("ChainProposals");
    navigation?.getParent?.()?.navigate?.("ChainProposals");
  }, [navigation]);

  const goListing = useCallback((listingId, matchId) => {
    if (matchId) markMatchSeen(matchId).catch(() => {});
    if (!listingId) return;
    navigation?.navigate?.("ListingDetail", { id: listingId });
    navigation?.getParent?.()?.navigate?.("ListingDetail", { id: listingId });
  }, [navigation]);

  const offerKindLabel = (o) =>
    o.type === "buy" ? t("offers.buy", "Acquisto") : t("offers.swap", "Scambio");

  // Blocco scambio: rende esplicito "cosa ricevi ⇄ cosa dai", così dalla card
  // si capisce chi scambia cosa (prima si vedeva un solo annuncio).
  const renderExchange = (receiveTitle, giveTitle) => (
    <View style={styles.exchange}>
      <View style={styles.exchangeLine}>
        <Text style={styles.exchangeLabel}>{t("activity.youReceive", "Ricevi")}</Text>
        <Text style={styles.exchangeValue} numberOfLines={2}>{receiveTitle}</Text>
      </View>
      <View style={styles.exchangeArrow}>
        <Ionicons name="swap-vertical" size={16} color={theme.colors.accent} />
      </View>
      <View style={styles.exchangeLine}>
        <Text style={styles.exchangeLabel}>{t("activity.youGive", "Dai")}</Text>
        <Text style={styles.exchangeValue} numberOfLines={2}>{giveTitle}</Text>
      </View>
    </View>
  );

  const renderToDo = (it) => {
    if (it.kind === "offer_in") {
      const o = it.data;
      const busy = busyId === o.id;
      return (
        <View key={it.id} style={styles.card}>
          <Text style={styles.cardKicker}>{t("activity.offerReceived", "Proposta ricevuta")} · {offerKindLabel(o)}</Text>
          {o.type === "swap" ? (
            // Proposta ricevuta: RICEVO il loro annuncio (from_listing), DO il
            // mio (to_listing, quello che hanno scelto).
            renderExchange(
              o.from_listing?.title || t("offerFlow.listing", "Annuncio"),
              o.to_listing?.title || t("offerFlow.listing", "Annuncio")
            )
          ) : (
            <>
              <Text style={styles.cardTitle} numberOfLines={2}>{o.to_listing?.title || t("offerFlow.listing", "Annuncio")}</Text>
              {o.amount != null ? <Text style={styles.cardMeta}>{Number(o.amount).toFixed(2)} {o.currency || "EUR"}</Text> : null}
            </>
          )}
          {o.message ? <Text style={styles.cardMsg}>{o.message}</Text> : null}
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.btn, styles.btnAccept, busy && styles.btnDisabled]} disabled={busy} onPress={() => onAccept(o.id)}>
              <Text style={styles.btnAcceptTxt}>{busy ? "…" : t("offers.accept", "Accetta")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDecline, busy && styles.btnDisabled]} disabled={busy} onPress={() => onDecline(o.id)}>
              <Text style={styles.btnDeclineTxt}>{busy ? "…" : t("offers.decline", "Rifiuta")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    // chain to confirm
    const c = it.data;
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={goChain} activeOpacity={0.85}>
        <Text style={styles.cardKicker}>🔗 {t("chains.badge", "Scambio a 3")}</Text>
        <Text style={styles.cardTitle}>{t("activity.chainToConfirm", "Uno scambio a 3 aspetta la tua conferma")}</Text>
        <Text style={styles.cardMeta}>{t("chains.confirmedCount", "{count} di 3 hanno confermato", { count: c.confirmedCount || 0 })}</Text>
        <View style={styles.linkRow}>
          <Text style={styles.linkText}>{t("activity.review", "Vedi e conferma")}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderWaiting = (it) => {
    if (it.kind === "offer_out") {
      const o = it.data;
      const busy = busyId === o.id;
      return (
        <View key={it.id} style={styles.card}>
          <Text style={styles.cardKicker}>{t("activity.offerSent", "Proposta inviata")} · {offerKindLabel(o)}</Text>
          {o.type === "swap" ? (
            // Proposta inviata: RICEVEREI il loro annuncio (to_listing), DO il
            // mio (from_listing, quello che ho offerto).
            renderExchange(
              o.to_listing?.title || t("offerFlow.listing", "Annuncio"),
              o.from_listing?.title || t("offerFlow.listing", "Annuncio")
            )
          ) : (
            <Text style={styles.cardTitle} numberOfLines={2}>{o.to_listing?.title || t("offerFlow.listing", "Annuncio")}</Text>
          )}
          <View style={styles.actionRow}>
            <View style={styles.statusChip}><Text style={styles.statusChipText}>{t("activity.pending", "In attesa")}</Text></View>
            <TouchableOpacity style={[styles.btn, styles.btnDecline, busy && styles.btnDisabled]} disabled={busy} onPress={() => onCancel(o.id)}>
              <Text style={styles.btnDeclineTxt}>{busy ? "…" : t("offers.cancel", "Cancella")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    const c = it.data;
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={goChain} activeOpacity={0.85}>
        <Text style={styles.cardKicker}>🔗 {t("chains.badge", "Scambio a 3")}</Text>
        <Text style={styles.cardTitle}>{t("activity.chainWaiting", "Hai confermato — in attesa degli altri")}</Text>
        <Text style={styles.cardMeta}>{t("chains.confirmedCount", "{count} di 3 hanno confermato", { count: c.confirmedCount || 0 })}</Text>
      </TouchableOpacity>
    );
  };

  const renderFound = (it) => {
    const m = it.data;
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={() => goListing(m.listing_id, !m.seen ? m.id : null)} activeOpacity={0.85}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardKicker}>🔔 {t("activity.matchFound", "Trovato per un tuo avviso")}</Text>
          {!m.seen ? <View style={styles.newDot} /> : null}
        </View>
        <Text style={styles.cardTitle}>{describeListing(m.listing, t, locale)}</Text>
        {m.listing?.price != null ? <Text style={styles.cardMeta}>{Number(m.listing.price)}€</Text> : null}
      </TouchableOpacity>
    );
  };

  const renderHistory = (it) => {
    const tx = it.data;
    const listing = tx.listing || {};
    const isSwap = tx.ttype === "swap";
    // In uno scambio non si "vende": si cede il proprio annuncio e si riceve
    // quello dell'altro. Etichette dedicate per non confondere con una vendita.
    const dir = tx.direction === "sold"
      ? (isSwap ? t("transactions.directionSwapGiven", "Ceduto") : t("transactions.directionSold", "Venduto"))
      : t("transactions.directionBought", "Ricevuto");
    const typeLabel = isSwap ? t("transactions.typeSwap", "Scambio") : t("transactions.typeSale", "Vendita");
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={() => goListing(listing.id)} activeOpacity={0.85}>
        <Text style={styles.cardKicker}>🧾 {typeLabel} · {dir}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{listing.title || t("savedScreen.untitledListing", "Annuncio")}</Text>
        <Text style={styles.cardMeta}>{formatDate(tx.created_at, locale)}{tx.price != null ? ` · ${tx.price} €` : ""}</Text>
      </TouchableOpacity>
    );
  };

  const total = summary.toDo.length + summary.waiting.length + summary.found.length + summary.history.length;

  if (loading && total === 0) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  if (total === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyWrap}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        <Text style={{ fontSize: 44 }}>🔔</Text>
        <Text style={styles.emptyTitle}>{t("activity.emptyTitle", "Ancora niente da mostrare")}</Text>
        <Text style={styles.emptyText}>
          {t("activity.empty", "Qui trovi tutto ciò che ti riguarda: proposte ricevute e inviate, scambi a 3 da confermare, annunci trovati dai tuoi avvisi e lo storico.")}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      {summary.toDo.length ? (
        <Section title={t("activity.sectionToDo", "Da fare")} count={summary.toDo.length}
          hint={t("activity.sectionToDoHint", "Aspettano una tua risposta.")}>
          {summary.toDo.map(renderToDo)}
        </Section>
      ) : null}

      {summary.waiting.length ? (
        <Section title={t("activity.sectionWaiting", "In attesa")}>
          {summary.waiting.map(renderWaiting)}
        </Section>
      ) : null}

      {summary.found.length ? (
        <Section title={t("activity.sectionFound", "Trovati per te")}
          hint={t("activity.sectionFoundHint", "Annunci nuovi che soddisfano i tuoi avvisi.")}>
          {summary.found.map(renderFound)}
        </Section>
      ) : null}

      {summary.history.length ? (
        <Section title={t("activity.sectionHistory", "Storico")}>
          {summary.history.map(renderHistory)}
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
  emptyWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: theme.colors.background },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: theme.colors.text, marginTop: 10 },
  emptyText: { color: theme.colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 20 },

  section: { marginBottom: 22 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  sectionHint: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2, marginBottom: 10 },
  countPill: { backgroundColor: theme.colors.danger, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  countPillText: { color: "#fff", fontSize: 12, fontWeight: "800" },

  card: {
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 10,
    ...theme.shadow.sm,
  },
  cardKicker: { fontSize: 12, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  cardMeta: { color: theme.colors.textMuted, marginTop: 4 },
  cardMsg: { color: theme.colors.text, marginTop: 8 },
  exchange: {
    marginTop: 2, backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.accent, padding: 10, gap: 2,
  },
  exchangeLine: { gap: 2 },
  exchangeLabel: {
    fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase",
    color: theme.colors.accentOn,
  },
  exchangeValue: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  exchangeArrow: { alignItems: "center", marginVertical: 2 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent },

  actionRow: { flexDirection: "row", gap: 10, marginTop: 12, alignItems: "center" },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  btnAccept: { backgroundColor: "#DCFCE7" },
  btnAcceptTxt: { color: "#166534", fontWeight: "800" },
  btnDecline: { backgroundColor: "#FEE2E2" },
  btnDeclineTxt: { color: "#991B1B", fontWeight: "800" },
  btnDisabled: { opacity: 0.6 },
  statusChip: { flex: 1, backgroundColor: theme.colors.surfaceMuted, borderRadius: 999, paddingVertical: 8, alignItems: "center" },
  statusChipText: { fontWeight: "700", color: theme.colors.textMuted },

  linkRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  linkText: { color: theme.colors.accent, fontWeight: "800" },
});
