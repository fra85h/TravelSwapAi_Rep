// screens/ProfileScreen.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { getMyProfile } from "../lib/db";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  ScrollView,
  StyleSheet,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { listMyListings, updateListing, deleteMyListing } from "../lib/db";
import { useI18n } from "../lib/i18n";
import LanguageSwitcher from "./LanguageSwitcher"; // 🇮🇹🇬🇧🇺🇸 bandierine condivise
import { useAuth } from "../lib/auth";

function StatItem({ label, icon, value, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.statBox, active && styles.statBoxActive]}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function SkeletonRow() {
  return (
    <View style={styles.row}>
      <View style={[styles.skel, { width: 72, height: 72, borderRadius: 10 }]} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={[styles.skel, { width: "60%", height: 14, borderRadius: 6 }]} />
        <View style={{ height: 8 }} />
        <View style={[styles.skel, { width: "40%", height: 12, borderRadius: 6 }]} />
      </View>
      <View style={[styles.skel, { width: 84, height: 28, borderRadius: 999 }]} />
    </View>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { signOut } = useAuth();

  const [profile, setProfile] = useState(null);

  const initials = useMemo(() => {
    const nome = (profile?.full_name || profile?.name || "").trim();
    const parts = nome.split(/\s+/);
    return (parts[0]?.[0] || "U") + (parts[1]?.[0] || "");
  }, [profile?.full_name, profile?.name]);

  const fmtPubDate = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return String(iso).slice(0, 10);
    }
  };

  const [loading, setLoading] = useState(true);
  const [myListings, setMyListings] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [statusFilter, setStatusFilter] = useState(null); // "active" | "swapped" | "sold" | "pending" | "expired" | null

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyListings();
      setMyListings(Array.isArray(data) ? data : []);
      const p = await getMyProfile();
      setProfile(p || null);
    } catch (e) {
      setError(e?.message || t("errors.loadMyListings", "Impossibile caricare i tuoi annunci"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (isFocused) loadMine(); }, [isFocused, loadMine]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await loadMine(); } finally { setRefreshing(false); }
  };

  const onEdit = (item) => navigation.navigate("CreateListing", { draftFromId: item.id });

  const toggleStatus = async (item) => {
    try {
      const current = String(item.status || "").toLowerCase();
      const next = current === "active" || current === "" ? "paused" : "active";
      await updateListing(item.id, { status: next });
      await loadMine();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("errors.updateStatus", "Impossibile aggiornare lo stato"));
    }
  };

  const onOverflow = (item) => {
    const current = String(item.status || "").toLowerCase();
    const toggleLabel = current === "active" || current === "" ? t("listing.actions.pause", "Metti in pausa") : t("listing.actions.activate", "Rendi attivo");

    const onDeleteConfirm = () =>
      Alert.alert(
        t("listing.actions.deleteTitle", "Elimina annuncio"),
        t("listing.actions.deleteConfirm", "Vuoi eliminare “{title}”?", { title: item.title }),
        [
          { text: t("common.cancel", "Annulla"), style: "cancel" },
          {
            text: t("common.delete", "Elimina"),
            style: "destructive",
            onPress: async () => {
              try {
                await deleteMyListing(item.id);
                await loadMine();
              } catch (e) {
                Alert.alert(t("common.error", "Errore"), e?.message || t("errors.delete", "Impossibile eliminare"));
              }
            },
          },
        ]
      );

    if (Platform.OS === "ios") {
      const options = [toggleLabel, t("common.edit", "Modifica"), t("common.delete", "Elimina"), t("common.cancel", "Annulla")];
      const destructiveButtonIndex = 2;
      const cancelButtonIndex = 3;

      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex, cancelButtonIndex },
        (idx) => {
          if (idx === 0) toggleStatus(item);
          else if (idx === 1) onEdit(item);
          else if (idx === 2) onDeleteConfirm();
        }
      );
    } else {
      Alert.alert(t("listing.actions.more", "Azioni"), item.title || t("listing.untitled", "Annuncio"), [
        { text: toggleLabel, onPress: () => toggleStatus(item) },
        { text: t("common.edit", "Modifica"), onPress: () => onEdit(item) },
        { text: t("common.delete", "Elimina"), style: "destructive", onPress: onDeleteConfirm },
        { text: t("common.cancel", "Annulla"), style: "cancel" },
      ]);
    }
  };

  const stats = useMemo(() => {
    const s = { active: 0, swapped: 0, sold: 0, pending: 0, expired: 0 };
    for (const it of myListings) {
      const st = String(it?.status || "").toLowerCase();
      if (st === "active" || !st) s.active++;
      else if (st === "swapped" || st === "traded" || st === "exchanged") s.swapped++;
      else if (st === "sold") s.sold++;
      else if (st === "pending" || st === "review") s.pending++;
      else if (st === "expired") s.expired++;
    }
    return s;
  }, [myListings]);

  const filtered = useMemo(() => {
    if (!statusFilter) return myListings;
    const match = (it) => {
      const st = String(it?.status || "").toLowerCase();
      if (statusFilter === "active") return st === "active" || !st;
      if (statusFilter === "swapped") return st === "swapped" || st === "traded" || st === "exchanged";
      if (statusFilter === "sold") return st === "sold";
      if (statusFilter === "pending") return st === "pending" || st === "review";
      if (statusFilter === "expired") return st === "expired";
      return true;
    };
    return myListings.filter(match);
  }, [myListings, statusFilter]);

  const renderMine = ({ item }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate("OfferDetail", { listingId: item.id, type: item.type || "hotel" })}
      style={styles.row}
    >
      <Image source={{ uri: item.image_url || "https://picsum.photos/200/120" }} style={styles.thumb} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={styles.title}>{item.title || t("listing.untitled", "Senza titolo")}</Text>
          {!!item.status && (
            <View style={styles.stateBadge}>
              <Text style={styles.stateBadgeText}>
                {String(item.status).toLowerCase() === "sold" ? t("listing.state.sold", "Venduto")
                  : ["swapped","traded","exchanged"].includes(String(item.status).toLowerCase()) ? t("listing.state.swapped", "Scambiato")
                  : ["pending","review"].includes(String(item.status).toLowerCase()) ? t("listing.state.pending", "In revisione")
                  : String(item.status).toLowerCase() === "expired" ? t("listing.state.expired", "Scaduto") : t("listing.state.active", "Attivo")}
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={() => onOverflow(item)} style={styles.overflowBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.overflowIcon}>⋯</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.metaText}>{item.location || "—"}</Text>
        {"price" in item && <Text style={styles.price}>€ {item.price}</Text>}

        {item.created_at && (
          <Text style={styles.pubDate}>
            {t("listing.publishedOn", "Pubblicato il")} {fmtPubDate(item.created_at)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  // 🔐 Logout → signOut() + reset verso Login
  const handleLogout = async () => {
    try {
      await signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: "Login" }],
      });
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("errors.logout", "Impossibile uscire dall’account."));
    }
  };

  const ListHeader = (
    <>
      {/* Dati personali + bandierine */}
      <View style={[styles.card, { marginTop: 0, paddingTop: 16 }]}>
        <View style={styles.profileRow}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{profile?.full_name  || "—"}</Text>
            <Text style={styles.metaText}>{profile?.email || "—"}</Text>
            <Text style={styles.metaText}>{profile?.phone || "—"}</Text>
          </View>

          {/* selettore lingua + Modifica + Esci */}
          <View style={{ alignItems: "flex-end" }}>
           <LanguageSwitcher />

            <TouchableOpacity
              style={[styles.editBtn, { marginTop: 8 }]}
              onPress={() => {
                navigation.navigate?.("EditProfile");
                navigation.getParent?.()?.navigate?.("EditProfile");
              }}
            >
              <Text style={styles.editBtnText}>{t("profile.editProfile", "Modifica profilo")}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.editBtn, { marginTop: 8, backgroundColor: "#111827", borderColor: "#111827" }]}
              onPress={handleLogout}
            >
              <Text style={[styles.editBtnText, { color: "#fff" }]}>{t("profile.logout", "Esci")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Indicatori */}
      <View style={[styles.card, styles.statsCard]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
          <StatItem
            label={t("listing.filters.active", "Attivi")}
            icon="🟢"
            value={stats.active}
            active={statusFilter === "active"}
            onPress={() => setStatusFilter(statusFilter === "active" ? null : "active")}
          />
          <StatItem
            label={t("listing.filters.swapped", "Scambiati")}
            icon="🔁"
            value={stats.swapped}
            active={statusFilter === "swapped"}
            onPress={() => setStatusFilter(statusFilter === "swapped" ? null : "swapped")}
          />
          <StatItem
            label={t("listing.filters.sold", "Venduti")}
            icon="💰"
            value={stats.sold}
            active={statusFilter === "sold"}
            onPress={() => setStatusFilter(statusFilter === "sold" ? null : "sold")}
          />
          <StatItem
            label={t("listing.filters.pending", "In revisione")}
            icon="🕑"
            value={stats.pending}
            active={statusFilter === "pending"}
            onPress={() => setStatusFilter(statusFilter === "pending" ? null : "pending")}
          />
          <StatItem
            label={t("listing.filters.expired", "Scaduti")}
            icon="⛔️"
            value={stats.expired}
            active={statusFilter === "expired"}
            onPress={() => setStatusFilter(statusFilter === "expired" ? null : "expired")}
          />
        </ScrollView>

        {statusFilter && (
          <View style={styles.filterBar}>
            <Text style={styles.filterText}>
              {t("listing.filterPrefix", "Filtro:")}{" "}
              {statusFilter === "active"
                ? t("listing.filters.active", "Attivi")
                : statusFilter === "swapped"
                ? t("listing.filters.swapped", "Scambiati")
                : statusFilter === "sold"
                ? t("listing.filters.sold", "Venduti")
                : statusFilter === "pending"
                ? t("listing.filters.pending", "In revisione")
                : t("listing.filters.expired", "Scaduti")}
            </Text>
            <TouchableOpacity onPress={() => setStatusFilter(null)} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>{t("common.clear", "Pulisci")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={[styles.sectionHeader]}>
        <Text style={styles.sectionTitle}>{t("profile.myListings", "I miei annunci")}</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadMine}><Text style={styles.retryText}>{t("common.retry", "Riprova")}</Text></TouchableOpacity>
        </View>
      )}
    </>
  );

  const ListEmpty = !loading ? (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>
        {statusFilter ? t("listing.emptyForFilter", "Nessun annuncio per questo stato") : t("listing.empty", "Non hai ancora annunci")}
      </Text>
      <Text style={styles.emptyText}>
        {statusFilter ? t("listing.tryChangeFilter", "Prova a cambiare filtro.") : t("listing.usePlus", "Usa il pulsante + per crearne uno.")}
      </Text>
      {statusFilter && (
        <>
          <View style={{ height: 8 }} />
          <TouchableOpacity onPress={() => setStatusFilter(null)} style={styles.pillBtn}>
            <Text style={styles.pillBtnText}>{t("listing.showAll", "Mostra tutti")}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  ) : null;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {loading && myListings.length === 0 ? (
        <View style={{ padding: 16 }}>
          {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
        </View>
      ) : (
        <>
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderMine}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={ListEmpty}
            contentContainerStyle={{
              paddingTop: 8,
              paddingBottom: (tabBarHeight || 0) + 24 + 72,
              paddingHorizontal: 16,
            }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          />

          {/* FAB “+” */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate("CreateListing")}
            style={[
              styles.fabWrap,
              { bottom: (tabBarHeight || 0) + (insets.bottom || 0) + 8 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t("profile.publishListing", "Pubblica annuncio")}
          >
            <View style={styles.fab}><Text style={styles.fabPlus}>+</Text></View>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 12,
  },

  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#111827", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  name: { fontSize: 16, fontWeight: "800", color: "#111827" },
  metaText: { color: "#6B7280" },
  editBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  editBtnText: { fontWeight: "700", color: "#111827" },

  statsCard: { marginTop: 12 },
  statsRow: { paddingRight: 6, gap: 10, flexDirection: "row", alignItems: "center" },
  statBox: {
    width: 100,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  statBoxActive: { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  statIcon: { fontSize: 18, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: "800", color: "#111827" },
  statLabel: { fontSize: 12, color: "#6B7280" },

  filterBar: {
    marginTop: 10, padding: 8, borderRadius: 10, backgroundColor: "#F3F4F6",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  filterText: { color: "#374151", fontWeight: "600" },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#111827" },
  clearBtnText: { color: "#fff", fontWeight: "700" },

  sectionHeader: { marginTop: 4, marginBottom: 8, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },

  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: "#E5E7EB" },
  title: { fontWeight: "800", color: "#111827", maxWidth: 180 },
  price: { marginTop: 2, fontWeight: "800", color: "#111827" },

  stateBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  stateBadgeText: { fontSize: 12, fontWeight: "800", color: "#374151" },

  overflowBtn: {
    marginLeft: "auto",
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowIcon: {
    fontSize: 20,
    color: "#6B7280",
    fontWeight: "800",
    marginTop: -2,
  },

  pubDate: { marginTop: 2, color: "#6B7280", fontSize: 12 },

  errorBox: { marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  errorText: { color: "#991B1B" },
  retryText: { color: "#2563EB", fontWeight: "700", marginTop: 6 },

  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  emptyTitle: { fontWeight: "800", color: "#111827", marginBottom: 6 },
  emptyText: { color: "#6B7280", textAlign: "center" },

  fabWrap: { position: "absolute", right: 16 },
  fab: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: "#111827", alignItems: "center", justifyContent: "center",
    ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 8 } }),
  },
  fabPlus: { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: -2 },

  skel: { backgroundColor: "#E5E7EB" },
});
