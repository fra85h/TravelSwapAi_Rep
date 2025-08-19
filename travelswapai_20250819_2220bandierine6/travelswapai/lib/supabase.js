
// Polyfill già caricati da ./lib/polyfills (importati in App.js)
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from '@react-native-async-storage/async-storage';
// ✅ Snack-dev: metti qui le tue chiavi (niente throw, nessuna lettura da extra)
const SUPABASE_URL = "https://jkjjpgrnbnbaplbxzhgt.supabase.co";   // <-- la tua URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprampwZ3JuYm5iYXBsYnh6aGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NDU4MzMsImV4cCI6MjA3MDQyMTgzM30.1Exr_yxKrHBmCkK5HWKfCZpjju7Qn2I1Zx-3mGNYSAE"; // <-- la tua key
const isWeb = typeof window !== "undefined";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
auth: {    
    persistSession: true,
    autoRefreshToken: true,
    storage: AsyncStorage ,
    autoRefreshToken: true,
    detectSessionInUrl: isWeb,
  },
});


