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
import { acceptOffer, declineOffer, cancelOffer, markMyResolvedOffersSeen, releaseMyStaleReservations } from "../lib/offers";
import { markMatchSeen } from "../lib/savedSearches";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import OfferExpiryBadge from "../components/OfferExpiryBadge";
import { formatMoney } from "../lib/number";

// Kicker uniforme: icona + testo. Prima alcune card avevano un'emoji
// (🔗🔔🧾) e le card offerta nessuna icona — sistema visivo incoerente.
function KickerRow({ icon, color, children }) {
  return (
    <View style={styles.kickerRow}>
      <Ionicons name={icon} size={14} color={color || theme.colors.textMuted} style={{ marginRight: 5 }} />
      <Text style={styles.cardKicker} numberOfLines={1}>{children}</Text>
    </View>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={[styles.skel, { width: "40%", height: 12, borderRadius: 6 }]} />
      <View style={{ height: 10 }} />
      <View style={[styles.skel, { width: "70%", height: 16, borderRadius: 6 }]} />
      <View style={{ height: 12 }} />
      <View style={[styles.skel, { width: "100%", height: 36, borderRadius: 10 }]} />
    </View>
  );
}

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

function Section({ title, hint, count, urgent, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count > 0 ? (
          // Rosso solo per la sezione che richiede un'azione ("Da fare");
          // altrove un conteggio rosso suggerirebbe un'urgenza inesistente.
          <View style={[styles.countPill, !urgent && styles.countPillNeutral]}>
            <Text style={[styles.countPillText, !urgent && styles.countPillTextNeutral]}>{count}</Text>
          </View>
        ) : null}
      </View>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export default function AttivitaScreen({ navigation }) {
  const { t, locale } = useI18n();
  const { summary, loading, refresh } = useActivity();
  // Set, non un singolo id: con un solo busyId, avviare un'azione su una
  // SECONDA card (es. rifiuta offerta B) mentre la prima (accetta offerta
  // A) è ancora in volo faceva sì che i bottoni di A tornassero cliccabili
  // — busyId ormai puntava a B — permettendo un doppio invio della stessa
  // azione su A prima che la prima risposta fosse arrivata.
  const [busyIds, setBusyIds] = useState(() => new Set());

  // L'ordine conta: prima refresh() legge le proposte risolte non ancora
  // viste (per mostrarle in questa visita), SOLO DOPO le marchiamo viste —
  // al contrario sparirebbero prima ancora di essere mostrate.
  useFocusEffect(useCallback(() => {
    (async () => {
      // Prima libera le prenotazioni scadute (annunci di nuovo attivi), così
      // il refresh successivo riflette già lo stato aggiornato.
      await releaseMyStaleReservations();
      await refresh();
      markMyResolvedOffersSeen().catch(() => {});
    })();
  }, [refresh]));

  const setBusy = useCallback((id, isBusy) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  // notifyActivityChanged() propaga il cambiamento anche fuori dalla casella
  // Attività (es. Esplora): dopo accettare/rifiutare/annullare uno scambio la
  // disponibilità degli annunci cambia, e il feed si aggiorna da solo. Il
  // provider di questa stessa schermata è anche in ascolto su quel canale
  // (vedi ActivityContext.js), quindi chiamare refresh() qui in più
  // duplicherebbe inutilmente il caricamento (5 query in parallelo) ad ogni
  // accetta/rifiuta/annulla.
  const doAccept = useCallback(async (o) => {
    const offerId = o.id;
    setBusy(offerId, true);
    try {
      await acceptOffer(offerId);
      notifyActivityChanged();
      // Momento di massimo bisogno: appena accettata, le due parti devono
      // organizzare lo scambio — la chat si apre da qui con un tap, già
      // "consapevole" di cosa si stanno scambiando (vedi header in ChatScreen).
      Alert.alert(
        t("offers.acceptedTitle", "Proposta accettata"),
        t("offers.acceptedChatMsg", "Ora potete organizzare lo scambio: apri la chat per accordarti con l'altra persona."),
        [
          { text: t("common.close", "Chiudi"), style: "cancel" },
          {
            text: t("chat.open", "Apri la chat"),
            onPress: () => navigation?.navigate?.("Chat", {
              offerId, type: o.type, amount: o.amount, currency: o.currency,
              title: o.to_listing?.title, fromTitle: o.from_listing?.title,
            }),
          },
        ]
      );
    }
    catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
    finally { setBusy(offerId, false); }
  }, [setBusy, t, navigation]);

  // Conferma prima di accettare: accettare PRENOTA lo scambio (reversibile) e
  // rifiuta le altre proposte in sospeso. Lo scambio si chiude solo quando
  // entrambe le parti confermano dalla chat che è avvenuto.
  const onAccept = useCallback((o) => {
    Alert.alert(
      t("activity.acceptConfirmTitle", "Accettare la proposta?"),
      t("activity.acceptConfirmMsg2", "Accettando, prenoti lo scambio e le altre proposte sullo stesso annuncio vengono rifiutate. Lo scambio si chiude solo quando entrambi confermate dalla chat che è avvenuto."),
      [
        { text: t("common.cancel", "Annulla"), style: "cancel" },
        { text: t("offers.accept", "Accetta"), onPress: () => doAccept(o) },
      ]
    );
  }, [t, doAccept]);

  const onDecline = useCallback(async (offerId) => {
    setBusy(offerId, true);
    try { await declineOffer(offerId); notifyActivityChanged(); }
    catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
    finally { setBusy(offerId, false); }
  }, [setBusy, t]);

  const onCancel = useCallback(async (offerId) => {
    setBusy(offerId, true);
    try { await cancelOffer(offerId); notifyActivityChanged(); }
    catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
    finally { setBusy(offerId, false); }
  }, [setBusy, t]);

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
      const busy = busyIds.has(o.id);
      return (
        <TouchableOpacity key={it.id} style={styles.card} onPress={() => goListing(o.to_listing?.id)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={o.to_listing?.title || t("offerFlow.listing", "Annuncio")}>
          <View style={styles.rowBetween}>
            <KickerRow icon="arrow-down-circle-outline">{t("activity.offerReceived", "Proposta ricevuta")} · {offerKindLabel(o)}</KickerRow>
            <OfferExpiryBadge expiresAt={o.expires_at} />
          </View>
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
              {o.amount != null ? <Text style={styles.cardMeta}>{formatMoney(o.amount, o.currency)}</Text> : null}
            </>
          )}
          {o.message ? <Text style={styles.cardMsg}>{o.message}</Text> : null}
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.btn, styles.btnAccept, busy && styles.btnDisabled]} disabled={busy} onPress={() => onAccept(o)} accessibilityRole="button" accessibilityLabel={t("offers.accept", "Accetta")}>
              {busy ? <ActivityIndicator size="small" color="#166534" /> : <Text style={styles.btnAcceptTxt}>{t("offers.accept", "Accetta")}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDecline, busy && styles.btnDisabled]} disabled={busy} onPress={() => onDecline(o.id)} accessibilityRole="button" accessibilityLabel={t("offers.decline", "Rifiuta")}>
              {busy ? <ActivityIndicator size="small" color="#991B1B" /> : <Text style={styles.btnDeclineTxt}>{t("offers.decline", "Rifiuta")}</Text>}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }
    // chain to confirm
    const c = it.data;
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={goChain} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t("activity.chainToConfirm", "Uno scambio a 3 aspetta la tua conferma")}>
        <KickerRow icon="git-network-outline" color={theme.colors.accent}>{t("chains.badge", "Scambio a 3")}</KickerRow>
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
      const busy = busyIds.has(o.id);
      return (
        <TouchableOpacity key={it.id} style={styles.card} onPress={() => goListing(o.to_listing?.id)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={o.to_listing?.title || t("offerFlow.listing", "Annuncio")}>
          <KickerRow icon="paper-plane-outline">{t("activity.offerSent", "Proposta inviata")} · {offerKindLabel(o)}</KickerRow>
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
          {/* Teaser chat: gestisce l'aspettativa e tiene l'accordo in app */}
          <Text style={styles.chatTeaser}>
            {t("chat.teaserWaiting", "Potrai chattare con l'altra persona quando la proposta sarà accettata.")}
          </Text>
          <View style={styles.actionRow}>
            <OfferExpiryBadge expiresAt={o.expires_at} pill />
            <TouchableOpacity style={[styles.btn, styles.btnDecline, busy && styles.btnDisabled]} disabled={busy} onPress={() => onCancel(o.id)} accessibilityRole="button" accessibilityLabel={t("offers.cancel", "Cancella")}>
              {busy ? <ActivityIndicator size="small" color="#991B1B" /> : <Text style={styles.btnDeclineTxt}>{t("offers.cancel", "Cancella")}</Text>}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }
    const c = it.data;
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={goChain} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t("activity.chainWaiting", "Hai confermato — in attesa degli altri")}>
        <KickerRow icon="git-network-outline" color={theme.colors.accent}>{t("chains.badge", "Scambio a 3")}</KickerRow>
        <Text style={styles.cardTitle}>{t("activity.chainWaiting", "Hai confermato — in attesa degli altri")}</Text>
        <Text style={styles.cardMeta}>{t("chains.confirmedCount", "{count} di 3 hanno confermato", { count: c.confirmedCount || 0 })}</Text>
      </TouchableOpacity>
    );
  };

  // Esito di una proposta INVIATA appena risolta: prima non c'era alcun
  // segnale per il proponente quando l'altra parte accettava o rifiutava,
  // il flusso si fermava lì. Sparisce da qui alla prossima apertura di
  // Attività (markMyResolvedOffersSeen la marca vista, vedi useFocusEffect).
  // Se accettata, il tap apre direttamente la chat (la card della sezione
  // Chat resta comunque l'ingresso stabile anche dopo).
  const renderResolved = (it) => {
    const o = it.data;
    const accepted = String(o.status || "").toLowerCase() === "accepted";
    return (
      <TouchableOpacity
        key={it.id}
        style={styles.card}
        onPress={() => accepted
          ? navigation?.navigate?.("Chat", { offerId: o.id, type: o.type, amount: o.amount, currency: o.currency, title: o.to_listing?.title, fromTitle: o.from_listing?.title })
          : goListing(o.to_listing?.id)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={o.to_listing?.title || t("offerFlow.listing", "Annuncio")}
      >
        <KickerRow icon={accepted ? "checkmark-circle-outline" : "close-circle-outline"} color={accepted ? "#166534" : "#991B1B"}>
          {accepted ? t("activity.offerWasAccepted", "La tua proposta è stata accettata") : t("activity.offerWasDeclined", "La tua proposta è stata rifiutata")}
        </KickerRow>
        <Text style={styles.cardTitle} numberOfLines={2}>{o.to_listing?.title || t("offerFlow.listing", "Annuncio")}</Text>
        {accepted ? (
          <View style={styles.linkRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={15} color={theme.colors.accent} />
            <Text style={styles.linkText}>{t("chat.open", "Apri la chat")}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  // Chat delle proposte accettate: l'ingresso STABILE alla conversazione
  // (le card di esito spariscono una volta viste, questa resta).
  const renderChat = (c) => {
    const isSwap = String(c.type || "").toLowerCase() === "swap";
    return (
      <TouchableOpacity
        key={"chat_" + c.offerId}
        style={styles.card}
        onPress={() => navigation?.navigate?.("Chat", { offerId: c.offerId, type: c.type, title: c.toListingTitle, fromTitle: c.fromListingTitle })}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={c.toListingTitle || t("offerFlow.listing", "Annuncio")}
      >
        <View style={styles.rowBetween}>
          <KickerRow icon="chatbubble-ellipses-outline" color={theme.colors.accent}>
            {isSwap ? t("offers.swap", "Scambio") : t("offers.buy", "Acquisto")}
          </KickerRow>
          {c.unreadCount > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{c.unreadCount}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{c.toListingTitle || t("offerFlow.listing", "Annuncio")}</Text>
        {/* Stato del patto: mostra cosa manca per chiudere lo scambio. */}
        {c.status === "finalized" ? (
          <Text style={[styles.cardMeta, { color: "#166534", fontWeight: "700" }]}>{t("chat.completed", "Scambio completato")}</Text>
        ) : c.iConfirmed ? (
          <Text style={[styles.cardMeta, { fontWeight: "700" }]}>{t("chat.youConfirmedShort", "Hai confermato — attendi l'altra persona")}</Text>
        ) : c.otherConfirmed ? (
          <Text style={[styles.cardMeta, { fontWeight: "700", color: theme.colors.accent }]}>{t("chat.otherConfirmedShort", "In attesa della tua conferma")}</Text>
        ) : (
          <Text style={styles.cardMeta} numberOfLines={1}>
            {c.lastBody || t("chat.noMessagesYet", "Nessun messaggio: inizia tu.")}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderFound = (it) => {
    const m = it.data;
    return (
      <TouchableOpacity key={it.id} style={styles.card} onPress={() => goListing(m.listing_id, !m.seen ? m.id : null)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={describeListing(m.listing, t, locale)}>
        <View style={styles.rowBetween}>
          <KickerRow icon="notifications-outline">{t("activity.matchFound", "Trovato per un tuo avviso")}</KickerRow>
          {!m.seen ? <View style={styles.newDot} /> : null}
        </View>
        <Text style={styles.cardTitle}>{describeListing(m.listing, t, locale)}</Text>
        {m.listing?.price != null ? <Text style={styles.cardMeta}>{formatMoney(m.listing.price, m.listing.currency)}</Text> : null}
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
      <TouchableOpacity key={it.id} style={styles.card} onPress={() => goListing(listing.id)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={listing.title || t("savedScreen.untitledListing", "Annuncio")}>
        <KickerRow icon="receipt-outline">{typeLabel} · {dir}</KickerRow>
        <Text style={styles.cardTitle} numberOfLines={2}>{listing.title || t("savedScreen.untitledListing", "Annuncio")}</Text>
        <Text style={styles.cardMeta}>{formatDate(tx.created_at, locale)}{tx.price != null ? ` · ${formatMoney(tx.price, tx.currency)}` : ""}</Text>
      </TouchableOpacity>
    );
  };

  // Proposta (ricevuta o inviata) scaduta senza risposta in tempo: prima
  // spariva semplicemente da Attività senza lasciare traccia, come se non
  // fosse mai esistita.
  const renderExpired = (it) => {
    const o = it.data;
    const isIncoming = it.kind === "offer_in_expired";
    return (
      <TouchableOpacity key={it.id} style={[styles.card, { opacity: 0.75 }]} onPress={() => goListing(o.to_listing?.id)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={o.to_listing?.title || t("offerFlow.listing", "Annuncio")}>
        <KickerRow icon="time-outline">
          {isIncoming ? t("activity.offerExpiredReceived", "Proposta ricevuta scaduta") : t("activity.offerExpiredSent", "Proposta inviata scaduta")}
        </KickerRow>
        <Text style={styles.cardTitle} numberOfLines={2}>{o.to_listing?.title || t("offerFlow.listing", "Annuncio")}</Text>
      </TouchableOpacity>
    );
  };

  const total = summary.toDo.length + summary.waiting.length + summary.resolved.length
    + summary.found.length + summary.history.length + summary.expired.length
    + (summary.chats?.length || 0);

  if (loading && total === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </ScrollView>
    );
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
        <Section title={t("activity.sectionToDo", "Da fare")} count={summary.toDo.length} urgent
          hint={t("activity.sectionToDoHint", "Aspettano una tua risposta.")}>
          {summary.toDo.map(renderToDo)}
        </Section>
      ) : null}

      {summary.waiting.length ? (
        <Section title={t("activity.sectionWaiting", "In attesa")} count={summary.waiting.length}
          hint={t("activity.sectionWaitingHint", "Aspetti una risposta dagli altri.")}>
          {summary.waiting.map(renderWaiting)}
        </Section>
      ) : null}

      {summary.resolved.length ? (
        <Section title={t("activity.sectionResolved", "Esito delle tue proposte")} count={summary.resolved.length} urgent
          hint={t("activity.sectionResolvedHint", "Novità: una tua proposta ha ricevuto risposta.")}>
          {summary.resolved.map(renderResolved)}
        </Section>
      ) : null}

      {summary.chats?.length ? (
        <Section
          title={t("activity.sectionChats", "Chat")}
          count={(summary.chats || []).reduce((n, c) => n + (c.unreadCount || 0), 0)}
          urgent
          hint={t("activity.sectionChatsHint", "Organizza qui lo scambio con l'altra persona.")}
        >
          {summary.chats.map(renderChat)}
        </Section>
      ) : null}

      {summary.found.length ? (
        <Section title={t("activity.sectionFound", "Trovati per te")} count={summary.found.length}
          hint={t("activity.sectionFoundHint", "Annunci nuovi che soddisfano i tuoi avvisi.")}>
          {summary.found.map(renderFound)}
        </Section>
      ) : null}

      {summary.history.length ? (
        <Section title={t("activity.sectionHistory", "Storico")} count={summary.history.length}>
          {summary.history.map(renderHistory)}
        </Section>
      ) : null}

      {summary.expired.length ? (
        <Section title={t("activity.sectionExpired", "Scadute")} count={summary.expired.length}
          hint={t("activity.sectionExpiredHint", "Proposte senza risposta in tempo.")}>
          {summary.expired.map(renderExpired)}
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: theme.colors.background },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: theme.colors.text, marginTop: 10 },
  emptyText: { color: theme.colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 20 },

  section: { marginBottom: 22 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  sectionHint: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2, marginBottom: 10 },
  countPill: { backgroundColor: theme.colors.danger, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  countPillText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  countPillNeutral: { backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border },
  countPillTextNeutral: { color: theme.colors.textMuted },

  card: {
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 10,
    ...theme.shadow.sm,
  },
  kickerRow: { flexDirection: "row", alignItems: "center", marginBottom: 4, flexShrink: 1 },
  cardKicker: { fontSize: 12, fontWeight: "700", color: theme.colors.textMuted, flexShrink: 1 },
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

  linkRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  linkText: { color: theme.colors.accent, fontWeight: "800" },
  chatTeaser: { color: theme.colors.textMuted, fontSize: 12, marginTop: 8, fontStyle: "italic" },

  skel: { backgroundColor: theme.colors.border },
});
