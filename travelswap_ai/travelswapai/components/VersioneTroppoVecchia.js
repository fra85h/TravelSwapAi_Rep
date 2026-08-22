// components/VersioneTroppoVecchia.js — la schermata che compare quando
// questa versione dell'app non è più servita dal server.
//
// Sta sopra al navigatore, non dentro una schermata: quando scatta non c'è
// niente di utile da fare dentro l'app, e lasciar navigare significherebbe
// far incontrare all'utente rifiuti che non sa spiegarsi.
//
// Quando NON scatta — cioè quasi sempre — questo componente non disegna
// niente e non costa niente: una fetch sola all'avvio, e se fallisce si va
// avanti come se nulla fosse (vedi lib/appVersion.mjs per il perché il
// dubbio si risolve sempre a favore del passaggio).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Constants from "expo-constants";
import { troppoVecchia } from "../lib/appVersion.mjs";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

export default function VersioneTroppoVecchia() {
  const { t } = useI18n();
  const [bloccata, setBloccata] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!API_BASE) return; // nessun server configurato: niente da chiedere
      try {
        // Timeout corto: questo controllo sta davanti all'app, e un server
        // lento non deve trasformarsi in un'app che non parte.
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 5000);
        const r = await fetch(`${API_BASE}/api/app-version`, { signal: stop.signal });
        clearTimeout(timer);
        if (!r.ok) return;
        const { minVersion } = await r.json();
        const mia = Constants.expoConfig?.version;
        if (vivo && troppoVecchia(mia, minVersion)) setBloccata(true);
      } catch {
        // Rete assente, server giù, risposta strana: si passa. Bloccare per
        // un problema NOSTRO sarebbe il peggiore dei due errori possibili.
      }
    })();
    return () => { vivo = false; };
  }, []);

  if (!bloccata) return null;

  return (
    <View style={s.tutto}>
      <Text style={s.titolo}>{t("appVersion.title", "Questa versione non è più aggiornata")}</Text>
      <Text style={s.testo}>
        {t(
          "appVersion.body",
          "Alcune cose sono cambiate e questa versione dell'app non riesce più a starci dietro: continuare porterebbe solo a errori difficili da capire. Aggiornala dallo store e ritrovi tutto dov'era."
        )}
      </Text>
      <Text style={s.nota}>
        {t("appVersion.current", "Versione installata: {v}", { v: Constants.expoConfig?.version || "—" })}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  // position absolute e non un ramo del render: copre tutto senza che App.js
  // debba cambiare la propria struttura per fare spazio a un caso che nella
  // vita normale dell'app non si presenta mai.
  tutto: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999, elevation: 9999,
    backgroundColor: theme.colors.background,
    alignItems: "center", justifyContent: "center", padding: 28,
  },
  titolo: {
    fontFamily: theme.fonts.headingExtraBold, fontSize: 22,
    color: theme.colors.text, textAlign: "center", marginBottom: 12,
  },
  testo: {
    fontSize: 15, lineHeight: 22, color: theme.colors.text,
    textAlign: "center", marginBottom: 20,
  },
  nota: { fontSize: 13, color: theme.colors.textMuted, textAlign: "center" },
});
