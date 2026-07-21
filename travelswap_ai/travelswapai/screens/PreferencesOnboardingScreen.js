// screens/PreferencesOnboardingScreen.js — D4: preferenze subito dopo la
// registrazione. NON alimentano il matching AI: quello si basa sul tuo
// annuncio pubblicato (tipo/tratta/budget), un segnale già più preciso.
// Qui servono a personalizzare Esplora (tab preselezionato in base al tipo,
// annunci della zona preferita in cima) — vedi HomeScreen.js.
import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { getMyPrefs, saveMyPrefs, skipPrefsOnboarding } from "../lib/preferences";
import { parseLocalizedNumber } from "../lib/number";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";

const TYPE_OPTIONS = [
  { key: "train", icon: "train-outline", labelKey: "prefsOnboarding.typeTrain", fallback: "Treno" },
  { key: "hotel", icon: "bed-outline", labelKey: "prefsOnboarding.typeHotel", fallback: "Hotel" },
];

// mode "onboarding" (default): gate subito dopo la registrazione, con
// "Salta per ora". mode "edit": raggiunta dal profilo in qualsiasi
// momento, precarica le preferenze già salvate e non ha lo skip (c'è
// già la freccia indietro dell'header).
export default function PreferencesOnboardingScreen({ onDone, mode = "onboarding" }) {
  const { t } = useI18n();
  const isEdit = mode === "edit";
  const [types, setTypes] = useState([]);
  const [maxPrice, setMaxPrice] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    getMyPrefs()
      .then((prefs) => {
        if (!alive || !prefs) return;
        setTypes(Array.isArray(prefs.types) ? prefs.types : []);
        setMaxPrice(prefs.maxPrice != null ? String(prefs.maxPrice) : "");
        // Supporta più zone (locations[]) con fallback al vecchio singolo.
        setLocation(
          Array.isArray(prefs.locations) && prefs.locations.length
            ? prefs.locations.join(", ")
            : (prefs.location || "")
        );
      })
      .finally(() => { if (alive) setLoadingPrefs(false); });
    return () => { alive = false; };
  }, [isEdit]);

  const toggleType = (key) => {
    setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const priceNum = parseLocalizedNumber(maxPrice) ?? NaN;
      // Più zone/tratte separate da virgola → array. Manteniamo anche
      // `location` (la prima) per retrocompatibilità con chi legge il vecchio
      // campo singolo (es. HomeScreen/score.js più vecchi).
      const locations = location
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await saveMyPrefs({
        types,
        maxPrice: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined,
        location: locations[0] || undefined,
        locations: locations.length ? locations : undefined,
      });
      if (isEdit) {
        Alert.alert(t("prefsOnboarding.savedTitle", "Salvato"), t("prefsOnboarding.savedMsg", "Preferenze aggiornate."));
      }
      onDone?.();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("prefsOnboarding.saveError", "Impossibile salvare le preferenze."));
    } finally {
      setSaving(false);
    }
  };

  const onSkip = async () => {
    setSkipping(true);
    try {
      await skipPrefsOnboarding();
      onDone?.();
    } catch {
      // anche in errore, non blocchiamo l'utente sull'onboarding
      onDone?.();
    } finally {
      setSkipping(false);
    }
  };

  const busy = saving || skipping;

  if (loadingPrefs) {
    return (
      <SafeAreaView style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("prefsOnboarding.title", "Le tue preferenze di viaggio")}</Text>
        <Text style={styles.subtitle}>
          {isEdit
            ? t("prefsOnboarding.editSubtitle", "Aggiorna i tuoi gusti di viaggio: li usiamo per suggerirti scambi migliori.")
            : t("prefsOnboarding.subtitle", "Aiutaci a trovarti gli scambi giusti — puoi cambiarle quando vuoi dal profilo.")}
        </Text>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.textMuted} style={{ marginTop: 1 }} />
          <Text style={styles.infoBoxText}>
            {t("prefsOnboarding.usageInfo", "Come le usiamo: tipo e località preferiti preselezionano i filtri e mettono in cima gli annunci della tua zona in Esplora. Non influenzano i punteggi di match, calcolati sul tuo annuncio pubblicato.")}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>{t("prefsOnboarding.typeLabel", "Cosa ti interessa di più?")}</Text>
        <View style={styles.typeRow}>
          {TYPE_OPTIONS.map((opt) => {
            const selected = types.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => toggleType(opt.key)}
                style={[styles.typeChip, selected && styles.typeChipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Ionicons
                  name={opt.icon}
                  size={20}
                  color={selected ? theme.colors.accentOn : theme.colors.textMuted}
                />
                <Text style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>
                  {t(opt.labelKey, opt.fallback)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Input
          label={t("prefsOnboarding.maxPriceLabel", "Budget massimo indicativo (€)")}
          value={maxPrice}
          onChangeText={setMaxPrice}
          placeholder={t("prefsOnboarding.maxPricePlaceholder", "Es. 100")}
          keyboardType="numeric"
        />

        <Input
          label={
            types.includes("train")
              ? t("prefsOnboarding.locationLabelTrain", "Tratta preferita")
              : t("prefsOnboarding.locationLabel", "Città o zona preferita")
          }
          value={location}
          onChangeText={setLocation}
          placeholder={
            types.includes("train")
              ? t("prefsOnboarding.locationPlaceholderTrain", "Es. Milano → Roma, Torino → Genova")
              : t("prefsOnboarding.locationPlaceholder", "Es. Milano, Firenze")
          }
        />
        <Text style={styles.fieldHint}>
          {t("prefsOnboarding.locationsHint", "Puoi indicarne più di una separandole con la virgola: Esplora darà priorità a queste zone/tratte.")}
        </Text>

        <Button
          title={t("prefsOnboarding.save", "Salva preferenze")}
          onPress={onSave}
          loading={saving}
          disabled={busy}
          style={{ marginTop: 8 }}
        />

        {!isEdit && (
          <TouchableOpacity onPress={onSkip} disabled={busy} style={styles.skipBtn}>
            {skipping ? (
              <ActivityIndicator color={theme.colors.textMuted} />
            ) : (
              <Text style={styles.skipText}>{t("prefsOnboarding.skip", "Salta per ora")}</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 24, paddingTop: 32 },
  title: {
    fontFamily: theme.fonts.headingExtraBold,
    fontSize: 24,
    color: theme.colors.text,
    marginBottom: 8,
  },
  subtitle: { color: theme.colors.textMuted, lineHeight: 20, marginBottom: 24 },
  infoBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginBottom: 20,
  },
  infoBoxText: { flex: 1, color: theme.colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  sectionLabel: { fontWeight: "700", color: theme.colors.text, marginBottom: 10 },
  fieldHint: { color: theme.colors.textMuted, fontSize: 12, marginTop: -6, marginBottom: 8, lineHeight: 16 },
  typeRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  typeChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  typeChipSelected: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  typeChipText: { fontWeight: "700", color: theme.colors.textMuted },
  typeChipTextSelected: { color: theme.colors.accentOn },
  skipBtn: { alignItems: "center", marginTop: 16, padding: 8 },
  skipText: { color: theme.colors.textMuted, fontWeight: "600" },
});
