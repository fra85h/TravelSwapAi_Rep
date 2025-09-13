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

WebBrowser.maybeCompleteAuthSession();

// Redirect per Expo Go (DEVE combaciare con Supabase)
const REDIRECT_TO = "https://auth.expo.io/@fra85h/travelswap";


/** --------- HELPERS OAUTH COMUNI (fuori dal componente) --------- **/

async function handleOAuthCallback(returnUrl) {
  console.log("[OAuth] callback url =", returnUrl);
  const parsed = Linking.parse(returnUrl);

  // A) PKCE: ?code=...
  const code = parsed?.queryParams?.code;
  if (code) {
    console.log("[OAuth] exchanging code...");
    const { error } = await supabase.auth.exchangeCodeForSession({ authCode: code });
    if (error) {
      console.log("[OAuth] exchange error", error);
      throw error;
    }
    console.log("[OAuth] exchange OK");
    return;
  }

  // B) Implicit fallback: #access_token=...
  if (typeof parsed?.fragment === "string") {
    const token = new URLSearchParams(parsed.fragment).get("access_token");
    if (token) {
      console.log("[OAuth] setSession fallback...");
      const { error } = await supabase.auth.setSession({
        access_token: token,
        refresh_token: null,
      });
      if (error) {
        console.log("[OAuth] setSession error", error);
        throw error;
      }
      return;
    }
  }

  throw new Error("Né code né access_token nel redirect.");
}
async function testBridge() {
  try {
    const REDIRECT_TO = "https://auth.expo.io/@fra85h/travelswap";
    // La funzione openAuthSessionAsync gestisce l'intero processo.
    // Il risultato viene restituito direttamente in una variabile.
    const result = await WebBrowser.openAuthSessionAsync(
      `${REDIRECT_TO}?ping=1`, // Questo è l'URL di autenticazione
      'http://pq0evwy-fra85h-8081.exp.direct' // Questo è il tuo URL di reindirizzamento
    );

    if (result.type === 'success' && result.url) {
      console.log('Autenticazione riuscita! URL di callback:', result.url);
      // Puoi usare l'URL qui per completare il login con il tuo provider.
    } else {
      console.log('Autenticazione fallita o annullata:', result.type);
    }
  } catch (error) {
    console.error('Si è verificato un errore durante l\'autenticazione:', error);
  }
}
export async function signInWithProviderOAuth(provider) {
  let sub;
  try {
    console.log(`[${provider}] start OAuth`);
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
    console.log(`[${provider}] auth url =`, data.url);

    // 1) Prepara listener (una sola volta)
    const urlPromise = new Promise((resolve) => {
      sub = Linking.addEventListener("url", ({ url }) => resolve(url));
    });

    // 2) Apri browser "pieno"
    await WebBrowser.openBrowserAsync(data.url);

    // 3) Attendi callback da auth.expo.io → deep link alla tua app
    const callbackUrl = await urlPromise;
    console.log(`[${provider}] callback (Linking) =`, callbackUrl);

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const signInWithEmail = async () => {
    if (!email || !password) {
      Alert.alert("Compila tutti i campi", "Email e password sono richiesti.");
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange penserà a portarti oltre la login
    } catch (err) {
      console.error("[EmailLogin] error:", err);
      Alert.alert("Login fallito", err?.message ?? String(err));
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
      Alert.alert("Google", e?.message ?? "Errore OAuth.");
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
      Alert.alert("Facebook", e?.message ?? "Errore OAuth.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: theme.colors.background }}>
      <View style={{ alignItems: "center", marginTop: 40, marginBottom: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: theme.colors.text }}>
          Benvenuto 👋
        </Text>
        <Text style={{ marginTop: 6, color: theme.colors.muted }}>
          Accedi per continuare
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <Input
          label="Email"
          placeholder="nome@dominio.it"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        <Input
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Button title="Accedi" onPress={signInWithEmail} loading={loading} />

        <View style={{ alignItems: "flex-end" }}>
          <TouchableOpacity onPress={() => navigation?.navigate?.("ForgotPassword")}>
            <Text style={{ color: theme.colors.link, fontWeight: "600" }}>
              Password dimenticata?
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ marginVertical: 24, alignItems: "center" }}>
        <Text style={{ color: theme.colors.muted }}>oppure</Text>
      </View>

      <View style={{ gap: 12 }}>
        <Button
          title="Continua con Google"
          variant="outline"
          leftIcon={<AntDesign name="google" size={18} />}
          onPress={onPressGoogle}
          loading={loading}
        />
        <Button
          title="Continua con Facebook"
          variant="outline"
          leftIcon={<AntDesign name="facebook-square" size={18} />}
          onPress={onPressFacebook}
          loading={loading}
        />
        <Button title="Test bridge" variant="outline" onPress={testBridge} />

      </View>
    </View>
  );
}
