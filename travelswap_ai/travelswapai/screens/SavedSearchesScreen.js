// screens/SavedSearchesScreen.js — avvisi di ricerca (D3): crea/gestisci
// filtri salvati e vedi gli annunci trovati che li soddisfano.
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert, Switch,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  listMySavedSearches, createSavedSearch, setSavedSearchActive,
  deleteSavedSearch, listMyMatches, markMatchSeen,
} from "../lib/savedSearches";
import { parseLocalizedNumber } from "../lib/number";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import StationAutocomplete from "../components/StationAutocomplete";

function formatDate(iso, locale) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale || undefined, { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function describeSearch(s, t) {
  if (s.type === "hotel") {
    const city = s.location || t("savedSearches.anyCity", "qualsiasi città");
    return s.max_price != null
      ? `🏨 ${city} · ≤ ${s.max_price}€`
      : `🏨 ${city}`;
  }
  const from = s.route_from || "?";
  const to = s.route_to || "?";
  return s.max_price != null
    ? `🚆 ${from} → ${to} · ≤ ${s.max_price}€`
    : `🚆 ${from} → ${to}`;
}

function describeListing(listing, t, locale) {
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

function NewSearchForm({ onCreated, t }) {
  const [type, setType] = useState("train");
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = type === "hotel" ? !!location.trim() : !!routeFrom.trim() && !!routeTo.trim();

  const handleSave = async () => {
    if (!canSave) {
      // Prima non c'era alcun feedback: il tap su "Crea avviso" con campi
      // incompleti non faceva nulla di visibile, e l'utente non capiva
      // perché (bug reale, capitato in produzione).
      Alert.alert(
        t("common.error", "Errore"),
        type === "hotel"
          ? t("savedSearches.missingFieldsHotel", "Inserisci la città.")
          : t("savedSearches.missingFieldsTrain", "Inserisci sia \"Da\" che \"A\".")
      );
      return;
    }
    // Il DB blocca max_price < 0 con un CHECK (saved_searches_max_price_check),
    // ma senza questo controllo l'utente vedrebbe l'errore Postgres grezzo
    // invece di un messaggio comprensibile.
    const parsedMaxPrice = parseLocalizedNumber(maxPrice);
    if (parsedMaxPrice != null && parsedMaxPrice < 0) {
      Alert.alert(t("common.error", "Errore"), t("savedSearches.maxPriceNegative", "Il prezzo massimo non può essere negativo."));
      return;
    }
    setSaving(true);
    try {
      await createSavedSearch({ type, routeFrom, routeTo, location, maxPrice });
      setRouteFrom(""); setRouteTo(""); setLocation(""); setMaxPrice("");
      onCreated();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("savedSearches.createError", "Impossibile creare l'avviso."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.typeRow}>
        {["train", "hotel"].map((tt) => (
          <TouchableOpacity
            key={tt}
            style={[styles.typeChip, type === tt && styles.typeChipActive]}
            onPress={() => setType(tt)}
          >
            <Text style={[styles.typeChipText, type === tt && styles.typeChipTextActive]}>
              {tt === "hotel" ? t("listing.type.hotel", "Hotel") : t("listing.type.train", "Treno")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {type === "hotel" ? (
        <Input
          label={t("savedSearches.locationLabel", "Città")}
          placeholder={t("savedSearches.locationPlaceholder", "Es. Firenze")}
          value={location}
          onChangeText={setLocation}
        />
      ) : (
        <>
          {/* Stesso stile visivo di Input, con suggerimenti stazioni
              (lib/trainStations): resta testo libero, il suggerimento aiuta
              solo a scrivere in modo uniforme. */}
          <Text style={{ fontWeight: "700", color: theme.colors.text, marginBottom: 8 }}>
            {t("savedSearches.fromLabel", "Da")}
          </Text>
          <View style={{ borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, paddingHorizontal: 12, paddingVertical: 10, marginBottom: theme.spacing.md, ...theme.shadow.sm }}>
            <StationAutocomplete
              value={routeFrom}
              onChangeText={setRouteFrom}
              placeholder={t("savedSearches.fromPlaceholder", "Es. Roma")}
              inputStyle={{ color: theme.colors.text, fontSize: 16 }}
            />
          </View>
          <Text style={{ fontWeight: "700", color: theme.colors.text, marginBottom: 8 }}>
            {t("savedSearches.toLabel", "A")}
          </Text>
          <View style={{ borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, paddingHorizontal: 12, paddingVertical: 10, marginBottom: theme.spacing.md, ...theme.shadow.sm }}>
            <StationAutocomplete
              value={routeTo}
              onChangeText={setRouteTo}
              placeholder={t("savedSearches.toPlaceholder", "Es. Milano")}
              inputStyle={{ color: theme.colors.text, fontSize: 16 }}
            />
          </View>
        </>
      )}

      <Input
        label={t("savedSearches.maxPriceLabel", "Prezzo massimo (facoltativo)")}
        placeholder={t("savedSearches.maxPricePlaceholder", "Es. 50")}
        keyboardType="numeric"
        value={maxPrice}
        onChangeText={setMaxPrice}
      />

      <Button
        title={t("savedSearches.save", "Crea avviso")}
        onPress={handleSave}
        disabled={!canSave || saving}
        loading={saving}
      />
    </View>
  );
}

function SearchRow({ search, onToggle, onDelete, t }) {
  return (
    <View style={styles.searchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.searchRowText}>{describeSearch(search, t)}</Text>
        {!search.active ? (
          <Text style={styles.pausedText}>{t("savedSearches.paused", "In pausa")}</Text>
        ) : null}
      </View>
      <Switch
        value={search.active}
        onValueChange={(v) => onToggle(search.id, v)}
        trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
      />
      <TouchableOpacity onPress={() => onDelete(search.id)} style={{ marginLeft: 10 }}>
        <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

function MatchCard({ match, onPress, t, locale }) {
  return (
    <TouchableOpacity style={styles.matchCard} onPress={() => onPress(match)}>
      {!match.seen ? <View style={styles.newDot} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.matchFor}>
          {t("savedSearches.matchFor", "Per il tuo avviso: {desc}", { desc: describeSearch(match.search || {}, t) })}
        </Text>
        <Text style={styles.matchListing}>{describeListing(match.listing, t, locale)}</Text>
        {match.listing?.price != null ? (
          <Text style={styles.matchPrice}>{Number(match.listing.price)}€</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function SavedSearchesScreen({ navigation }) {
  const { t, locale } = useI18n();
  const [searches, setSearches] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([listMySavedSearches(), listMyMatches()]);
      setSearches(s);
      setMatches(m);
    } catch (e) {
      if (__DEV__) console.log("[SavedSearches] load error", e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleCreated = useCallback(() => {
    setFormOpen(false);
    load();
  }, [load]);

  const handleToggle = useCallback(async (id, active) => {
    setSearches((prev) => prev.map((s) => (s.id === id ? { ...s, active } : s)));
    try {
      await setSavedSearchActive(id, active);
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("savedSearches.toggleError", "Impossibile aggiornare l'avviso."));
      load();
    }
  }, [load, t]);

  const handleDelete = useCallback((id) => {
    Alert.alert(
      t("savedSearches.deleteTitle", "Elimina avviso"),
      t("savedSearches.deleteMsg", "Non riceverai più notifiche per questa ricerca."),
      [
        { text: t("common.cancel", "Annulla"), style: "cancel" },
        {
          text: t("common.delete", "Elimina"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteSavedSearch(id);
              load();
            } catch (e) {
              Alert.alert(t("common.error", "Errore"), e?.message || t("savedSearches.deleteError", "Impossibile eliminare l'avviso."));
            }
          },
        },
      ]
    );
  }, [load, t]);

  const handleMatchPress = useCallback((match) => {
    if (!match.seen) markMatchSeen(match.id).catch(() => {});
    navigation?.navigate?.("ListingDetail", { id: match.listing_id });
  }, [navigation]);

  if (loading && !searches.length && !matches.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.intro}>
        {t("savedSearches.intro", "Crea un avviso e ti mostreremo qui i nuovi annunci che lo soddisfano — niente più ricerche ripetute a mano.")}
      </Text>

      {!formOpen ? (
        <Button
          title={t("savedSearches.newAlert", "+ Nuovo avviso")}
          variant="outline"
          onPress={() => setFormOpen(true)}
          style={{ marginBottom: 16 }}
        />
      ) : (
        <NewSearchForm onCreated={handleCreated} t={t} />
      )}

      {searches.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("savedSearches.myAlerts", "I tuoi avvisi")}</Text>
          {searches.map((s) => (
            <SearchRow key={s.id} search={s} onToggle={handleToggle} onDelete={handleDelete} t={t} />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("savedSearches.found", "Annunci trovati")}</Text>
        {matches.length ? (
          matches.map((m) => (
            <MatchCard key={m.id} match={m} onPress={handleMatchPress} t={t} locale={locale} />
          ))
        ) : (
          <Text style={styles.emptyText}>
            {t("savedSearches.emptyMatches", "Nessun annuncio trovato ancora per i tuoi avvisi.")}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  intro: { color: theme.colors.textMuted, marginBottom: 16, lineHeight: 20 },
  form: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    marginBottom: 16,
  },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  typeChipActive: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
  typeChipText: { color: theme.colors.textMuted, fontWeight: "700" },
  typeChipTextActive: { color: theme.colors.accentOn },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: theme.colors.text, marginBottom: 10 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginBottom: 8,
  },
  searchRowText: { color: theme.colors.text, fontWeight: "600" },
  pausedText: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  matchCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent },
  matchFor: { color: theme.colors.textMuted, fontSize: 12, marginBottom: 2 },
  matchListing: { color: theme.colors.text, fontWeight: "700" },
  matchPrice: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  emptyText: { color: theme.colors.textMuted, lineHeight: 20 },
});
