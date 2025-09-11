import React, { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import * as ExpoLinking from "expo-linking";
import { AntDesign } from "@expo/vector-icons";

import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { supabase } from "../lib/supabase";
import * as Linking from "expo-linking"; // <-- expo-linking

// Completa eventuali sessioni pendenti (obbligatorio per iOS)
WebBrowser.maybeCompleteAuthSession();
const REDIRECT_TO = 'https://auth.expo.io/@fra85h/travelswap'; // <-- fisso

// Redirect per Expo Go (proxy). Deve essere whitelisted in Supabase.
const getRedirectTo = () => {
  const url = makeRedirectUri({ useProxy: true }); // niente path
  console.log("[OAuth] redirectTo =", url);
  return url;
};

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
      // onAuthStateChange penserà a portarti fuori dalla login
    } catch (err) {
      console.error("[EmailLogin] error:", err);
      Alert.alert("Login fallito", err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const REDIRECT_TO = "https://auth.expo.io/@fra85h/travelswap";

const signInWithProvider = async (provider) => {
  try {
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: REDIRECT_TO,      // deve combaciare con Supabase
        skipBrowserRedirect: true,
        flowType: "pkce",
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("OAuth URL mancante.");

    const res = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
    if (res.type !== "success" || !res.url) {
      if (res.type === "cancel") return;
      throw new Error("OAuth non completato.");
    }

    // 1) prova PKCE (?code=...)
    const parsed = Linking.parse(res.url);
    let code = parsed?.queryParams?.code;
    if (code) {
      const { error: exchErr } = await supabase.auth.exchangeCodeForSession({ authCode: code });
      if (exchErr) throw exchErr;
      return;
    }

    // 2) fallback implicit flow (#access_token=...)
    if (typeof parsed?.fragment === "string") {
      const params = new URLSearchParams(parsed.fragment);
      const token = params.get("access_token");
      if (token) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: token,
          refresh_token: null,
        });
        if (sessErr) throw sessErr;
        return;
      }
    }

    throw new Error("Nessun code né access_token nel redirect.");
  } catch (e) {
    console.error("[OAuth] error:", e);
    Alert.alert("Accesso social fallito", e?.message ?? "Errore OAuth.");
  } finally {
    try { await WebBrowser.dismissBrowser(); } catch {}
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
          <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")}>
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
          onPress={() => signInWithProvider("google")}
          loading={loading}
        />
        <Button
          title="Continua con Facebook"
          variant="outline"
          leftIcon={<AntDesign name="facebook-square" size={18} />}
          onPress={() => signInWithProvider("facebook")}
          loading={loading}
        />
      </View>
    </View>
  );
}
