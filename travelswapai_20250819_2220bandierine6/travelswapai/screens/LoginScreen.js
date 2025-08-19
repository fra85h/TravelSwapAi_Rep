// screens/LoginScreen.js
import React, { useEffect, useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { supabase } from "../lib/supabase";
import { useI18n } from "../lib/i18n";
 import LanguageSwitcher from "../screens/LanguageSwitcher"; // 🇮🇹🇬🇧🇪🇸
// Necessario per chiudere la webview OAuth su Expo
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen({ navigation }) {
  const { t } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect “robusto”:
  // - Web: l'origin reale della pagina aperta in "Open in new window"
  // - Native: schema + path stabile
  // Candidati redirect
  const proxyTry = AuthSession.makeRedirectUri({ useProxy: true, path: "auth-callback" });

  function getRedirectTo() {
    if (Platform.OS === "web") {
      // Mai accedere direttamente a window senza guard
      if (typeof window !== "undefined" && window?.location?.origin) {
        return window.location.origin; // oppure AuthSession.makeRedirectUri({ useProxy: true })
      }
      return ""; // fallback
    }
    // Native (iOS/Android): usa lo schema dell'app
    return AuthSession.makeRedirectUri({ scheme: "travelswapai", path: "auth-callback" });
  }

  //const redirectTo = getRedirectTo();
  const redirectTo =
    Platform.OS === "web"
      ? AuthSession.makeRedirectUri({ useProxy: true }) // <-- proxy Expo
      : AuthSession.makeRedirectUri({ scheme: "travelswapai", path: "auth-callback" });

  // iOS/Android: naviga subito quando Supabase emette la sessione dopo OAuth
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigation.replace("MainTabs");
    });
    return () => sub.subscription?.unsubscribe?.();
  }, [navigation]);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert(t("error", "Errore"), t("auth.fillEmailPwd", "Inserisci email e password"));
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigation.replace("MainTabs");
    } catch (e) {
      Alert.alert(t("auth.loginFailed", "Login fallito"), e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    if (!email || !password) {
      Alert.alert(t("error", "Errore"), t("auth.fillForSignup", "Inserisci email e password per registrarti"));
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      Alert.alert(t("auth.checkInbox", "Controlla la posta"), t("auth.confirmLinkSent", "Ti abbiamo inviato un link di conferma."));
    } catch (e) {
      Alert.alert(t("auth.signupFailed", "Registrazione fallita"), e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!email) {
      Alert.alert(t("auth.needEmail", "Serve l'email"), t("auth.enterEmailForReset", "Inserisci la tua email per ricevere il link di reset."));
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      Alert.alert(t("auth.emailSent", "Email inviata"), t("auth.checkResetLink", "Controlla la tua casella per il link di reset."));
    } catch (e) {
      Alert.alert(t("auth.resetError", "Errore reset"), e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider) {
    try {
      setLoading(true);
      // 👉 su Web NON usare skipBrowserRedirect quando usi il proxy:
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo }, // su Web: proxy Expo
      });
      if (error) throw error;
      // Web: redirect → provider → ritorno; Native: rientra via scheme; onAuthStateChange gestisce la nav
    } catch (e) {
      setLoading(false);
      Alert.alert(t("auth.oauthFailed", "OAuth fallito"), e.message ?? String(e));
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#fff" }}>
      {/* 🌍 Bandierine in alto a destra */}
      <View style={{ position: "absolute", top: 12, right: 16 }}>
        <LanguageSwitcher />
      </View>

      <Text style={{ fontSize: 26, fontWeight: "700", marginBottom: 16 }}>
        {t('auth.login')}
      </Text>

      <TextInput
        placeholder={t("auth.email", "Email")}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, marginBottom: 12 }}
      />

      <TextInput
        placeholder={t("auth.password", "Password")}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, marginBottom: 12 }}
      />

      <TouchableOpacity
        onPress={handleLogin}
        disabled={loading}
        style={{
          backgroundColor: "#111827",
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ color: "#fff", textAlign: "center", fontWeight: "bold" }}>
            {t("auth.login", "Accedi")}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleResetPassword} disabled={loading} style={{ marginTop: 12 }}>
        <Text style={{ textAlign: "center", color: "#555", textDecorationLine: "underline" }}>
          {t("auth.forgot", "Password dimenticata?")}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 24 }} />

      <TouchableOpacity
        onPress={() => handleOAuth("google")}
        disabled={loading}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          marginBottom: 12,
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Text style={{ textAlign: "center", fontWeight: "600" }}>
          {t("auth.continueGoogle", "Continua con Google")}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => handleOAuth("facebook")}
        disabled={loading}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Text style={{ textAlign: "center", fontWeight: "600" }}>
          {t("auth.continueFacebook", "Continua con Facebook")}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 12 }} />

      <TouchableOpacity onPress={handleSignUp} disabled={loading}>
        <Text style={{ textAlign: "center", color: "#111827", fontWeight: "700" }}>
          {t("auth.createAccount", "Crea un nuovo account")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
