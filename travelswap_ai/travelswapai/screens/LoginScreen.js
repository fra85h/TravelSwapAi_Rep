// screens/LoginScreen.js
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { AntDesign } from "@expo/vector-icons";

import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { supabase } from "../lib/supabase.js"; // <-- usa il client unico
import { useI18n } from "../lib/i18n";

WebBrowser.maybeCompleteAuthSession();

// Redirect per Expo Go (DEVE combaciare con Supabase)
const REDIRECT_TO = "https://auth.expo.io/@fra85h/travelswap";


/** --------- HELPERS OAUTH COMUNI (fuori dal componente) --------- **/

async function handleOAuthCallback(returnUrl) {
  // returnUrl contiene il code PKCE: lo logghiamo solo in dev
  if (__DEV__) console.log("[OAuth] callback url =", returnUrl);
  const parsed = Linking.parse(returnUrl);

  // A) PKCE: ?code=...
  const code = parsed?.queryParams?.code;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession({ authCode: code });
    if (error) {
      console.error("[OAuth] exchange error", error);
      throw error;
    }
    return;
  }

  // B) Implicit fallback: #access_token=...
  if (typeof parsed?.fragment === "string") {
    const token = new URLSearchParams(parsed.fragment).get("access_token");
    if (token) {
      const { error } = await supabase.auth.setSession({
        access_token: token,
        refresh_token: null,
      });
      if (error) {
        console.error("[OAuth] setSession error", error);
        throw error;
      }
      return;
    }
  }

  throw new Error("Né code né access_token nel redirect.");
}
export async function signInWithProviderOAuth(provider) {
  let sub;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: REDIRECT_TO,
        skipBrowserRedirect: true,
        flowType: "pkce",
        ...(provider === "google"
          ? { queryParams: { prompt: "consent", access_type: "offline" } }
          : {}),
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("OAuth URL mancante.");

    // 1) Prepara listener (una sola volta)
    const urlPromise = new Promise((resolve) => {
      sub = Linking.addEventListener("url", ({ url }) => resolve(url));
    });

    // 2) Apri browser "pieno"
    await WebBrowser.openBrowserAsync(data.url);

    // 3) Attendi callback da auth.expo.io → deep link alla tua app
    const callbackUrl = await urlPromise;

    // 4) Chiudi browser e gestisci callback
    await WebBrowser.dismissBrowser();
    if (!callbackUrl) throw new Error("Accesso annullato o nessun callback.");
    await handleOAuthCallback(callbackUrl);
  } catch (e) {
    console.error(`[${provider}] OAuth error`, e);
    throw e;
  } finally {
    sub?.remove?.();
  }
}

/** ------------------ COMPONENTE SCHERMATA LOGIN ------------------ **/

export default function LoginScreen({ navigation }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const signInWithEmail = async () => {
    if (!email || !password) {
      Alert.alert(t("auth.fillEmailPwd", "Compila tutti i campi"), t("auth.fillEmailPwd", "Email e password sono richiesti."));
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange penserà a portarti oltre la login
    } catch (err) {
      console.error("[EmailLogin] error:", err);
      Alert.alert(t("auth.loginFailed", "Login fallito"), err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async () => {
    if (!email || !password) {
      Alert.alert(t("auth.fillForSignup", "Compila tutti i campi"), t("auth.fillForSignup", "Email e password sono richiesti."));
      return;
    }
    if (password.length < 6) {
      Alert.alert(t("auth.passwordTooShortTitle", "Password troppo corta"), t("auth.passwordTooShortMsg", "Usa almeno 6 caratteri."));
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // Se la conferma email è disattivata, arriva già una sessione:
      // onAuthStateChange porta l'utente oltre la login.
      if (data?.session) return;
      // Altrimenti l'account è creato ma serve confermare via email.
      Alert.alert(t("auth.checkInbox", "Registrazione quasi completa"), t("auth.confirmLinkSent", "Ti abbiamo inviato un'email di conferma. Aprila per attivare l'account, poi torna qui e premi Accedi."));
    } catch (err) {
      console.error("[EmailSignup] error:", err);
      Alert.alert(t("auth.signupFailed", "Registrazione fallita"), err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const onPressGoogle = async () => {
    try {
      setLoading(true);
      await signInWithProviderOAuth("google");
    } catch (e) {
      console.error("[Google OAuth] error", e);
      Alert.alert("Google", e?.message ?? t("auth.oauthFailed", "Errore OAuth."));
    } finally {
      setLoading(false);
    }
  };

  const onPressFacebook = async () => {
    try {
      setLoading(true);
      await signInWithProviderOAuth("facebook");
    } catch (e) {
      console.error("[Facebook OAuth] error", e);
      Alert.alert("Facebook", e?.message ?? t("auth.oauthFailed", "Errore OAuth."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: theme.colors.background }}>
      <View style={{ alignItems: "center", marginTop: 40, marginBottom: 24 }}>
        <Text style={{ fontFamily: theme.fonts.headingExtraBold, fontSize: 28, color: theme.colors.text }}>
          {t("auth.welcomeTitle", "Benvenuto 👋")}
        </Text>
        <Text style={{ marginTop: 6, color: theme.colors.textMuted }}>
          {t("auth.welcomeSubtitle", "Accedi per continuare")}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <Input
          label={t("auth.email", "Email")}
          placeholder={t("auth.emailPlaceholder", "nome@dominio.it")}
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        <Input
          label={t("auth.password", "Password")}
          placeholder="••••••••"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Button title={t("auth.login", "Accedi")} onPress={signInWithEmail} loading={loading} />
        <Button title={t("auth.signup", "Registrati")} variant="outline" onPress={signUpWithEmail} loading={loading} />

        <View style={{ alignItems: "flex-end" }}>
          <TouchableOpacity onPress={() => navigation?.navigate?.("ForgotPassword")}>
            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
              {t("auth.forgot", "Password dimenticata?")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ marginVertical: 24, alignItems: "center" }}>
        <Text style={{ color: theme.colors.textMuted }}>{t("auth.or", "oppure")}</Text>
      </View>

      <View style={{ gap: 12 }}>
        <Button
          title={t("auth.continueGoogle", "Continua con Google")}
          variant="outline"
          leftIcon={<AntDesign name="google" size={18} />}
          onPress={onPressGoogle}
          loading={loading}
        />
        <Button
          title={t("auth.continueFacebook", "Continua con Facebook")}
          variant="outline"
          leftIcon={<AntDesign name="facebook-square" size={18} />}
          onPress={onPressFacebook}
          loading={loading}
        />
      </View>
    </View>
  );
}
