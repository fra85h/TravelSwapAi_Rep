// screens/SavedScreen.js — elenco dei preferiti dell'utente
import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { listSavedListings } from "../lib/savedListings";
import SaveButton from "../components/SaveButton";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

function subtitle(item) {
  const icon = item.type === "train" ? "🚆 " : "🏨 ";
  const place =
    item.location ||
    [item.route_from, item.route_to].filter(Boolean).join(" → ") ||
    "";
  return icon + place;
}

export default function SavedScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listSavedListings());
    } catch (e) {
      if (__DEV__) console.log("[Saved] load error", e?.message || e);
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
        <Text style={{ fontSize: 44 }}>⭐</Text>
        <Text style={styles.emptyText}>
          {t("savedScreen.emptyText", "Nessun annuncio salvato.\nTocca la stella su un annuncio per aggiungerlo qui.")}
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
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => navigation.navigate("ListingDetail", { id: item.id })}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title || t("savedScreen.untitledListing", "Annuncio")}
            </Text>
            <Text style={styles.sub}>{subtitle(item)}</Text>
            {item.price != null ? (
              <Text style={styles.price}>
                {item.price} {item.currency || "€"}
              </Text>
            ) : null}
          </View>
          <SaveButton listingId={item.id} initialSaved={true} />
        </TouchableOpacity>
      )}
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: "700", color: theme.colors.text },
  sub: { marginTop: 4, color: theme.colors.textMuted },
  price: { marginTop: 6, fontWeight: "800", color: theme.colors.primary },
});
