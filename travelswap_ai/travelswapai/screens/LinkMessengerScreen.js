// screens/LinkMessengerScreen.js — collega l'account al bot Messenger
// della Pagina Facebook: generi un codice monouso e lo scrivi al bot,
// da quel momento gli annunci che pubblichi via Messenger finiscono
// nel tuo profilo invece che in un account condiviso.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { requestFbLinkCode } from "../lib/fbLink";
import Button from "../components/ui/Button";

function formatExpiry(iso, locale) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString(locale || undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function LinkMessengerScreen() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const out = await requestFbLinkCode();
      setCode(out?.code || null);
      setExpiresAt(out?.expiresAt || null);
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("linkMessenger.error", "Impossibile generare il codice."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  return (
    <View style={styles.root}>
      <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.accent} style={{ marginBottom: 12 }} />
      <Text style={styles.title}>{t("linkMessenger.title", "Collega Messenger")}</Text>
      <Text style={styles.intro}>
        {t("linkMessenger.intro", "Scrivi al bot Messenger della nostra Pagina Facebook e pubblica un annuncio direttamente da lì. Collega prima il tuo account, una volta sola, così gli annunci finiscono nel tuo profilo.")}
      </Text>

      {!code ? (
        <Button
          title={loading ? t("common.loading", "Caricamento…") : t("linkMessenger.generate", "Genera codice")}
          onPress={generate}
          loading={loading}
          disabled={loading}
          style={{ marginTop: 20 }}
        />
      ) : (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>{t("linkMessenger.yourCode", "Il tuo codice")}</Text>
          <Text style={styles.code}>{code}</Text>
          <Text style={styles.expiry}>
            {t("linkMessenger.validUntil", "Valido fino alle {time}", { time: formatExpiry(expiresAt, locale) })}
          </Text>
          <Text style={styles.instructions}>
            {t("linkMessenger.instructions", "Apri Messenger, scrivi alla Pagina TravelSwapAI e manda questo codice come messaggio. Riceverai una conferma quando il collegamento è fatto.")}
          </Text>
          <Button
            title={t("linkMessenger.regenerate", "Genera un nuovo codice")}
            variant="outline"
            onPress={generate}
            loading={loading}
            disabled={loading}
            style={{ marginTop: 16 }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    padding: 24,
    paddingTop: 40,
    backgroundColor: theme.colors.background,
  },
  title: {
    fontFamily: theme.fonts.headingExtraBold,
    fontSize: 22,
    color: theme.colors.text,
    marginBottom: 10,
    textAlign: "center",
  },
  intro: {
    color: theme.colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  codeCard: {
    marginTop: 24,
    width: "100%",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    padding: 20,
    ...theme.shadow.sm,
  },
  codeLabel: { color: theme.colors.textMuted, fontWeight: "700", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  code: {
    fontFamily: theme.fonts.headingExtraBold,
    fontSize: 36,
    letterSpacing: 6,
    color: theme.colors.accentOn,
    marginTop: 8,
  },
  expiry: { color: theme.colors.textMuted, fontSize: 12, marginTop: 6 },
  instructions: { color: theme.colors.text, textAlign: "center", lineHeight: 20, marginTop: 16 },
});
