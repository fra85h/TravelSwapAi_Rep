// screens/PreferencesOnboardingScreen.js — D4: preferenze subito dopo la
// registrazione, per alimentare da subito il matching AI (server/src/ai/
// score.js legge prefs.types/maxPrice/location per il fallback euristico,
// e l'AI vera li usa come contesto).
import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { saveMyPrefs, skipPrefsOnboarding } from "../lib/preferences";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";

const TYPE_OPTIONS = [
  { key: "train", icon: "train-outline", labelKey: "prefsOnboarding.typeTrain", fallback: "Treno" },
  { key: "hotel", icon: "bed-outline", labelKey: "prefsOnboarding.typeHotel", fallback: "Hotel" },
];

export default function PreferencesOnboardingScreen({ onDone }) {
  const { t } = useI18n();
  const [types, setTypes] = useState([]);
  const [maxPrice, setMaxPrice] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const toggleType = (key) => {
    setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const priceNum = Number(String(maxPrice).replace(",", "."));
      await saveMyPrefs({
        types,
        maxPrice: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined,
        location: location.trim() || undefined,
      });
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

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("prefsOnboarding.title", "Le tue preferenze di viaggio")}</Text>
        <Text style={styles.subtitle}>
          {t("prefsOnboarding.subtitle", "Aiutaci a trovarti gli scambi giusti — puoi cambiarle quando vuoi dal profilo.")}
        </Text>

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
          label={t("prefsOnboarding.locationLabel", "Città o zona preferita")}
          value={location}
          onChangeText={setLocation}
          placeholder={t("prefsOnboarding.locationPlaceholder", "Es. Milano")}
        />

        <Button
          title={t("prefsOnboarding.save", "Salva preferenze")}
          onPress={onSave}
          loading={saving}
          disabled={busy}
          style={{ marginTop: 8 }}
        />

        <TouchableOpacity onPress={onSkip} disabled={busy} style={styles.skipBtn}>
          {skipping ? (
            <ActivityIndicator color={theme.colors.textMuted} />
          ) : (
            <Text style={styles.skipText}>{t("prefsOnboarding.skip", "Salta per ora")}</Text>
          )}
        </TouchableOpacity>
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
  sectionLabel: { fontWeight: "700", color: theme.colors.text, marginBottom: 10 },
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
