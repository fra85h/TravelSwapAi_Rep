// screens/ChainProposalsScreen.js — swap a catena: vedi/conferma/rifiuta
import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { listMyChainProposals, confirmChain, declineChain } from "../lib/chains";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import Button from "../components/ui/Button";

function formatDate(iso, locale) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale || undefined, {
      day: "2-digit", month: "short",
    });
  } catch {
    return "";
  }
}

function describeListing(listing, t, locale) {
  if (!listing) return t("chains.unknownListing", "Annuncio non disponibile");
  if (listing.type === "hotel") {
    const city = listing.location || t("chains.unknownCity", "città sconosciuta");
    const date = formatDate(listing.check_in, locale);
    return date ? `${city} · ${date}` : city;
  }
  const from = listing.route_from || "?";
  const to = listing.route_to || "?";
  const date = formatDate(listing.depart_at, locale);
  return date ? `${from} → ${to} · ${date}` : `${from} → ${to}`;
}

function ChainCard({ chain, onConfirm, onDecline, busyId, t, locale }) {
  const busy = busyId === chain.id;
  return (
    <View style={styles.card}>
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Ionicons name="git-network-outline" size={14} color={theme.colors.accentOn} />
          <Text style={styles.badgeText}>{t("chains.badge", "Scambio a 3")}</Text>
        </View>
        <Text style={styles.progressText}>
          {t("chains.confirmedCount", "{count} di 3 hanno confermato", { count: chain.confirmedCount })}
        </Text>
      </View>

      <Text style={styles.explanation}>
        {chain.explanation || t("chains.noExplanation", "Abbiamo trovato uno scambio a 3 che ti riguarda.")}
      </Text>

      <View style={styles.legs}>
        {chain.participants.map((p) => (
          <View key={p.position} style={styles.leg}>
            <Ionicons
              name={p.confirmed ? "checkmark-circle" : "time-outline"}
              size={16}
              color={p.confirmed ? theme.colors.success : theme.colors.textMuted}
            />
            <Text style={styles.legText}>
              {p.isMe ? t("chains.you", "Tu") : t("chains.otherUser", "Un altro utente")}
              {" — "}
              {describeListing(p.listing, t, locale)}
            </Text>
          </View>
        ))}
      </View>

      {!chain.myConfirmed ? (
        <View style={styles.actionsRow}>
          <Button
            title={t("chains.confirm", "Conferma")}
            onPress={() => onConfirm(chain.id)}
            disabled={busy}
            loading={busy}
            style={{ flex: 1 }}
          />
          <Button
            title={t("chains.decline", "Rifiuta")}
            variant="outline"
            onPress={() => onDecline(chain.id)}
            disabled={busy}
            style={{ flex: 1 }}
          />
        </View>
      ) : (
        <View style={styles.waitingRow}>
          <Text style={styles.waitingText}>
            {t("chains.waitingOthers", "Hai confermato — in attesa degli altri.")}
          </Text>
          <TouchableOpacity onPress={() => onDecline(chain.id)} disabled={busy}>
            <Text style={styles.withdrawText}>{t("chains.withdraw", "Ritira la conferma")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function ChainProposalsScreen() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listMyChainProposals());
    } catch (e) {
      if (__DEV__) console.log("[ChainProposals] load error", e?.message || e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleConfirm = useCallback(async (chainId) => {
    setBusyId(chainId);
    try {
      await confirmChain(chainId);
      await load();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("chains.confirmError", "Impossibile confermare lo scambio."));
    } finally {
      setBusyId(null);
    }
  }, [load, t]);

  const handleDecline = useCallback((chainId) => {
    Alert.alert(
      t("chains.declineTitle", "Rifiuta lo scambio"),
      t("chains.declineMsg", "La catena decade per tutti e 3 i partecipanti. Vuoi continuare?"),
      [
        { text: t("common.cancel", "Annulla"), style: "cancel" },
        {
          text: t("common.confirm", "Conferma"),
          style: "destructive",
          onPress: async () => {
            setBusyId(chainId);
            try {
              await declineChain(chainId);
              await load();
            } catch (e) {
              Alert.alert(t("common.error", "Errore"), e?.message || t("chains.declineError", "Impossibile rifiutare lo scambio."));
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }, [load, t]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!items.length) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 44 }}>🔗</Text>
        <Text style={styles.emptyText}>
          {t("chains.emptyText", "Nessuna proposta di scambio a 3 al momento.\nQuando ne troviamo una che ti riguarda, la vedrai qui.")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => String(it.id)}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      renderItem={({ item }) => (
        <ChainCard
          chain={item}
          onConfirm={handleConfirm}
          onDecline={handleDecline}
          busyId={busyId}
          t={t}
          locale={locale}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
    padding: 24,
  },
  emptyText: {
    color: theme.colors.textMuted,
    marginTop: 10,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    ...theme.shadow.sm,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "800", color: theme.colors.accentOn },
  progressText: { fontSize: 12, color: theme.colors.textMuted, fontWeight: "600" },
  explanation: { color: theme.colors.text, lineHeight: 20, marginBottom: 12 },
  legs: { gap: 8, marginBottom: 14 },
  leg: { flexDirection: "row", alignItems: "center", gap: 8 },
  legText: { color: theme.colors.text, flexShrink: 1 },
  actionsRow: { flexDirection: "row", gap: 10 },
  waitingRow: { alignItems: "center", gap: 6 },
  waitingText: { color: theme.colors.textMuted, textAlign: "center" },
  withdrawText: { color: theme.colors.danger, fontWeight: "700" },
});
