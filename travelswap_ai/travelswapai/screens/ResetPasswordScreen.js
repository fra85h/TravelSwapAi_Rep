// screens/ResetPasswordScreen.js — completa il flusso "password dimenticata"
// avviato da ForgotPasswordScreen. Il link nell'email di reset porta qui
// (deep link auth/reset) con una sessione di recupero incorporata nell'URL.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, Alert } from "react-native";
import * as Linking from "expo-linking";
import { useIsFocused } from "@react-navigation/native";
import { theme } from "../lib/theme";
import FormScreen from "../components/ui/FormScreen";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { supabase } from "../lib/supabase";
import { parseAuthParams } from "../lib/authLinks";
import { beginPasswordRecovery, endPasswordRecovery } from "../lib/passwordRecovery";
import { withTimeout, TIMEOUT_PREFIX } from "../lib/withTimeout";
import { useI18n } from "../lib/i18n";

export default function ResetPasswordScreen({ navigation }) {
  const { t } = useI18n();
  const isFocused = useIsFocused();
  // Sessione di recupero già agganciata: ignora ulteriori eventi url.
  const doneRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    // Con flowType implicit (default di questo client, vedi lib/supabase.js)
    // il link di reset porta i token nel frammento dell'URL
    // (#access_token=...&refresh_token=...&type=recovery), non in un
    // ?code=: il ramo PKCE qui sotto resta comunque come fallback
    // difensivo, stesso doppio binario già usato in
    // LoginScreen.handleOAuthCallback.
    //
    // I parametri si leggono con parseAuthParams e NON con Linking.parse,
    // che non espone affatto il frammento: vedi la nota in lib/authLinks.js.
    const applySessionFromUrl = async (url) => {
      if (!url || doneRef.current) return false;
      if (__DEV__) console.log("[ResetPassword] raw url:", url);
      const params = parseAuthParams(url);

      // PRIMA di stabilire la sessione, non dopo: fra l'arrivo della
      // sessione e il ri-render di RootNavigator non deve esserci una
      // finestra in cui l'app ci porta dentro comunque.
      const code = params.code;
      if (code || params.access_token) beginPasswordRecovery();

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[ResetPassword] exchange error:", error.message || String(error));
          endPasswordRecovery();
          return false;
        }
        return !!data?.session;
      }

      const accessToken = params.access_token;
      if (accessToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: params.refresh_token || null,
        });
        if (error) {
          console.error("[ResetPassword] setSession error:", error.message || String(error));
          endPasswordRecovery();
          return false;
        }
        return !!data?.session;
      }

      // Link scaduto o già usato: Supabase rimanda qui con l'errore nel
      // frammento invece che con i token. Non è un caso da ritentare —
      // l'attesa di 3 secondi qui sotto non lo farebbe comparire.
      if (params.error || params.error_code) {
        console.warn(
          "[ResetPassword] link rifiutato da Supabase:",
          params.error_code || params.error,
        );
      }
      return false;
    };

    const markReady = () => {
      if (!alive || doneRef.current) return;
      doneRef.current = true;
      setReady(true);
    };

    // Sul web, gli screen non mappati in App.js linking.config.screens
    // (Login, Profile, MainTabs, ...) non aggiornano la barra indirizzi:
    // se restasse su /auth/reset, un logout successivo (che smonta e
    // ricrea lo Stack.Navigator per il cambio di `session`) rilegge
    // quell'URL rimasto fermo e ripiomba qui invece che su Login, pur
    // non essendoci alcun link di reset in corso. Va ripulita SEMPRE
    // al mount di questo screen, non solo quando arriva un url reale:
    // se si arriva qui per il riaggancio dell'URL vecchio (non per un
    // vero evento di deep link), Linking.getInitialURL() qui sotto
    // torna null, quindi il ramo "url valido" non scatterebbe mai.
    //
    // ORDINE: il frammento con i token va CATTURATO PRIMA di ripulire la
    // barra. Invertendo i due passaggi — com'era — si cancella il token un
    // istante prima di leggerlo: Linking.getInitialURL() sul web restituisce
    // window.location.href, che a quel punto è già ripulito, e il client ha
    // detectSessionInUrl:false (lib/supabase.js), quindi nessun altro lo
    // legge al posto suo. Risultato: sul web il reset password mostrava
    // SEMPRE "Link non valido", qualunque link si aprisse.
    const webHref =
      typeof window !== "undefined" && window.location ? window.location.href : null;

    if (typeof window !== "undefined" && window.history?.replaceState) {
      // Si toglie solo la parte /auth/reset, che è ciò che causava il
      // rimbalzo qui dopo un logout. Sulla radice ci si può atterrare senza
      // problemi: il server la reindirizza a /app (server/src/index.js).
      const base = window.location.pathname.replace(/\/auth\/reset.*$/, "") || "/";
      window.history.replaceState(null, "", base);
    }

    (async () => {
      if (!isFocused) return;

      const initialUrl = webHref || (await Linking.getInitialURL());
      if (await applySessionFromUrl(initialUrl)) {
        markReady();
        return;
      }

      const sub = Linking.addEventListener("url", async ({ url }) => {
        if (doneRef.current) return;
        if (await applySessionFromUrl(url)) markReady();
      });

      // Fallback: la sessione di recupero potrebbe già essere presente
      // (es. link aperto una seconda volta) senza un nuovo evento url.
      // Anche qui va alzato il flag: essere arrivati fin qui con una
      // sessione in corso significa che la si sta usando per cambiare la
      // password, non per entrare.
      for (let i = 0; i < 10; i++) {
        if (doneRef.current) { sub.remove(); return; }
        const { data } = await supabase.auth.getSession();
        if (data.session) { sub.remove(); beginPasswordRecovery(); markReady(); return; }
        await new Promise((r) => setTimeout(r, 300));
      }

      sub.remove();
      if (alive && !doneRef.current) setInvalid(true);
    })();

    return () => {
      alive = false;
    };
  }, [isFocused]);

  // Rete di sicurezza: se si esce da qui in un modo non previsto (indietro
  // del browser, deep link verso un'altra schermata) il flag va comunque
  // abbassato, altrimenti l'app resterebbe convinta che nessuno è
  // autenticato. Effetto separato, con dipendenze vuote: quello sopra si
  // rilancia al cambio di `isFocused` e lo azzererebbe a metà flusso.
  useEffect(() => endPasswordRecovery, []);

  const save = async () => {
    if (password.length < 6) {
      Alert.alert(t("auth.passwordTooShortTitle", "Password troppo corta"), t("auth.passwordTooShortMsg", "Usa almeno 6 caratteri."));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t("auth.resetMismatchTitle", "Le password non coincidono"), t("auth.resetMismatchMsg", "Assicurati che le due password siano identiche."));
      return;
    }
    setSaving(true);

    // Il cambio password è l'unico passaggio che conta.
    try {
      const { error } = await withTimeout(supabase.auth.updateUser({ password }), 20000, "updateUser");
      if (error) throw error;
    } catch (err) {
      setSaving(false);
      const timedOut = String(err?.message || "").startsWith(TIMEOUT_PREFIX);
      console.error("[ResetPassword] updateUser:", err?.message || String(err));
      Alert.alert(
        t("auth.resetError", "Errore"),
        timedOut
          ? `${t("auth.resetTimeoutMsg", "Il server non ha risposto in tempo. La password potrebbe non essere stata cambiata: riprova, e se il problema resta richiedi un link nuovo.")} (${err.message})`
          : err?.message ?? String(err),
      );
      return;
    }

    // Da qui la password È GIÀ cambiata. Tutto quello che segue è di
    // contorno e non deve poter far credere il contrario: un signOut che
    // fallisce non è un reset fallito, e mostrare "Errore" a chi ha appena
    // cambiato la password lo porterebbe a riprovare con un link ormai
    // consumato.
    try {
      // signOut PRIMA di abbassare il flag: invertendo i due passaggi si
      // resta per un istante con una sessione valida e il reset concluso,
      // e in quell'istante RootNavigator porta dentro l'app — che è il
      // comportamento corretto in #255.
      await withTimeout(supabase.auth.signOut(), 8000, "signOut");
    } catch (err) {
      console.warn("[ResetPassword] signOut dopo il cambio password:", err?.message || String(err));
    }
    endPasswordRecovery();
    setSaving(false);
    Alert.alert(t("auth.resetDoneTitle", "Password aggiornata"), t("auth.resetDoneMsg", "La tua password è stata aggiornata. Accedi con la nuova password."));
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  if (invalid) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: theme.colors.background }}>
        <Text style={{ fontFamily: theme.fonts.headingExtraBold, fontSize: 20, color: theme.colors.text, textAlign: "center", marginBottom: 12 }}>
          {t("auth.resetLinkInvalidTitle", "Link non valido")}
        </Text>
        <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginBottom: 20 }}>
          {t("auth.resetLinkInvalidMsg", "Il link di reset non è valido o è scaduto. Richiedine uno nuovo.")}
        </Text>
        <Button
          title={t("auth.backToLogin", "Torna al login")}
          onPress={() => {
            endPasswordRecovery();
            navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          }}
        />
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FormScreen>
      <Text style={{ fontFamily: theme.fonts.headingExtraBold, fontSize: 22, color: theme.colors.text, marginBottom: 16 }}>
        {t("auth.resetTitle", "Nuova password")}
      </Text>
      <Input
        label={t("auth.newPassword", "Nuova password")}
        placeholder="••••••••"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Input
        label={t("auth.confirmPassword", "Conferma password")}
        placeholder="••••••••"
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />
      <Button title={t("auth.resetSave", "Salva password")} onPress={save} loading={saving} />
    </FormScreen>
  );
}
