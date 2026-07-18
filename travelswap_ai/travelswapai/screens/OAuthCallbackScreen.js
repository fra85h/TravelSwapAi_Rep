// screens/OAuthCallbackScreen.js
import React, { useEffect, useRef } from "react";
import { View, ActivityIndicator } from "react-native";
import * as Linking from "expo-linking";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";

export default function OAuthCallbackScreen({ navigation }) {
  const isFocused = useIsFocused();
  const finishedRef = useRef(false);

  useEffect(() => {
    let alive = true;

    // In un flusso PKCE il code_verifier NON arriva mai nell'URL di
    // callback (resta solo lato client, nello storage locale: è l'intero
    // scopo di PKCE) — richiederlo qui faceva sì che questa funzione
    // scartasse ogni callback OAuth reale, che porta solo "code".
    const extractCode = (url) => {
      try {
        const parsed = Linking.parse(url);
        return parsed?.queryParams?.code || null;
      } catch {
        return null;
      }
    };

    const tryExchange = async (url) => {
      if (!url) return false;
      // url contiene il code PKCE: lo logghiamo solo in dev
      if (__DEV__) console.log("[OAuthCallback] raw url:", url);

      const code = extractCode(url);
      if (!code) return false;

      try {
        // exchangeCodeForSession(authCode: string) vuole il codice nudo,
        // non l'URL intero: passare url corrompeva la richiesta al server
        // (auth_code diventava l'URL, non il codice).
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[OAuthCallback] exchange error:", error.message || String(error));
          return false;
        }
        return !!data?.session;
      } catch (e) {
        console.error("[OAuthCallback] exception:", e);
        return false;
      }
    };

    const finishIfSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session && !finishedRef.current) {
        finishedRef.current = true;
        if (!alive) return true;
        navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
        return true;
      }
      return false;
    };

    // Sul web, gli screen non mappati in App.js linking.config.screens
    // (Login, Profile, MainTabs, ...) non aggiornano la barra indirizzi:
    // se restasse su /auth/callback, un cambio di sessione successivo
    // (che smonta e ricrea lo Stack.Navigator) potrebbe rileggere quell'URL
    // rimasto fermo. Va ripulita SEMPRE al mount di questo screen, non solo
    // quando arriva un url reale: se si arriva qui per il riaggancio
    // dell'URL vecchio, Linking.getInitialURL() qui sotto torna null.
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", "/");
    }

    (async () => {
      if (!isFocused) return;

      // 1) prova con l'URL di lancio
      const initialUrl = await Linking.getInitialURL();
      if (await tryExchange(initialUrl)) {
        if (await finishIfSession()) return;
      }

      // 2) ascolta eventuali eventi successivi
      const sub = Linking.addEventListener("url", async ({ url }) => {
        if (finishedRef.current) return;
        if (await tryExchange(url)) {
          await finishIfSession();
        }
      });

      // 3) fallback: polling breve della sessione
      for (let i = 0; i < 30; i++) {
        if (await finishIfSession()) {
          sub.remove();
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      sub.remove();
      // timeout → torna alla login
      if (navigation.canGoBack()) navigation.goBack();
    })();

    return () => {
      alive = false;
    };
  }, [isFocused, navigation]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background }}>
      <ActivityIndicator />
    </View>
  );
}
