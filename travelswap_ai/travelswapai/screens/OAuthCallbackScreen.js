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

    const hasAuthParams = (url) => {
      try {
        const parsed = Linking.parse(url);
        const qp = parsed?.queryParams || {};
        return !!(qp.code && (qp.code_verifier || qp.codeVerifier));
      } catch {
        return false;
      }
    };

    const tryExchange = async (url) => {
      if (!url) return false;
      console.log("[OAuthCallback] raw url:", url);

      if (!hasAuthParams(url)) {
        console.log("[OAuthCallback] URL senza ?code o code_verifier → skip");
        return false;
      }

      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) {
          console.log("[OAuthCallback] exchange error:", error.message || String(error));
          return false;
        }
        console.log("[OAuthCallback] session:", !!data?.session);
        return !!data?.session;
      } catch (e) {
        console.log("[OAuthCallback] exception:", e);
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

    (async () => {
      if (!isFocused) return;

      // 1) prova con l'URL di lancio
      const initialUrl = await Linking.getInitialURL();
      console.log("[OAuthCallback] initialUrl:", initialUrl);
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
