import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

// Metti questi in .env o in app.json->extra se vuoi
const WEB_CLIENT_ID = '809480402787-qp9v6sae289vthuhumcvoge1kkc1d981.apps.googleusercontent.com';
const IOS_CLIENT_ID = '809480402787-qrb480p1o96siams44c6vrujoi6mbkae.apps.googleusercontent.com';
const ANDROID_CLIENT_ID = '<ANDROID_CLIENT_ID facoltativo>';

export function configureGoogle() {
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,        // obbligatorio per avere idToken valido
    iosClientId: IOS_CLIENT_ID,        // opzionale ma consigliato
    offlineAccess: false,              // non serve refresh token per Supabase
    forceCodeForRefreshToken: false,
    profileImageSize: 120,
  });
}

export async function signInWithGoogleNative() {
  // facoltativo su Android, controlla i Play Services
  try { await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }); } catch {}
  
  // apre il picker nativo / account
  const userInfo = await GoogleSignin.signIn();
  const idToken = userInfo?.idToken;
  if (!idToken) throw new Error('Google non ha restituito un idToken');

  // Login su Supabase con ID TOKEN Google (OIDC)
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return data;
}
