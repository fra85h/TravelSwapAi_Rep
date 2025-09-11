import React, { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { AntDesign } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";

WebBrowser.maybeCompleteAuthSession();

// Redirect con proxy Expo (coerente con app.json -> scheme "travelswap")
const getRedirectTo = () =>
  makeRedirectUri({
    scheme: "travelswap",
    useProxy: true,
    path: "auth/callback",
  });

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
    } catch (err) {
      console.error("[EmailLogin] error:", err);
      Alert.alert("Login fallito", err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const signInWithProvider = async (provider) => {
  try {
    setLoading(true);
    const redirectTo = getRedirectTo();

    console.log(`[OAuth] start ${provider} with redirectTo:`, redirectTo);

    // 1) Chiedo a Supabase l'URL di autorizzazione, senza redirect automatico
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true, // <<< IMPORTANTE: apriamo noi la sessione
        // queryParams: provider === "google" ? { access_type: "offline", prompt: "consent" } : undefined,
      },
    });
    if (error) throw error;

    // 2) Apro una auth session e attendo l'URL finale di callback (con ?code=…)
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    // res = { type: 'success'|'cancel'|'dismiss', url?: '...'}
    if (res.type !== "success" || !res.url) {
      if (res.type !== "dismiss" && res.type !== "cancel") {
        Alert.alert("Accesso social", "Operazione annullata.");
      }
      return;
    }

    // 3) Scambio codice ↔ sessione SUPABASE
    const { error: exchErr } = await supabase.auth.exchangeCodeForSession(res.url);
    if (exchErr) throw exchErr;

    // 4) A questo punto la sessione è attiva (onAuthStateChange scatterà)
    // Se vuoi, puoi anche navigare subito:
    // navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });

  } catch (err) {
    console.error("[OAuth] signInWithProvider error:", err);
    Alert.alert("Accesso social fallito", err?.message ?? String(err));
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
