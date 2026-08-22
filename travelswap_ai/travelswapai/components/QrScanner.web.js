// components/QrScanner.web.js — lo scanner QR nel browser, senza CDN.
//
// Perché non expo-camera qui: sul web costruisce un Worker che fa
//   importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js')
// cioè scarica a runtime, da un dominio che non controlliamo, il codice che
// legge il biglietto dei nostri utenti. Tre problemi, in ordine di gravità:
//
//   1. è codice di terzi eseguito nel browser di chi usa l'app, senza alcun
//      controllo di integrità, su una schermata dove si digitano codici di
//      prenotazione;
//   2. fallisce per una popolazione prevedibile — blocchi pubblicità (jsdelivr
//      è in diverse blocklist), reti aziendali e scolastiche — e fallirà
//      sempre il giorno in cui metteremo una Content-Security-Policy;
//   3. quando fallisce, fallisce nel modo peggiore: expo-camera non installa
//      nessun worker.onerror, quindi la promise di decodifica non si risolve
//      NÉ si rifiuta. La fotocamera resta aperta e non legge mai niente, per
//      sempre, senza un messaggio. È così che ce ne siamo accorti, da un
//      errore non catturato arrivato al monitoraggio.
//
// Qui jsQR sta dentro il bundle (dipendenza npm), quindi non c'è niente da
// scaricare e niente che possa essere bloccato.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import jsQR from "jsqr";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

// Ogni quanto guardare un fotogramma. 250ms sono quattro letture al secondo:
// più che sufficienti per un codice fermo davanti all'obiettivo, e molto meno
// esose di un requestAnimationFrame che ne farebbe sessanta bruciando batteria
// per leggere sessanta volte lo stesso quadrato.
const INTERVALLO_MS = 250;
// Oltre questa dimensione non si guadagna precisione, si spende solo tempo.
const LATO_MAX = 640;

export default function QrScanner({ onScanned, paused = false, style }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const pausedRef = useRef(paused);
  const scanRef = useRef(null);
  const [errore, setErrore] = useState(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  // Il gestore vive dentro un timer: leggerlo da un ref evita di riavviare la
  // fotocamera ogni volta che chi ci usa ridisegna.
  const onScannedRef = useRef(onScanned);
  useEffect(() => { onScannedRef.current = onScanned; }, [onScanned]);

  const leggiFotogramma = useCallback(() => {
    if (pausedRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== 4) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    const scala = Math.min(1, LATO_MAX / Math.max(w, h));
    const cw = Math.round(w * scala);
    const ch = Math.round(h * scala);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, cw, ch);

    let dati;
    try {
      dati = ctx.getImageData(0, 0, cw, ch);
    } catch {
      // Alcuni browser bloccano getImageData in contesti particolari: meglio
      // saltare il fotogramma che far cadere tutta la schermata.
      return;
    }

    // "attemptBoth": prova anche il codice in negativo. I biglietti stampati
    // male o fotografati da uno schermo capitano spesso invertiti.
    const esito = jsQR(dati.data, cw, ch, { inversionAttempts: "attemptBoth" });
    if (esito?.data) onScannedRef.current?.(esito.data);
  }, []);

  useEffect(() => {
    let vivo = true;

    (async () => {
      const media = globalThis?.navigator?.mediaDevices;
      if (!media?.getUserMedia) {
        // Due cause diverse che si presentano identiche: getUserMedia manca
        // sia sui browser troppo vecchi sia — molto più spesso — quando la
        // pagina non è servita in HTTPS, perché la fotocamera esiste solo in
        // un contesto sicuro. Dirle allo stesso modo significa accusare il
        // browser di chi legge di essere vecchio quando il browser va
        // benissimo ed è il nostro indirizzo a non avere il lucchetto: uno se
        // ne va a cercare un aggiornamento che non gli serve.
        //
        // isSecureContext è vero su https e su localhost, falso su http: è
        // esattamente la condizione che decide se la fotocamera esisterà.
        const sicuro = globalThis?.isSecureContext !== false;
        setErrore(sicuro ? "unsupported" : "insecure");
        return;
      }
      try {
        // "environment" = fotocamera posteriore dove c'è; sui portatili non
        // esiste e il browser dà quella che ha, che va benissimo.
        const stream = await media.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!vivo) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // playsInline: senza, iOS apre il video a tutto schermo e la
          // schermata di scansione sparisce sotto il player di sistema.
          video.setAttribute("playsinline", "true");
          video.muted = true;
          await video.play().catch(() => {});
        }
        scanRef.current = setInterval(leggiFotogramma, INTERVALLO_MS);
      } catch (e) {
        if (!vivo) return;
        const nome = String(e?.name || "");
        setErrore(nome === "NotAllowedError" || nome === "SecurityError" ? "denied" : "generic");
      }
    })();

    return () => {
      vivo = false;
      if (scanRef.current) clearInterval(scanRef.current);
      // Spegnere le tracce non è facoltativo: senza, la spia della fotocamera
      // resta accesa dopo che la schermata è stata chiusa.
      streamRef.current?.getTracks?.().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [leggiFotogramma]);

  if (errore) {
    return (
      <View style={[s.centro, style]}>
        <Text style={s.testoErrore}>
          {errore === "denied"
            ? t("qrScanner.denied", "Non ho accesso alla fotocamera. Puoi consentirlo dalle impostazioni del browser, oppure scrivere il codice a mano.")
            : errore === "insecure"
            ? t("qrScanner.insecure", "Da questo indirizzo la fotocamera non è disponibile: serve una connessione sicura (https). Scrivi il codice a mano.")
            : errore === "unsupported"
            ? t("qrScanner.unsupported", "Questo browser non permette di usare la fotocamera. Scrivi il codice a mano.")
            : t("qrScanner.generic", "Non riesco ad aprire la fotocamera. Scrivi il codice a mano.")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, overflow: "hidden" }, style]}>
      {/* Elementi DOM veri: su react-native-web si possono usare direttamente,
          ed è l'unico modo per avere un <video> con uno stream. */}
      {React.createElement("video", {
        ref: videoRef,
        autoPlay: true,
        muted: true,
        playsInline: true,
        style: { width: "100%", height: "100%", objectFit: "cover" },
      })}
      {React.createElement("canvas", { ref: canvasRef, style: { display: "none" } })}
    </View>
  );
}

const s = StyleSheet.create({
  centro: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: theme.colors.surfaceMuted },
  testoErrore: { textAlign: "center", color: theme.colors.text, fontSize: 13, lineHeight: 18 },
});

/**
 * Nel browser non esiste un permesso da chiedere in anticipo: è getUserMedia
 * a farlo comparire, nel momento in cui la fotocamera serve davvero. Si
 * risponde quindi "concesso" e si lascia che sia lo scanner a gestire il
 * rifiuto, che sa anche dire cosa fare invece (scrivere il codice a mano).
 *
 * Stessa firma di useCameraPermissions, così chi la usa non deve sapere su
 * quale piattaforma sta girando.
 */
export function useQrPermission() {
  return [{ granted: true }, async () => ({ granted: true })];
}
