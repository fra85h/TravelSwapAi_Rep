import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

const Ctx = createContext({ session: null, loading: true });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s ?? null);
      console.log("[AuthState] INITIAL_SESSION", !!s, s?.user?.id);
      const sub = supabase.auth.onAuthStateChange((event, newSession) => {
        console.log("[AuthState][onChange]", event, !!newSession, newSession?.user?.id);
        setSession(newSession ?? null);
      });
      unsubscribe = () => sub?.data?.subscription?.unsubscribe?.();
      setLoading(false);
    })();
    return () => unsubscribe();
  }, []);

  return <Ctx.Provider value={{ session, loading }}>{children}</Ctx.Provider>;
}
