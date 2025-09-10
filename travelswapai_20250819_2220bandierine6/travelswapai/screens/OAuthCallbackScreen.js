import React, { useEffect, useCallback, useState } from "react";
import { View, Text, ActivityIndicator, Alert } from "react-native";
import { theme } from "../lib/theme";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export default function OAuthCallbackScreen({ navigation }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  const tryFinish = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
  }, [navigation]);

  const tryExchange = useCallback(async (url) => {
    if (!url || busy) return;
    const { queryParams } = Linking.parse(url);
    const code = queryParams?.code;
    const error = queryParams?.error;
    const error_description = queryParams?.error_description;

    // Fallback: in alcuni casi Supabase potrebbe rimandare direttamente i token
    const access_token = queryParams?.access_token;
    const refresh_token = queryParams?.refresh_token;

    if (error) {
      Alert.alert("Accesso annullato", error_description || String(error));
      navigation.goBack();
      return;
    }

    try {
      setBusy(true);
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) throw exErr;
        tryFinish();
        return;
      }
      if (access_token && refresh_token) {
        const { error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
        if (sessErr) throw sessErr;
        tryFinish();
        return;
      }

      // Se siamo arrivati qui senza code né token, attendiamo eventuale evento successivo
    } catch (e) {
      Alert.alert("Errore accesso", e.message ?? String(e));
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  }, [busy, navigation, tryFinish]);

  useEffect(() => {
    // Caso in cui l’app sia stata aperta dal deep link
    Linking.getInitialURL().then(tryExchange).catch(() => {});
    // E anche se arriva dopo
    const sub = Linking.addEventListener("url", ({ url }) => tryExchange(url));
    return () => sub.remove();
  }, [tryExchange]);

  useEffect(() => {
    // Se per qualche motivo la sessione è già pronta (es. web), entriamo
    if (session && !busy) {
      tryFinish();
    }
  }, [session, busy, tryFinish]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: theme.colors.background }}>
      <ActivityIndicator size="large" />
      <Text style={{ marginTop: 16, color: theme.colors.muted, textAlign: "center" }}>
        Accesso in corso… se non si chiude automaticamente, torna all’app.
      </Text>
    </View>
  );
}
