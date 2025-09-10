// lib/supabase.js
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://jkjjpgrnbnbaplbxzhgt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprampwZ3JuYm5iYXBsYnh6aGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NDU4MzMsImV4cCI6MjA3MDQyMTgzM30.1Exr_yxKrHBmCkK5HWKfCZpjju7Qn2I1Zx-3mGNYSAE"; // <-- la tua key

// Rileva se sei in web (Codespaces) o native
const isWeb = typeof window !== "undefined";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Su web: implicit + auto-parse dalla URL
    // Su native: PKCE + redirect con scheme
    flowType: isWeb ? "implicit" : "pkce",
    detectSessionInUrl: isWeb,      // <— IMPORTANTISSIMO per WEB (Codespaces)
    persistSession: true,
    autoRefreshToken: true,
    storage: isWeb ? undefined : AsyncStorage, // su web usa storage predefinito
  },
});
