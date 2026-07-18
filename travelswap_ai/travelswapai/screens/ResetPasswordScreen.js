// screens/ResetPasswordScreen.js — completa il flusso "password dimenticata"
// avviato da ForgotPasswordScreen. Il link nell'email di reset porta qui
// (deep link auth/reset) con una sessione di recupero incorporata nell'URL.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, Alert } from "react-native";
import * as Linking from "expo-linking";
import { useIsFocused } from "@react-navigation/native";
import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { supabase } from "../lib/supabase";
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
    const applySessionFromUrl = async (url) => {
      if (!url || doneRef.current) return false;
      if (__DEV__) console.log("[ResetPassword] raw url:", url);
      const parsed = Linking.parse(url);

      const code = parsed?.queryParams?.code;
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[ResetPassword] exchange error:", error.message || String(error));
          return false;
        }
        return !!data?.session;
      }

      if (typeof parsed?.fragment === "string" && parsed.fragment) {
        const params = new URLSearchParams(parsed.fragment);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error("[ResetPassword] setSession error:", error.message || String(error));
            return false;
          }
          return !!data?.session;
        }
      }

      return false;
    };

    const markReady = () => {
      if (!alive || doneRef.current) return;
      doneRef.current = true;
      setReady(true);
    };

    (async () => {
      if (!isFocused) return;

      const initialUrl = await Linking.getInitialURL();
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
      for (let i = 0; i < 10; i++) {
        if (doneRef.current) { sub.remove(); return; }
        const { data } = await supabase.auth.getSession();
        if (data.session) { sub.remove(); markReady(); return; }
        await new Promise((r) => setTimeout(r, 300));
      }

      sub.remove();
      if (alive && !doneRef.current) setInvalid(true);
    })();

    return () => {
      alive = false;
    };
  }, [isFocused]);

  const save = async () => {
    if (password.length < 6) {
      Alert.alert(t("auth.passwordTooShortTitle", "Password troppo corta"), t("auth.passwordTooShortMsg", "Usa almeno 6 caratteri."));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t("auth.resetMismatchTitle", "Le password non coincidono"), t("auth.resetMismatchMsg", "Assicurati che le due password siano identiche."));
      return;
    }
    try {
      setSaving(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      Alert.alert(t("auth.resetDoneTitle", "Password aggiornata"), t("auth.resetDoneMsg", "La tua password è stata aggiornata. Accedi con la nuova password."));
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    } catch (err) {
      Alert.alert(t("auth.resetError", "Errore"), err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
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
          onPress={() => navigation.reset({ index: 0, routes: [{ name: "Login" }] })}
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
    <View style={{ flex: 1, padding: 20, backgroundColor: theme.colors.background }}>
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
    </View>
  );
}
