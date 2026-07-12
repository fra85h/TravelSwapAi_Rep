// screens/TransactionsScreen.js — storico scambi/acquisti dell'utente
import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { listMyTransactions } from "../lib/transactions";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

function formatDate(iso, locale) {
  try {
    return new Date(iso).toLocaleDateString(locale || undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso || "";
  }
}

export default function TransactionsScreen() {
  const { t, locale } = useI18n();
  const navigation = useNavigation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listMyTransactions());
    } catch (e) {
      if (__DEV__) console.log("[Transactions] load error", e?.message || e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
        <Text style={{ fontSize: 44 }}>🧾</Text>
        <Text style={styles.emptyText}>
          {t("transactions.emptyText", "Nessuno scambio ancora.\nQuando compri, vendi o scambi un annuncio, lo troverai qui.")}
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
      renderItem={({ item }) => {
        const listing = item.listing || {};
        const isSwap = item.ttype === "swap";
        const typeLabel = isSwap ? t("transactions.typeSwap", "Scambio") : t("transactions.typeSale", "Vendita");
        const directionLabel = item.direction === "sold"
          ? t("transactions.directionSold", "Venduto")
          : t("transactions.directionBought", "Ricevuto");

        return (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => listing.id && navigation.navigate("ListingDetail", { id: listing.id })}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.title} numberOfLines={2}>
                {listing.title || t("savedScreen.untitledListing", "Annuncio")}
              </Text>
              <Text style={styles.sub}>{typeLabel} · {formatDate(item.created_at, locale)}</Text>
              {item.price != null ? (
                <Text style={styles.price}>{item.price} €</Text>
              ) : null}
            </View>
            <View style={[styles.badge, item.direction === "sold" ? styles.badgeSold : styles.badgeBought]}>
              <Text style={styles.badgeText}>{directionLabel}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
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
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    marginBottom: 12,
    ...theme.shadow.sm,
  },
  title: { fontFamily: theme.fonts.headingBold, fontSize: 16, color: theme.colors.text },
  sub: { marginTop: 4, color: theme.colors.textMuted },
  price: { marginTop: 6, fontFamily: theme.fonts.headingBold, fontSize: 15, color: theme.colors.text },
  badge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    borderWidth: 1,
  },
  badgeSold: { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
  badgeBought: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
  badgeText: { fontSize: 12, fontWeight: "700", color: theme.colors.text },
});
