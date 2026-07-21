// screens/ProfileScreen.js
import React, { useEffect, useMemo, useState, useCallback, useLayoutEffect } from "react";
import { getMyProfile } from "../lib/db";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { listMyListings, updateListing, deleteMyListing } from "../lib/db";
import { useI18n } from "../lib/i18n";
import LanguageSwitcher from "./LanguageSwitcher";
import { useAuth } from "../lib/auth";
import { theme } from "../lib/theme";
import { supabase } from "../lib/supabase.js";
import TrustScoreBadge from '../components/TrustScoreBadge';
import ActionSheet from "../components/ui/ActionSheet";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { stripPriceFromTitle } from "../lib/listingTitle";
import { formatMoney } from "../lib/number";
import { STATUS_COLORS, normStatusKey, isConcludedStatus } from "../lib/listingStatus";

const APP_VERSION = Constants.expoConfig?.version || "1.0.0";

function StatItem({ label, icon, value, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.statBox, active && styles.statBoxActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function SkeletonRow() {
  return (
    <View style={styles.listCard}>
      <View style={{ flex: 1 }}>
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
  const [actionSheetItem, setActionSheetItem] = useState(null);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Scadenza pigra: un annuncio 'active' con la data del viaggio/soggiorno
      // ormai passata diventa 'expired' qui, al primo posto in cui l'utente
      // guarda i propri annunci — nel progetto non esiste un cron (solo
      // migration manuali), stesso pattern già usato per le offerte pending
      // scadute (list_incoming_offers_any/list_outgoing_offers_any). Best
      // effort: se l'RPC non esiste ancora (migration non applicata) o fallisce,
      // la lista si carica comunque con lo stato precedente.
      await supabase.rpc("expire_my_stale_listings").catch(() => {});
      const data = await listMyListings();
      // Gli annunci eliminati (stato terminale `deleted`) non compaiono più:
      // "Elimina" è definitivo, niente più "Rendi attivo" su di essi.
      const visible = Array.isArray(data)
        ? data.filter((x) => String(x?.status || "").toLowerCase() !== "deleted")
        : [];
      setMyListings(visible);
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

  const onEdit = (item) => navigation.navigate("CreateListing",{ mode: "edit", listingId: item.id });

  const toggleStatus = async (item) => {
    try {
      const current = String(item.status || "").toLowerCase();
      // Solo attivo ⇄ pausa. Gli stati terminali (venduto, scambiato, riservato,
      // eliminato, scaduto) non si riattivano: "Pausa" è reversibile, il resto no.
      if (current !== "active" && current !== "paused" && current !== "") return;
      const next = current === "active" || current === "" ? "paused" : "active";
      await updateListing(item.id, { status: next });
      await loadMine();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("errors.updateStatus", "Impossibile aggiornare lo stato"));
    }
  };

  // Menu "..." di ogni annuncio: usa ActionSheet (cross-platform) invece di
  // ActionSheetIOS/Alert.alert a più bottoni — su web, Alert.alert passa da
  // window.confirm() che è binario e faceva sparire silenziosamente
  // "Modifica" ed "Elimina", lasciando raggiungibile solo la prima opzione.
  const onOverflow = (item) => setActionSheetItem(item);

  const onDeleteConfirm = (item) =>
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

  const stats = useMemo(() => {
    const s = { active: 0, swapped: 0, sold: 0, reserved: 0, pending: 0, expired: 0, paused: 0 };
    for (const it of myListings) {
      const st = String(it?.status || "").toLowerCase();
      if (st === "active" || !st) s.active++;
      else if (st === "swapped" || st === "traded" || st === "exchanged") s.swapped++;
      else if (st === "sold") s.sold++;
      else if (st === "reserved") s.reserved++;
      else if (st === "pending" || st === "review") s.pending++;
      else if (st === "expired") s.expired++;
      else if (st === "paused") s.paused++;
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
      if (statusFilter === "reserved") return st === "reserved";
      if (statusFilter === "pending") return st === "pending" || st === "review";
      if (statusFilter === "paused") return st === "paused";
      if (statusFilter === "expired") return st === "expired";
      return true;
    };
    return myListings.filter(match);
  }, [myListings, statusFilter]);

  // === CARD ANNUNCIO (stile HomeScreen, senza immagine, icona + titolo senza prezzo)
  const renderMine = ({ item }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate("ListingDetail", { listingId: item.id, type: item.type || "hotel" })}
      activeOpacity={0.8}
      style={styles.listCard}
    >
      {/* Titolo con icona tipo (in alto a sx) */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
          {String(item.type).toLowerCase() === "train" ? (
            <Ionicons name="train-outline" size={18} color={theme.colors.boardingText} style={{ marginRight: 6 }} />
          ) : String(item.type).toLowerCase() === "hotel" ? (
            <Ionicons name="bed-outline" size={18} color={theme.colors.boardingText} style={{ marginRight: 6 }} />
          ) : null}
          <Text style={styles.listCardTitle} numberOfLines={1}>
            {stripPriceFromTitle(item.title) || t("listing.untitled", "Senza titolo")}
          </Text>
        </View>

        {/* Stato + overflow */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {!!item.status && (() => {
            const k = normStatusKey(item.status);
            const c = STATUS_COLORS[k] || STATUS_COLORS.active;
            return (
              <View style={[styles.stateBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                <Text style={[styles.stateBadgeText, { color: c.fg }]}>
                  {t(`listing.state.${k}`, k)}
                </Text>
              </View>
            );
          })()}
          <TouchableOpacity onPress={() => onOverflow(item)} style={styles.overflowBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={t("listing.actions.more", "Azioni")}>
            <Text style={styles.overflowIcon}>⋯</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sottotitolo: solo località/tratta — il tipo è già dato dall'icona
          accanto al titolo (prima qui compariva anche l'enum grezzo, es.
          "train • Bologna", ridondante e non tradotto). */}
      <Text style={styles.listCardSub} numberOfLines={1}>
        {item.location || item.route_from || "—"}
      </Text>

      {/* Annuncio scaduto: invito a sistemare le date (torna 'active' da solo
          al salvataggio se sono di nuovo nel futuro, vedi CreateListingScreen)
          o a crearne uno nuovo — senza questo l'utente vedeva solo il badge
          "Scaduto" senza sapere cosa fare. */}
      {String(item.status || "").toLowerCase() === "expired" ? (
        <Text style={{ color: theme.colors.danger, marginTop: 6, fontSize: 12, fontWeight: "600" }}>
          {t("listing.expiredHint", "Le date sono passate: modifica l'annuncio per aggiornarle e rimetterlo online, oppure creane uno nuovo.")}
        </Text>
      ) : null}

      {/* Prezzo su riga separata */}
      {"price" in item && item.price != null && (
        <Text style={styles.listCardMeta}>
          {formatMoney(item.price, item.currency)}
        </Text>
      )}

      {/* Pubblicato il */}
      {item.created_at && (
        <Text style={{ color: theme.colors.textMuted, marginTop: 8, fontSize: 12 }}>
          {t("listing.publishedOn", "Pubblicato il")} {fmtPubDate(item.created_at)}
        </Text>
      )}

      {/* Affidabilità in basso a destra */}
      {(() => {
        // Supabase/PostgREST serializza le colonne numeric come stringa
        // JSON (es. "58.00"), non come numero — typeof==="number" lasciava
        // il badge sempre nascosto anche a valore correttamente salvato.
        const raw = item.trustscore ?? item.trust_score ?? null;
        const n = raw != null ? Number(raw) : NaN;
        const score = Number.isFinite(n) ? n : null;
        return score != null ? (
          <View style={{ alignItems: "flex-end", marginTop: 8 }}>
            <TrustScoreBadge score={Number(score)} />
          </View>
        ) : null;
      })()}
    </TouchableOpacity>
  );

  // 🔐 Logout: basta chiudere la sessione — al cambio di stato auth il
  // navigator radice passa da solo al ramo di accesso. Il vecchio
  // reset verso "Login" avveniva quando quella rotta non era ancora
  // registrata (esiste solo senza sessione) e produceva un errore di
  // navigazione, facendo atterrare sul carosello di onboarding.
  const doLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("errors.logout", "Impossibile uscire dall’account."));
    }
  };

  // Conferma prima di uscire: un tap accidentale sulla voce rossa buttava
  // fuori l'utente senza rete di sicurezza.
  const handleLogout = () => {
    Alert.alert(
      t("profile.logoutConfirmTitle", "Uscire dall'account?"),
      t("profile.logoutConfirmMsg", "Dovrai reinserire le credenziali al prossimo accesso."),
      [
        { text: t("common.cancel", "Annulla"), style: "cancel" },
        { text: t("profile.logout", "Esci"), style: "destructive", onPress: doLogout },
      ]
    );
  };

  // Menu raggruppato per concetto: prima Account/Attività/Impostazioni erano
  // mescolati in un'unica lista, con le feature core (Suggeriti dall'AI,
  // Scambi a 3…) sepolte tra le impostazioni. Icone Ionicons coerenti con il
  // resto della card (prima erano emoji, che stonavano col chevron Ionicons
  // sulla stessa riga e rendono diversamente per OS).
  const menuGroups = [
    {
      title: t("profile.sectionAccount", "Account"),
      items: [
        { icon: "person-outline", label: t("profile.editProfile", "Modifica profilo"), route: "EditProfile" },
        { icon: "options-outline", label: t("profile.editPreferences", "Le mie preferenze"), route: "EditPreferences" },
      ],
    },
    {
      title: t("profile.sectionActivity", "Attività"),
      items: [
        { icon: "sparkles-outline", label: t("profile.aiSuggestions", "Suggeriti dall'AI"), route: "Matching" },
        { icon: "star-outline", label: t("profile.savedListings", "I miei preferiti"), route: "Saved" },
        { icon: "git-network-outline", label: t("profile.chainProposals", "Scambi a 3"), route: "ChainProposals" },
      ],
    },
    {
      title: t("profile.sectionSettings", "Impostazioni"),
      items: [
        { icon: "chatbubble-ellipses-outline", label: t("profile.linkMessenger", "Collega Messenger"), route: "LinkMessenger" },
      ],
    },
  ];

  const goTo = (route) => {
    navigation.navigate?.(route);
    navigation.getParent?.()?.navigate?.(route);
  };

  const STAT_CHIPS = [
    { key: "active", icon: "🟢", label: t("listing.filters.active", "Attivi") },
    { key: "swapped", icon: "🔁", label: t("listing.filters.swapped", "Scambiati") },
    { key: "sold", icon: "💰", label: t("listing.filters.sold", "Venduti") },
    { key: "reserved", icon: "🔒", label: t("listing.filters.reserved", "Riservati") },
    { key: "pending", icon: "🕑", label: t("listing.filters.pending", "In trattativa") },
    { key: "paused", icon: "⏸️", label: t("listing.filters.paused", "In pausa") },
    { key: "expired", icon: "⛔️", label: t("listing.filters.expired", "Scaduti") },
  ];

  const ListHeader = (
    <>
      {/* Titolo della pagina: è il Profilo (dati personali + menu). "I miei
          annunci" è ora una sezione più in basso, subito sopra la lista. */}
      <View style={{ alignItems: "center", marginBottom: 8, marginTop: 0, paddingVertical: 0 }}>
        <Text style={styles.myListingsTitle}>
          {t("profile.title", "Profilo")}
        </Text>
      </View>

      {/* Dati personali + bandierine */}
      <View style={[styles.card, { marginTop: 0, paddingTop: 16 }]}>
        <View style={styles.profileRow}>
          <TouchableOpacity onPress={() => navigation.navigate("EditProfile")} accessibilityRole="button" accessibilityLabel={t("profile.editProfile", "Modifica profilo")}>
            <View>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
              )}
              {/* Segnale che l'avatar è toccabile (prima il tap era invisibile) */}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="pencil" size={11} color={theme.colors.boardingText} />
              </View>
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{profile?.full_name  || "—"}</Text>
            <Text style={styles.metaText} numberOfLines={1} ellipsizeMode="tail">{profile?.email || "—"}</Text>
            <Text style={styles.metaText} numberOfLines={1} ellipsizeMode="tail">{profile?.phone || "—"}</Text>
          </View>
          <LanguageSwitcher />
        </View>
        {!!profile?.bio && (
          <Text style={styles.bioText}>{profile.bio}</Text>
        )}
      </View>

      {/* Menu raggruppato: ogni gruppo è una card con una micro-etichetta */}
      {menuGroups.map((group) => (
        <View key={group.title}>
          <Text style={styles.menuGroupLabel}>{group.title}</Text>
          <View style={[styles.card, { paddingVertical: 4, paddingHorizontal: 0, marginBottom: 12 }]}>
            {group.items.map((item, idx, arr) => (
              <TouchableOpacity
                key={item.route}
                style={[styles.menuRow, idx < arr.length - 1 && styles.menuRowBorder]}
                onPress={() => goTo(item.route)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Ionicons name={item.icon} size={20} color={theme.colors.boardingText} style={styles.menuIcon} />
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* Logout: card a sé, separata dalla navigazione */}
      <View style={[styles.card, { paddingVertical: 4, paddingHorizontal: 0 }]}>
        <TouchableOpacity style={styles.menuRow} onPress={handleLogout} accessibilityRole="button" accessibilityLabel={t("profile.logout", "Esci")}>
          <Ionicons name="log-out-outline" size={20} color={theme.colors.danger} style={styles.menuIcon} />
          <Text style={[styles.menuLabel, { color: theme.colors.danger, fontWeight: "800" }]}>
            {t("profile.logout", "Esci")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sezione annunci */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("profile.myListings", "I miei annunci")}</Text>
      </View>

      {/* Indicatori + filtri (le chip fungono anche da filtro sulla lista) */}
      <View style={[styles.card, styles.statsCard]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
          {/* Chip "Tutti": azzera il filtro ed è attiva quando non filtri —
              rende esplicito che le chip sono filtri, non solo contatori. */}
          <StatItem
            label={t("listing.filters.all", "Tutti")}
            icon="🗂️"
            value={myListings.length}
            active={statusFilter === null}
            onPress={() => setStatusFilter(null)}
          />
          {STAT_CHIPS.map((chip) => (
            <StatItem
              key={chip.key}
              label={chip.label}
              icon={chip.icon}
              value={stats[chip.key] || 0}
              active={statusFilter === chip.key}
              onPress={() => setStatusFilter(statusFilter === chip.key ? null : chip.key)}
            />
          ))}
        </ScrollView>

        {statusFilter && (
          <View style={styles.filterBar}>
            <Text style={styles.filterText}>
              {t("listing.filterPrefix", "Filtro:")}{" "}
              {t(`listing.filters.${statusFilter}`, statusFilter)}
            </Text>
            <TouchableOpacity onPress={() => setStatusFilter(null)} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>{t("common.clear", "Pulisci")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadMine}><Text style={styles.retryText}>{t("common.retry", "Riprova")}</Text></TouchableOpacity>
        </View>
      )}
    </>
  );

  // Durante il primo caricamento mostriamo gli scheletri DENTRO la lista, non
  // al posto dell'intera schermata: così la card profilo, il menu e il logout
  // restano subito raggiungibili anche se gli annunci sono lenti a caricare
  // (prima l'header era gated dietro la query annunci).
  const showSkeletons = loading && myListings.length === 0;

  const ListEmpty = showSkeletons ? (
    <View>
      {[...Array(4)].map((_, i) => (
        <View key={i} style={{ marginBottom: 10 }}><SkeletonRow /></View>
      ))}
    </View>
  ) : (
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
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList
        data={showSkeletons ? [] : filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMine}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={
          <Text style={styles.footerCredits}>
            {t("profile.credits", "TravelSwapAI v{version} · © {year} Francesco Giacalone", {
              version: APP_VERSION,
              year: new Date().getFullYear(),
            })}
          </Text>
        }
        contentContainerStyle={{
          paddingTop: 0,
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

      <ActionSheet
        visible={!!actionSheetItem}
        title={t("listing.actions.more", "Azioni")}
        message={actionSheetItem?.title || t("listing.untitled", "Annuncio")}
        cancelLabel={t("common.cancel", "Annulla")}
        onClose={() => setActionSheetItem(null)}
        options={actionSheetItem ? [
          // Pausa/Riattiva solo per annunci attivi o in pausa: sugli stati
          // terminali (venduto, scambiato, eliminato…) l'opzione non compare.
          ...(["active", "paused", ""].includes(String(actionSheetItem.status || "").toLowerCase())
            ? [{
                label: (String(actionSheetItem.status || "").toLowerCase() === "active" || !actionSheetItem.status)
                  ? t("listing.actions.pause", "Metti in pausa")
                  : t("listing.actions.activate", "Rendi attivo"),
                onPress: () => toggleStatus(actionSheetItem),
              }]
            : []),
          // Venduto/scambiato: transazione conclusa, annuncio non più
          // modificabile (prima "Modifica" restava sempre visibile anche su
          // questi stati, mentre "Pausa/Riattiva" sopra li esclude già).
          ...(!isConcludedStatus(actionSheetItem.status)
            ? [{ label: t("common.edit", "Modifica"), onPress: () => onEdit(actionSheetItem) }]
            : []),
          { label: t("common.delete", "Elimina"), destructive: true, onPress: () => onDeleteConfirm(actionSheetItem) },
        ] : []}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // card contenitori header/sezioni profilo
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 12,
  },

  // ✅ stile titolo localizzato "I miei annunci"
  myListingsTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: theme.colors.boardingText,
  },

  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.colors.boardingText, fontWeight: "800", fontSize: 16 },
  avatarEditBadge: {
    position: "absolute", right: -2, bottom: -2,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: theme.colors.primary,
    borderWidth: 2, borderColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  name: { fontFamily: theme.fonts.headingExtraBold, fontSize: 16, color: theme.colors.boardingText},
  metaText: { color: theme.colors.textMuted },
  bioText: { color: theme.colors.text, marginTop: 12, lineHeight: 20 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  menuIcon: { width: 24, textAlign: "center" },
  menuLabel: { flex: 1, fontWeight: "700", color: theme.colors.text, fontSize: 15 },
  menuGroupLabel: {
    fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5,
    color: theme.colors.textMuted, marginLeft: 4, marginBottom: 6,
  },

  // stats
  statsCard: { marginTop: 12 },
  statsRow: { paddingRight: 6, gap: 10, flexDirection: "row", alignItems: "center" },
  statBox: {
    width: 100,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  statBoxActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primaryMuted },
  statIcon: { fontSize: 18, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText },
  statLabel: { fontSize: 12, color: theme.colors.textMuted },

  filterBar: {
    marginTop: 10, padding: 8, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  filterText: { color: theme.colors.textMuted, fontWeight: "600" },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.text },
  clearBtnText: { color: "#fff", fontWeight: "700" },

  sectionHeader: { marginTop: 0, marginBottom: 8, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.boardingText },

  // === CARDS LISTA ANNUNCI (stile HomeScreen)
  listCard: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  listCardTitle: { fontWeight: "800", color: theme.colors.boardingText },
  listCardSub: { color: theme.colors.textMuted, marginTop: 4 },
  listCardMeta: { color: theme.colors.text, marginTop: 6, fontWeight: "600" },

  stateBadge: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border },
  stateBadgeText: { fontSize: 12, fontWeight: "800", color: theme.colors.textMuted },

  overflowBtn: { marginLeft: 6, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center", justifyContent: "center" },
  overflowIcon: { fontSize: 20, color: theme.colors.textMuted, fontWeight: "800", marginTop: -2 },

  pubDate: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12 },

  errorBox: { marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  errorText: { color: "#991B1B" },
  retryText: { color: theme.colors.info, fontWeight: "700", marginTop: 6 },

  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  emptyTitle: { fontWeight: "800", color: theme.colors.text, marginBottom: 6 },
  emptyText: { color: theme.colors.textMuted, textAlign: "center" },

  fabWrap: { position: "absolute", right: 16 },
  fab: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center",
    ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 8 } }),
  },
  fabPlus: { color: theme.colors.boardingText, fontSize: 28, fontWeight: "900", marginTop: -2 },

  skel: { backgroundColor: theme.colors.border },

  footerCredits: {
    textAlign: "center",
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 20,
    marginBottom: 4,
  },
});
