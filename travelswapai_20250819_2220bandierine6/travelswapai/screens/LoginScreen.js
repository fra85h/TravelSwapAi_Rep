import React, { useState } from "react";
import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { AntDesign } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";

WebBrowser.maybeCompleteAuthSession();
const getRedirectTo = () => `https://auth.expo.io/fra85h/travelswap`;

const makeRedirectUrlNative = () => {
  if (Platform.OS === "web") {
    const origin = window.location.origin;
    const url = `${origin}/auth/callback`;
    console.log("[OAuth][WEB] redirectTo:", url);
    return url;
  }
  const uri = makeRedirectUri({
    scheme: "travelswap",  // deve combaciare con app.json
    useProxy: true,        // proxy di Expo in dev/Expo Go
    path: "auth/callback",
  });
  console.log("[OAuth][NATIVE-PROXY] redirectTo:", uri);
  return uri;
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

    navigation.navigate("OAuthCallback"); // spinner

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,              // <-- PROXY fisso
        skipBrowserRedirect: false, // <-- lascia aprire Safari/Chrome a Supabase
        // queryParams: provider === "google" ? { access_type: "offline", prompt: "consent" } : undefined,
      },
    });
    if (error) throw error;
  } catch (err) {
    console.error("[OAuth] signInWithProvider error:", err);
    Alert.alert("Accesso social fallito", err?.message ?? String(err));
    if (navigation.canGoBack()) navigation.goBack();
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
