// lib/preferences.js — onboarding con preferenze (D4)
// Riusa la colonna profiles.prefs già esistente e già letta dal matcher
// euristico lato server (server/src/ai/score.js: prefs.types/maxPrice/
// location) — nessuna modifica DB necessaria, solo la UI per popolarla.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export async function getMyPrefs() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("prefs")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.log("[getMyPrefs]", error.message);
    return null;
  }
  return data?.prefs ?? {};
}

export async function saveMyPrefs(prefs) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, prefs: { ...prefs, onboarded: true } }, { onConflict: "id" });
  if (error) throw error;
}

export async function skipPrefsOnboarding() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, prefs: { onboarded: true } }, { onConflict: "id" });
  if (error) console.log("[skipPrefsOnboarding]", error.message);
}

/**
 * true finché l'utente loggato non ha mai salvato né saltato le
 * preferenze (prefs.onboarded assente) — una volta sola per account,
 * non ad ogni avvio.
 */
export function useNeedsPreferencesOnboarding(session) {
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const check = useCallback(async () => {
    if (!session) {
      setLoading(false);
      setNeedsOnboarding(false);
      return;
    }
    setLoading(true);
    try {
      const prefs = await getMyPrefs();
      setNeedsOnboarding(!!prefs && !prefs.onboarded);
    } catch {
      setNeedsOnboarding(false);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => { check(); }, [check]);

  const markDone = useCallback(() => setNeedsOnboarding(false), []);

  return { loading, needsOnboarding, markDone };
}
