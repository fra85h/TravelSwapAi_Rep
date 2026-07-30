// screens/ChainChatScreen.js — chat tra i 3 partecipanti di uno swap a 3
// CONCLUSO. A differenza della chat 1:1 (ChatScreen), qui non c'è alcun
// handshake da gestire: la catena è già 'completed' quando questa chat si
// apre (tutti e 3 hanno confermato, vedi confirm_chain_participant), quindi
// niente da confermare/annullare/contestare — solo organizzare la consegna.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  listChainChatMessages, sendChainChatMessage, markChainChatRead, subscribeToChainChat,
} from "../lib/chainChat";
import { getCurrentUser } from "../lib/db";
import { notifyActivityChanged } from "../lib/ActivityContext";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import HelpModal from "../components/HelpModal";

function formatTime(iso, locale) {
  try {
    return new Date(iso).toLocaleTimeString(locale || undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function ChainChatScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t, locale } = useI18n();
  const chainId = route?.params?.chainId;
  const giveTitle = route?.params?.giveTitle || null;
  const receiveTitle = route?.params?.receiveTitle || null;

  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // Centro assistenza contestuale (analisi empatia, sezione E punto 16).
  const [helpOpen, setHelpOpen] = useState(false);
  const helpItems = [
    {
      q: t("chains.help.q1Title", "🕐 Un partecipante non risponde da un po'?"),
      a: t("chains.help.q1Body", "Aspetta ancora un po': a volte capita. Se il silenzio si prolunga, prova a scrivere di nuovo — in un gruppo di 3 basta un messaggio per rimettere tutti d'accordo sui tempi."),
    },
    {
      q: t("chains.help.q2Title", "🎫 Hai ricevuto qualcosa di diverso da quanto concordato, o il biglietto ti sembra falso?"),
      a: t("chains.help.q2Body", "Scrivilo subito qui in chat, così resta una traccia visibile a tutti e 3. Per importi rilevanti, valuta anche una segnalazione alla Polizia Postale."),
    },
    {
      q: t("chains.help.q3Title", "🔄 Perché questa chat si apre solo a scambio concluso?"),
      a: t("chains.help.q3Body", "Perché lo scambio a 3 si chiude solo quando TUTTI E 3 confermano: fino a quel momento nessun annuncio viene toccato, quindi non c'è ancora nulla da consegnare."),
    },
  ];

  useEffect(() => {
    navigation.setOptions?.({
      title: t("chains.badge", "Scambio a 3"),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setHelpOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("chat.help.open", "Cosa fare se...")}
          style={{ paddingHorizontal: 8 }}
        >
          <Ionicons name="help-circle-outline" size={24} color={theme.colors.accent} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, t]);

  const load = useCallback(async () => {
    try {
      const [u, msgs] = await Promise.all([
        getCurrentUser().catch(() => null),
        listChainChatMessages(chainId),
      ]);
      setMe(u);
      setMessages(msgs);
      markChainChatRead(chainId).then(() => notifyActivityChanged());
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => { if (chainId) load(); }, [chainId, load]);

  // Realtime: nuovi messaggi in push. Dedup per id, così l'eco del proprio
  // insert non duplica il messaggio appena inviato (stesso pattern di ChatScreen).
  useEffect(() => {
    if (!chainId) return;
    const unsub = subscribeToChainChat(chainId, (msg) => {
      if (!msg?.id) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      markChainChatRead(chainId).then(() => notifyActivityChanged());
    });
    return unsub;
  }, [chainId]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const row = await sendChainChatMessage(chainId, text);
      setDraft("");
      if (row?.id) {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      }
    } catch (e) {
      // errore visibile ma non invasivo: il testo resta nel campo per riprovare
    } finally {
      setSending(false);
    }
  }, [draft, sending, chainId]);

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
        {(giveTitle || receiveTitle) ? (
          <View style={styles.dealBar}>
            <Ionicons name="git-network-outline" size={14} color={theme.colors.textMuted} />
            <Text style={styles.dealBarText} numberOfLines={1}>
              {t("chains.chatDealLine", "Hai ceduto: {give} · Hai ricevuto: {receive}", {
                give: giveTitle || "?", receive: receiveTitle || "?",
              })}
            </Text>
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
              <View style={styles.rulesBox}>
                <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.textMuted} style={{ marginTop: 1 }} />
                <Text style={styles.rulesText}>
                  {t("chains.chatRules", "Organizzate qui la consegna con gli altri due partecipanti dello scambio. Non condividere dati sensibili (carte, documenti) e diffida di chi chiede di pagare fuori dai canali concordati.")}
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {t("chains.chatEmpty", "Ancora nessun messaggio: rompi il ghiaccio e organizzate la consegna.")}
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
      <HelpModal
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={t("chains.help.title", "❓ Cosa fare se...")}
        items={helpItems}
        closeLabel={t("chat.help.close", "Ho capito")}
      />
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
