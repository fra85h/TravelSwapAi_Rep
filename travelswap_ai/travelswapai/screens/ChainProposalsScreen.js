// screens/ChainProposalsScreen.js — swap a catena: vedi/conferma/rifiuta
//
// Design pensato per abbassare il carico cognitivo di uno scambio a 3
// (richiesta reale: il giro lineare "annuncio 1/2/3" era poco chiaro).
// Tre scelte:
//  - il beneficio personale ("tu cedi X, ricevi Y") è il PRIMO livello di
//    lettura, in due box ad alto contrasto — non il meccanismo del cerchio;
//  - il meccanismo completo (chi dà cosa a chi) resta disponibile ma dietro
//    un accordion opzionale, per chi vuole capire o verificare;
//  - lo stato delle conferme è un indicatore a pallini, non un numero in
//    mezzo al testo — si legge a colpo d'occhio quanto manca alla chiusura.
import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { listMyChainProposals, confirmChain, declineChain } from "../lib/chains";
import { notifyActivityChanged } from "../lib/ActivityContext";
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

// Tre pallini, si riempiono man mano che i partecipanti confermano. Il
// testo "N di 3" resta per l'accessibilità (screen reader), non in vista.
function ProgressDots({ confirmedCount, total, t }) {
  return (
    <View
      style={styles.dotsRow}
      accessibilityLabel={t("chains.confirmedCount", "{count} di 3 hanno confermato", { count: confirmedCount })}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i < confirmedCount && styles.dotFilled]} />
      ))}
    </View>
  );
}

function ExchangeBox({ icon, iconColor, variant, label, value, big }) {
  return (
    <View style={[styles.exchangeBox, variant === "give" ? styles.exchangeBoxGive : styles.exchangeBoxReceive]}>
      <Ionicons name={icon} size={18} color={iconColor} />
      <Text style={styles.exchangeBoxLabel}>{label}</Text>
      <Text style={[styles.exchangeBoxValue, big && styles.exchangeBoxValueBig]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function ChainCard({ chain, onConfirm, onDecline, busyId, t, locale }) {
  const busy = busyId === chain.id;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mine = chain.participants.find((p) => p.isMe);

  return (
    <View style={styles.card}>
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Ionicons name="git-network-outline" size={14} color={theme.colors.accentOn} />
          <Text style={styles.badgeText}>{t("chains.badge", "Scambio a 3")}</Text>
        </View>
        <ProgressDots confirmedCount={chain.confirmedCount} total={3} t={t} />
      </View>

      <Text style={styles.benefitCopy}>
        {t("chains.benefitCopy", "Questo scambio circolare ti permette di ottenere esattamente ciò che cercavi, cedendo il tuo annuncio a un altro utente della community.")}
      </Text>

      <View style={styles.exchangeBoxes}>
        <ExchangeBox
          icon="arrow-up-circle-outline" iconColor="#991B1B" variant="give"
          label={t("chains.youGive", "Tu cedi")}
          value={describeListing(mine?.listing, t, locale)}
        />
        <ExchangeBox
          icon="gift-outline" iconColor="#166534" variant="receive" big
          label={t("chains.youReceive", "Tu ricevi")}
          value={describeListing(chain.myReceiveListing, t, locale)}
        />
      </View>

      <TouchableOpacity
        style={styles.detailsToggle}
        onPress={() => setDetailsOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
      >
        <Text style={styles.detailsToggleText}>
          {detailsOpen ? t("chains.detailsHide", "Nascondi i dettagli del cerchio") : t("chains.detailsShow", "Vedi i dettagli del cerchio")}
        </Text>
        <Ionicons name={detailsOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.colors.accent} />
      </TouchableOpacity>

      {detailsOpen ? (
        <View style={styles.detailsBox}>
          {chain.explanation ? <Text style={styles.explanation}>{chain.explanation}</Text> : null}
          <View style={styles.legs}>
            {chain.participants.map((p, idx) => (
              <React.Fragment key={p.position}>
                <View style={styles.leg}>
                  <Ionicons
                    name={p.confirmed ? "checkmark-circle" : "time-outline"}
                    size={16}
                    color={p.confirmed ? theme.colors.success : theme.colors.textMuted}
                  />
                  <Text style={styles.legText}>
                    {p.isMe ? t("chains.you", "Tu") : t("chains.otherUser", "Un altro utente")}
                    {" "}{t("chains.gives", "dà")}{": "}
                    {describeListing(p.listing, t, locale)}
                  </Text>
                </View>
                {idx < chain.participants.length - 1 ? (
                  <View style={styles.legArrow}>
                    <Ionicons name="arrow-down-outline" size={16} color={theme.colors.textMuted} />
                  </View>
                ) : (
                  <View style={styles.legArrow}>
                    <Ionicons name="repeat-outline" size={16} color={theme.colors.textMuted} />
                    <Text style={styles.legArrowText}>{t("chains.backToStart", "torna al primo — il giro si chiude")}</Text>
                  </View>
                )}
              </React.Fragment>
            ))}
          </View>
        </View>
      ) : null}

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
  const navigation = useNavigation();
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
      const closingChain = items.find((c) => c.id === chainId);
      const result = await confirmChain(chainId);
      await load();
      notifyActivityChanged();
      if (result?.status === "completed") {
        const mine = closingChain?.participants?.find((p) => p.isMe);
        const giveTitle = mine?.listing?.title || null;
        const receiveTitle = closingChain?.myReceiveListing?.title || null;
        Alert.alert(
          t("chains.completedTitle", "🎉 Scambio completato!"),
          t("chains.completedMsg", "Tutti e 3 avete confermato: lo scambio è avvenuto. Apri la chat per organizzare la consegna con gli altri due."),
          [
            { text: t("common.close", "Chiudi"), style: "cancel" },
            {
              text: t("chat.open", "Apri la chat"),
              onPress: () => navigation?.navigate?.("ChainChat", { chainId, giveTitle, receiveTitle }),
            },
          ]
        );
      } else if (result?.status === "canceled") {
        Alert.alert(
          t("chains.canceledTitle", "Scambio non riuscito"),
          t("chains.canceledMsg", "Nel frattempo uno degli annunci coinvolti non è più disponibile. Nessuno ha perso nulla.")
        );
      }
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("chains.confirmError", "Impossibile confermare lo scambio."));
    } finally {
      setBusyId(null);
    }
  }, [load, t, items, navigation]);

  const handleDecline = useCallback((chainId) => {
    Alert.alert(
      t("chains.declineTitle", "Rifiuta lo scambio"),
      t("chains.declineMsg", "La catena decade per tutti e 3 i partecipanti. Vuoi continuare?"),
      [
        { text: t("common.cancel", "Annulla"), style: "cancel" },
        {
          text: t("chains.decline", "Rifiuta"),
          style: "destructive",
          onPress: async () => {
            setBusyId(chainId);
            try {
              await declineChain(chainId);
              await load();
              notifyActivityChanged();
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

  dotsRow: { flexDirection: "row", gap: 5 },
  dot: {
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  dotFilled: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },

  benefitCopy: { color: theme.colors.text, lineHeight: 20, marginBottom: 14 },

  exchangeBoxes: { flexDirection: "row", gap: 10, marginBottom: 12 },
  exchangeBox: {
    flex: 1, borderRadius: theme.radius.lg, borderWidth: 1,
    padding: 12, gap: 4,
  },
  exchangeBoxGive: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  exchangeBoxReceive: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  exchangeBoxLabel: {
    fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase",
    color: theme.colors.textMuted,
  },
  exchangeBoxValue: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  exchangeBoxValueBig: { fontSize: 16, fontWeight: "800" },

  detailsToggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 8, marginBottom: 4,
  },
  detailsToggleText: { color: theme.colors.accent, fontWeight: "700", fontSize: 13 },
  detailsBox: {
    backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 12,
  },
  explanation: { color: theme.colors.text, lineHeight: 20, marginBottom: 10 },
  legs: {},
  leg: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  legText: { color: theme.colors.text, flexShrink: 1 },
  legArrow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 3, paddingVertical: 2 },
  legArrowText: { fontSize: 11, color: theme.colors.textMuted, fontStyle: "italic" },

  actionsRow: { flexDirection: "row", gap: 10 },
  waitingRow: { alignItems: "center", gap: 6 },
  waitingText: { color: theme.colors.textMuted, textAlign: "center" },
  withdrawText: { color: theme.colors.danger, fontWeight: "700" },
});
