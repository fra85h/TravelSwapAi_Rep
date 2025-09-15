// lib/supabase.js
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

//const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://jkjjpgrnbnbaplbxzhgt.supabase.co";
//const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprampwZ3JuYm5iYXBsYnh6aGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NDU4MzMsImV4cCI6MjA3MDQyMTgzM30.1Exr_yxKrHBmCkK5HWKfCZpjju7Qn2I1Zx-3mGNYSAE"; // <-- la tua key

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;


const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://jkjjpgrnbnbaplbxzhgt.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprampwZ3JuYm5iYXBsYnh6aGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NDU4MzMsImV4cCI6MjA3MDQyMTgzM30.1Exr_yxKrHBmCkK5HWKfCZpjju7Qn2I1Zx-3mGNYSAE"; // tua key

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("[Supabase] Variabili mancanti: controlla EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY");
}



export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // RN: sempre false
  },
});