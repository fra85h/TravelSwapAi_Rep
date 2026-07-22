// screens/NotificationsScreen.js — centro notifiche in-app. Elenco cronologico
// degli eventi che riguardano l'utente (proposta ricevuta, esito della propria
// proposta, nuovi annunci "Per te"). Toccando una notifica la si segna letta e
// si salta alla schermata giusta. Si aggiorna in tempo reale (Realtime).
import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
} from "../lib/notifications";
import { useNotifications } from "../lib/NotificationsContext";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

const ICON = {
  offer_received: { name: "pricetag-outline", color: theme.colors.accent },
  offer_accepted: { name: "checkmark-circle-outline", color: theme.colors.success },
  offer_declined: { name: "close-circle-outline", color: theme.colors.danger },
  new_matches:    { name: "sparkles-outline", color: theme.colors.boardingText },
  listing_ping:   { name: "flag-outline", color: theme.colors.accent },
};

function timeAgo(iso, t) {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return t("notifications.now", "ora");
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return `${days}g`;
}

export default function NotificationsScreen({ navigation }) {
  const { t } = useI18n();
  const { refresh: refreshBadge } = useNotifications();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await listNotifications({ limit: 50 });
      setItems(rows);
    } catch (e) {
      if (__DEV__) console.log("[Notifications] load error", e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const handleMarkAll = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
      refreshBadge();
    } catch (e) {
      if (__DEV__) console.log("[Notifications] markAll error", e?.message || e);
    }
  }, [refreshBadge]);

  const handlePress = useCallback((n) => {
    if (!n.read_at) {
      markNotificationRead(n.id).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      refreshBadge();
    }
    const d = n.data || {};
    if (n.type === "new_matches") {
      navigation.navigate("Matching");
    } else if (d.offerId != null) {
      navigation.navigate("OfferDetail", { id: d.offerId });
    } else if (n.type === "listing_ping" && d.fromListingId) {
      navigation.navigate("ListingDetail", { id: d.fromListingId });
    } else if (d.listingId) {
      navigation.navigate("ListingDetail", { id: d.listingId });
    }
  }, [navigation, refreshBadge]);

  const hasUnread = items.some((n) => !n.read_at);

  const renderItem = ({ item }) => {
    const ic = ICON[item.type] || { name: "notifications-outline", color: theme.colors.textMuted };
    const unread = !item.read_at;
    return (
      <TouchableOpacity
        style={[styles.row, unread && styles.rowUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <View style={[styles.iconWrap, { backgroundColor: theme.colors.accentSoft }]}>
          <Ionicons name={ic.name} size={20} color={ic.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          {!!item.body && <Text style={styles.body} numberOfLines={2}>{item.body}</Text>}
        </View>
        <View style={styles.meta}>
          <Text style={styles.time}>{timeAgo(item.created_at, t)}</Text>
          {unread && <View style={styles.dot} />}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && !items.length) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  return (
    <View style={styles.container}>
      {hasUnread && (
        <TouchableOpacity style={styles.markAll} onPress={handleMarkAll} accessibilityRole="button">
          <Ionicons name="checkmark-done-outline" size={16} color={theme.colors.accent} />
          <Text style={styles.markAllText}>{t("notifications.markAll", "Segna tutte come lette")}</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        renderItem={renderItem}
        contentContainerStyle={items.length ? styles.list : styles.listEmpty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={40} color={theme.colors.textMuted} />
            <Text style={styles.emptyTitle}>{t("notifications.emptyTitle", "Nessuna notifica")}</Text>
            <Text style={styles.emptySub}>
              {t("notifications.emptySub", "Ti avviseremo qui quando ricevi una proposta, quando la tua viene accettata o quando arrivano nuovi annunci per te.")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
  markAll: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  markAllText: { color: theme.colors.accent, fontWeight: "700", fontSize: 13 },
  list: { paddingBottom: 24 },
  listEmpty: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: theme.colors.background },
  rowUnread: { backgroundColor: theme.colors.accentSoft },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { color: theme.colors.boardingText, fontWeight: "700", fontSize: 15 },
  body: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  meta: { alignItems: "flex-end", gap: 6 },
  time: { color: theme.colors.textMuted, fontSize: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.danger },
  sep: { height: 1, backgroundColor: theme.colors.border, marginLeft: 68 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },
  emptyTitle: { color: theme.colors.boardingText, fontWeight: "800", fontSize: 17, marginTop: 6 },
  emptySub: { color: theme.colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
