// lib/pushRegistration.js — registrazione del token push NATIVO.
//
// STATO: predisposto ma DORMIENTE. Il push del telefono richiede un dev build
// nativo con la dipendenza `expo-notifications` (oggi NON installata): sul web
// il push remoto non esiste e in Expo Go non è più supportato. Finché non c'è
// quel build questa funzione è un no-op sicuro e non tocca il bundle web.
//
// Per ACCENDERE il push, quando farai il dev build:
//   1) npx expo install expo-notifications expo-device
//   2) qui sotto: richiedi il permesso, ottieni l'Expo push token e salvalo
//      nella tabella `push_tokens` (già pronta lato DB):
//        upsert { user_id, token, platform } con onConflict user_id,token
//   3) il server invia già i push leggendo quella tabella
//      (server/src/lib/push.js). Nessun'altra modifica necessaria.
import { Platform } from "react-native";

export async function registerForPushNotifications() {
  // Sul web (e finché manca il build nativo) non c'è nulla da registrare.
  if (Platform.OS === "web") return null;
  // TODO(dev build): sbloccare quando `expo-notifications` è installata.
  //   const Notifications = require("expo-notifications");
  //   const Device = require("expo-device");
  //   if (!Device.isDevice) return null;
  //   const { status } = await Notifications.requestPermissionsAsync();
  //   if (status !== "granted") return null;
  //   const token = (await Notifications.getExpoPushTokenAsync()).data;
  //   await supabase.from("push_tokens").upsert(
  //     { user_id, token, platform: Platform.OS },
  //     { onConflict: "user_id,token" }
  //   );
  return null;
}
