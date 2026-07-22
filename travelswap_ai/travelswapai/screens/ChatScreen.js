// screens/ChatScreen.js — chat tra le due parti di una proposta ACCETTATA.
// Si apre da Attività (sezione Chat, card esito, alert di accettazione).
// Realtime: i messaggi dell'altra parte arrivano senza ricaricare; in
// apertura e a ogni messaggio ricevuto i non-letti vengono azzerati (e il
// numeretto sul tab Attività si aggiorna via notifyActivityChanged).
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { listChatMessages, sendChatMessage, markChatRead, subscribeToChat, getOfferHandshake } from "../lib/chat";
import { confirmExchange, cancelAcceptedOffer } from "../lib/offers";
import { getCurrentUser } from "../lib/db";
import { notifyActivityChanged } from "../lib/ActivityContext";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import { formatMoney } from "../lib/number";

function formatTime(iso, locale) {
  try {
    return new Date(iso).toLocaleTimeString(locale || undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function ChatScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t, locale } = useI18n();
  const offerId = route?.params?.offerId;
  const title = route?.params?.title || t("chat.title", "Chat");
  const fromTitle = route?.params?.fromTitle || null;
  const isSwap = String(route?.params?.type || "").toLowerCase() === "swap";
  const amount = route?.params?.amount;
  const currency = route?.params?.currency || "EUR";

  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Stato del "patto": accepted (prenotato, in attesa conferma) o finalized.
  const [handshake, setHandshake] = useState(null);
  const [hsBusy, setHsBusy] = useState(false);
  const listRef = useRef(null);

  const refreshHandshake = useCallback(async () => {
    try { setHandshake(await getOfferHandshake(offerId)); } catch {}
  }, [offerId]);

  useEffect(() => {
    navigation.setOptions?.({ title });
  }, [navigation, title]);

  const load = useCallback(async () => {
    try {
      const [u, msgs] = await Promise.all([
        getCurrentUser().catch(() => null),
        listChatMessages(offerId),
        refreshHandshake(),
      ]);
      setMe(u);
      setMessages(msgs);
      markChatRead(offerId).then(() => notifyActivityChanged());
    } finally {
      setLoading(false);
    }
  }, [offerId, refreshHandshake]);

  const onConfirm = useCallback(() => {
    Alert.alert(
      t("chat.confirmTitle", "Confermi che è tutto ok?"),
      t("chat.confirmMsg", "Conferma solo dopo aver ricevuto e verificato ciò che avete concordato. Quando confermate entrambi, lo scambio si chiude e non è più annullabile."),
      [
        { text: t("common.cancel", "Annulla"), style: "cancel" },
        {
          text: t("chat.confirmCta", "Conferma"),
          onPress: async () => {
            setHsBusy(true);
            try { await confirmExchange(offerId); await refreshHandshake(); notifyActivityChanged(); }
            catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
            finally { setHsBusy(false); }
          },
        },
      ]
    );
  }, [offerId, t, refreshHandshake]);

  const onCancelExchange = useCallback(() => {
    Alert.alert(
      t("chat.cancelTitle", "Annullare lo scambio?"),
      t("chat.cancelMsg", "Usa questa opzione se lo scambio non è andato a buon fine: entrambi gli annunci tornano attivi e disponibili."),
      [
        { text: t("common.close", "Chiudi"), style: "cancel" },
        {
          text: t("chat.cancelCta", "Annulla scambio"),
          style: "destructive",
          onPress: async () => {
            setHsBusy(true);
            try { await cancelAcceptedOffer(offerId); notifyActivityChanged(); navigation.goBack(); }
            catch (e) { Alert.alert(t("common.error", "Errore"), e?.message || String(e)); }
            finally { setHsBusy(false); }
          },
        },
      ]
    );
  }, [offerId, t, navigation]);

  useEffect(() => { if (offerId) load(); }, [offerId, load]);

  // Realtime: nuovi messaggi in push. I propri insert arrivano anche qui:
  // dedup per id, così l'eco non duplica il messaggio appena inviato.
  useEffect(() => {
    if (!offerId) return;
    const unsub = subscribeToChat(offerId, (msg) => {
      if (!msg?.id) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      markChatRead(offerId).then(() => notifyActivityChanged());
    });
    return unsub;
  }, [offerId]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const row = await sendChatMessage(offerId, text);
      setDraft("");
      if (row?.id) {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      }
    } catch (e) {
      // errore visibile ma non invasivo: il testo resta nel campo per riprovare
    } finally {
      setSending(false);
    }
  }, [draft, sending, offerId]);

  const renderItem = ({ item }) => {
    const mine = me?.id && String(item.sender_id) === String(me.id);
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
          <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{formatTime(item.created_at, locale)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: 90, android: 0 })}
      >
        {/* Promemoria discreto di cosa ci si sta scambiando: fisso sopra i
            messaggi (non nello ListHeaderComponent, che scrolla via) — in
            una chat lunga o ripresa dopo giorni non è scontato ricordarselo. */}
        {(title || fromTitle) ? (
          <View style={styles.dealBar}>
            <Ionicons name={isSwap ? "swap-horizontal" : "pricetag-outline"} size={14} color={theme.colors.textMuted} />
            {isSwap && fromTitle ? (
              <Text style={styles.dealBarText} numberOfLines={1}>
                {t("chat.dealSwap", "{a} ⇄ {b}", { a: fromTitle, b: title })}
              </Text>
            ) : (
              <Text style={styles.dealBarText} numberOfLines={1}>
                {Number.isFinite(Number(amount))
                  ? t("chat.dealBuyWithPrice", "{title} — {price}", { title, price: formatMoney(Number(amount), currency) })
                  : title}
              </Text>
            )}
          </View>
        ) : null}

        {/* Patto di scambio: prenotato (in attesa di conferma bilaterale) o
            concluso. È il cuore del Punto 1: lo scambio si "chiude" solo
            quando ENTRAMBI confermano di aver ricevuto ciò che serve. */}
        {handshake?.status === "finalized" ? (
          <View style={[styles.hsBar, styles.hsDone]}>
            <Ionicons name="checkmark-done-circle" size={16} color="#166534" />
            <Text style={[styles.hsText, { color: "#166534" }]}>{t("chat.completed", "Scambio completato")}</Text>
          </View>
        ) : handshake?.status === "accepted" ? (
          <View style={styles.hsBar}>
            {handshake.iConfirmed ? (
              <Text style={styles.hsText}>
                {handshake.otherConfirmed
                  ? t("chat.bothConfirming", "Conferma in corso…")
                  : t("chat.youConfirmed", "Hai confermato. In attesa che l'altra persona confermi.")}
              </Text>
            ) : (
              <Text style={styles.hsText}>
                {handshake.otherConfirmed
                  ? t("chat.otherConfirmed", "L'altra persona ha confermato. Conferma anche tu quando è tutto ok.")
                  : t("chat.pendingConfirm", "Quando lo scambio è avvenuto, confermate entrambi per chiuderlo.")}
              </Text>
            )}
            <View style={styles.hsBtns}>
              {!handshake.iConfirmed ? (
                <TouchableOpacity style={[styles.hsBtn, styles.hsBtnPrimary, hsBusy && { opacity: 0.6 }]} disabled={hsBusy} onPress={onConfirm}>
                  <Text style={styles.hsBtnPrimaryTxt}>{t("chat.confirmDone", "Scambio avvenuto")}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.hsBtn, styles.hsBtnGhost, hsBusy && { opacity: 0.6 }]} disabled={hsBusy} onPress={onCancelExchange}>
                <Text style={styles.hsBtnGhostTxt}>{t("chat.cancelCta", "Annulla scambio")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
            ListHeaderComponent={
              // Regole di sicurezza fisse in testa alla conversazione: non un
              // messaggio a DB, così restano sempre visibili e traducibili.
              <View style={styles.rulesBox}>
                <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.textMuted} style={{ marginTop: 1 }} />
                <Text style={styles.rulesText}>
                  {t("chat.rules", "Organizzate qui lo scambio. Non condividere dati sensibili (carte, documenti) e diffida di chi chiede di pagare fuori dai canali concordati. Il PNR resta protetto nell'annuncio.")}
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {t("chat.empty", "Ancora nessun messaggio: rompi il ghiaccio e organizzate lo scambio.")}
              </Text>
            }
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("chat.placeholder", "Scrivi un messaggio…")}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            onPress={onSend}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={t("chat.send", "Invia")}
          >
            {sending ? <ActivityIndicator size="small" color={theme.colors.accentOn} /> : <Ionicons name="send" size={18} color={theme.colors.accentOn} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  dealBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: theme.colors.surfaceMuted,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  dealBarText: { flex: 1, color: theme.colors.textMuted, fontSize: 12.5, fontWeight: "600" },

  hsBar: {
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
    backgroundColor: theme.colors.accentSoft,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  hsDone: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#DCFCE7" },
  hsText: { color: theme.colors.text, fontSize: 12.5, lineHeight: 17 },
  hsBtns: { flexDirection: "row", gap: 8 },
  hsBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  hsBtnPrimary: { backgroundColor: theme.colors.accent },
  hsBtnPrimaryTxt: { color: theme.colors.accentOn, fontWeight: "800", fontSize: 13 },
  hsBtnGhost: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  hsBtnGhostTxt: { color: theme.colors.text, fontWeight: "700", fontSize: 13 },

  rulesBox: {
    flexDirection: "row", gap: 8,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.lg, padding: 10, marginBottom: 12,
  },
  rulesText: { flex: 1, color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  emptyText: { color: theme.colors.textMuted, textAlign: "center", marginTop: 24 },

  bubbleRow: { flexDirection: "row", marginBottom: 8 },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: theme.colors.accentOn },
  bubbleTime: { fontSize: 10, color: theme.colors.textMuted, marginTop: 3, alignSelf: "flex-end" },
  bubbleTimeMine: { color: theme.colors.accentOn, opacity: 0.8 },

  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 9,
    color: theme.colors.text, backgroundColor: theme.colors.background,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.accent,
    alignItems: "center", justifyContent: "center",
  },
});
