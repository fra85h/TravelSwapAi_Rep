// components/QrScanner.js — lo scanner QR su iOS e Android.
//
// Qui è expo-camera, che sul nativo fa tutto lui: la decodifica avviene nel
// codice nativo della piattaforma, senza scaricare niente da nessuna parte.
//
// Sul WEB no, ed è il motivo per cui esiste QrScanner.web.js accanto a
// questo file: lì expo-camera costruisce un Worker che fa
//   importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js')
// cioè scarica a runtime, da un dominio di terzi, il codice che legge il
// biglietto. Se quel download è bloccato — succede con i blocchi pubblicità,
// nelle reti aziendali, o con qualunque Content-Security-Policy — il worker
// muore e la promise di decodifica non si risolve né si rifiuta: la
// fotocamera resta aperta e non legge mai niente, per sempre, in silenzio.
//
// Metro sceglie da solo il file .web.js quando compila per il browser: da
// qui in poi chi usa <QrScanner /> non deve sapere niente di tutto questo.
import React from "react";
import { CameraView, useCameraPermissions } from "expo-camera";

const TIPI = ["qr", "ean13", "ean8", "code128", "code39", "pdf417", "upc_a", "upc_e"];

/**
 * @param {(data: string) => void} onScanned  chiamato col contenuto del codice
 * @param {boolean} [paused]  ferma le letture senza smontare la fotocamera
 * @param {object} [style]
 */
export default function QrScanner({ onScanned, paused = false, style }) {
  return (
    <CameraView
      style={style || { flex: 1 }}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: TIPI }}
      onBarcodeScanned={paused ? undefined : ({ data }) => onScanned?.(data)}
    />
  );
}

/**
 * Il permesso fotocamera, chiesto come vuole la piattaforma.
 *
 * Sta qui e non nella schermata perché è l'unico modo di tenere expo-camera
 * FUORI dal bundle web: importarlo, anche solo per questo hook, basta a far
 * eseguire il modulo che crea il Worker col CDN. La versione web di questo
 * file restituisce un permesso già concesso, perché nel browser è
 * getUserMedia stesso a chiederlo al momento giusto.
 */
export function useQrPermission() {
  return useCameraPermissions();
}
