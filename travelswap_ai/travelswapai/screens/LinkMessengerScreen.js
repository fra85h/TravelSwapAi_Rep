// screens/LinkMessengerScreen.js — collega l'account al bot Messenger
// della Pagina Facebook: generi un codice monouso e lo scrivi al bot,
// da quel momento gli annunci che pubblichi via Messenger finiscono
// nel tuo profilo invece che in un account condiviso.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator } from "react-native";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { requestFbLinkCode } from "../lib/fbLink";
import Button from "../components/ui/Button";
import { alertArgs } from "../lib/userError.mjs";

// La Pagina a cui l'utente deve scrivere. Configurabile perché in prova e
// in produzione non è la stessa; senza, il pulsante "Apri Messenger" non
// compare — meglio nessun pulsante che un pulsante che porta altrove.
const MESSENGER_PAGE = (process.env.EXPO_PUBLIC_MESSENGER_PAGE || "").trim();
const messengerUrl = () => (MESSENGER_PAGE ? `https://m.me/${MESSENGER_PAGE}` : null);

// Copia negli appunti senza aggiungere expo-clipboard: è un modulo nativo, e
// una nuova dipendenza nativa costringe a una build EAS per un pulsante.
// Sul web (dove l'app gira oggi) l'API del browser basta; dove non c'è, il
// pulsante non compare — il codice resta grande e leggibile a schermo, che
// è comunque il modo in cui la maggior parte lo trascriverà.
const clipboard = () => globalThis?.navigator?.clipboard || null;
const canCopy = () => typeof clipboard()?.writeText === "function";

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
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(async () => {
    if (!code || !canCopy()) return;
    try {
      await clipboard().writeText(String(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Copiare può fallire (permessi del browser): non è un guasto da
      // avviso, il codice resta leggibile a schermo e trascrivibile.
    }
  }, [code]);

  const openMessenger = useCallback(async () => {
    const url = messengerUrl();
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert(...alertArgs(e, {
        t,
        titolo: t("linkMessenger.openFailedTitle", "Non riesco ad aprire Messenger"),
        azione: t("linkMessenger.openFailedAction", "Aprilo a mano e scrivi il codice alla Pagina TravelSwap."),
      }));
    }
  }, [t]);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const out = await requestFbLinkCode();
      setCode(out?.code || null);
      setExpiresAt(out?.expiresAt || null);
    } catch (e) {
      Alert.alert(...alertArgs(e, {
        t,
        titolo: t("linkMessenger.errorTitle", "Codice non generato"),
        azione: t("linkMessenger.errorAction", "Riprova fra poco: il collegamento non è stato avviato."),
      }));
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
            {t("linkMessenger.instructions", "Apri Messenger, scrivi alla Pagina TravelSwap e manda questo codice come messaggio. Riceverai una conferma quando il collegamento è fatto.")}
          </Text>
          {/* Il codice da solo non collega niente: va portato dentro
              Messenger. Prima questa schermata finiva qui — nessuna azione,
              nessuna uscita, nemmeno un modo di copiare le sei cifre senza
              trascriverle a mano. */}
          {canCopy() ? (
            <Button
              title={copied ? t("linkMessenger.copied", "Copiato ✓") : t("linkMessenger.copy", "Copia il codice")}
              variant="outline"
              onPress={copyCode}
              style={{ marginTop: 16 }}
            />
          ) : null}
          {messengerUrl() ? (
            <Button
              title={t("linkMessenger.openMessenger", "Apri Messenger")}
              onPress={openMessenger}
              style={{ marginTop: 10 }}
            />
          ) : null}
          <Button
            title={t("linkMessenger.regenerate", "Genera un nuovo codice")}
            variant="subtle"
            onPress={generate}
            loading={loading}
            disabled={loading}
            style={{ marginTop: 10 }}
          />
          <Text style={styles.doneHint}>
            {t("linkMessenger.doneHint", "Quando il bot ti risponde \"collegato\", hai finito: puoi tornare indietro.")}
          </Text>
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
  doneHint: { color: theme.colors.textMuted, fontSize: 12.5, textAlign: "center", marginTop: 14, lineHeight: 17 },
  instructions: { color: theme.colors.text, textAlign: "center", lineHeight: 20, marginTop: 16 },
});
