// screens/LegalConsentScreen.js — accettazione di termini e privacy.
//
// Sta DOPO l'autenticazione e PRIMA dell'app, come già fa il passaggio delle
// preferenze in App.js. È l'unico punto in cui si passa, e questo risolve in
// un colpo solo tre casi che una spunta in fase di registrazione avrebbe
// lasciato scoperti: chi entra con Google (dove non c'è un modulo da
// spuntare), chi era già registrato prima che i documenti esistessero, e
// chiunque quando alzeremo la versione dei documenti.
//
// Non è un muro cieco: il riassunto dice le tre cose che contano davvero
// prima ancora di aprire i documenti — non gestiamo pagamenti, non siamo
// parte dell'accordo, l'annuncio viene analizzato in automatico. Sono i punti
// che un utente scoprirebbe altrimenti quando è troppo tardi.
import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { acceptTerms, LEGAL_URLS } from "../lib/legal";

export default function LegalConsentScreen({ onAccepted }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const open = (url) => Linking.openURL(url).catch(() => {
    Alert.alert(t("common.error", "Errore"), t("legal.openError", "Non riesco ad aprire il documento."));
  });

  const onAccept = async () => {
    try {
      setBusy(true);
      await acceptTerms();
      onAccepted?.();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("legal.acceptError", "Non sono riuscito a registrare l'accettazione. Riprova."));
    } finally {
      setBusy(false);
    }
  };

  const Point = ({ icon, title, body }) => (
    <View style={s.point}>
      <Ionicons name={icon} size={18} color={theme.colors.accent} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.pointTitle}>{title}</Text>
        <Text style={s.pointBody}>{body}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>{t("legal.title", "Prima di iniziare")}</Text>
        <Text style={s.intro}>
          {t("legal.intro", "Tre cose che conviene sapere subito su come funziona TravelSwap.")}
        </Text>

        <Point
          icon="swap-horizontal-outline"
          title={t("legal.p1Title", "Mettiamo in contatto, non vendiamo")}
          body={t("legal.p1Body", "L'accordo è fra te e l'altra persona: non siamo parte del contratto e non possiamo garantire la validità di un biglietto.")}
        />
        <Point
          icon="wallet-outline"
          title={t("legal.p2Title", "Oggi non gestiamo pagamenti")}
          body={t("legal.p2Body", "Il denaro passa direttamente fra voi, fuori dall'app: non lo tratteniamo e non possiamo rimborsarlo. Concordate il metodo in chat e conservate la ricevuta.")}
        />
        <Point
          icon="sparkles-outline"
          title={t("legal.p3Title", "I tuoi annunci vengono analizzati")}
          body={t("legal.p3Body", "Un sistema automatico stima l'attendibilità di ogni annuncio dal suo contenuto e mostra il risultato in pubblico. Riguarda l'annuncio, non te, e puoi chiederne la revisione.")}
        />

        <View style={s.links}>
          <TouchableOpacity onPress={() => open(LEGAL_URLS.terms)} accessibilityRole="link">
            <Text style={s.link}>{t("legal.readTerms", "Leggi i Termini di servizio")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => open(LEGAL_URLS.privacy)} accessibilityRole="link">
            <Text style={s.link}>{t("legal.readPrivacy", "Leggi l'Informativa privacy")}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[s.btn, busy && s.btnDisabled]}
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={s.btnTxt}>
            {busy ? "…" : t("legal.accept", "Ho letto e accetto")}
          </Text>
        </TouchableOpacity>

        {/* Rifiutare deve restare possibile, altrimenti non è un'accettazione:
            chi non accetta esce, e il suo account resta dov'è. */}
        <TouchableOpacity onPress={() => signOut?.()} accessibilityRole="button">
          <Text style={s.decline}>{t("legal.decline", "Non accetto — esci")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.xxl, gap: theme.spacing.md },
  title: { ...theme.typography.title, color: theme.colors.text },
  intro: { ...theme.typography.body, color: theme.colors.textMuted, marginBottom: theme.spacing.sm },
  point: {
    flexDirection: "row", gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md, padding: theme.spacing.lg,
  },
  pointTitle: { ...theme.typography.body, fontWeight: "800" },
  pointBody: { ...theme.typography.small, lineHeight: 18, marginTop: 2 },
  links: { gap: theme.spacing.xs, marginTop: theme.spacing.sm },
  link: { ...theme.typography.body, color: theme.colors.accent, fontWeight: "700", textDecorationLine: "underline" },
  btn: {
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill,
    paddingVertical: 14, marginTop: theme.spacing.lg,
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt: { color: theme.colors.accentOn, fontWeight: "800", fontSize: 16 },
  decline: { ...theme.typography.small, textAlign: "center", marginTop: theme.spacing.md, textDecorationLine: "underline" },
});
