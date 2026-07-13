// lib/webAlert.js — su web Alert.alert di React Native è un no-op: ogni
// errore ("Login fallito"), conferma ("Rifiuta lo scambio?") e avviso
// dell'app sparirebbe nel nulla. Questo shim, importato una volta in
// App.js, rimappa Alert.alert sui dialoghi nativi del browser. Su
// iOS/Android non fa niente: la versione nativa resta com'era.
import { Alert, Platform } from "react-native";

if (Platform.OS === "web" && typeof window !== "undefined") {
  Alert.alert = (title, message, buttons) => {
    const text = [title, message].filter(Boolean).join("\n\n");

    if (!Array.isArray(buttons) || buttons.length === 0) {
      window.alert(text);
      return;
    }
    if (buttons.length === 1) {
      window.alert(text);
      buttons[0]?.onPress?.();
      return;
    }
    // Due o più pulsanti: confirm() — OK esegue l'azione principale
    // (il primo pulsante non-cancel), Annulla quella di ripiego.
    const confirmBtn = buttons.find((b) => b?.style !== "cancel") || buttons[0];
    const cancelBtn = buttons.find((b) => b?.style === "cancel");
    if (window.confirm(text)) {
      confirmBtn?.onPress?.();
    } else {
      cancelBtn?.onPress?.();
    }
  };
}
