// lib/auth.js
import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
  },
});

const Ctx = createContext({ session: null, loading: true });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // prima lettura
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setLoading(false);
      console.log("[AuthState][init]", !!data.session);
    })();
  }, []);

  // listener cambi stato (fondamentale per OAuth)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[AuthState]", event, !!session, session?.user?.email);
      setSession(session ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={{ session, loading }}>{children}</Ctx.Provider>;
}
