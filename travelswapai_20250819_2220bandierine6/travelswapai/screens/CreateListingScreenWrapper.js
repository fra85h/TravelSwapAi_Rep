// screens/CreateListingScreenWrapper.js

import { useState, useEffect, useRef } from "react";
import { Alert } from "react-native";
import CreateListingScreen from "./CreateListingScreen";

/**
 * Intercetta tutte le uscite dalla screen e chiede conferma se ci sono modifiche non salvate.
 * Usa un ref (allowLeaveRef) per evitare il loop del beforeRemove quando si conferma l’uscita.
 */
export default function CreateListingScreenWrapper({ navigation, route }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quando true, lasciamo passare la prossima uscita senza bloccarla
  const allowLeaveRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      // Se abbiamo già autorizzato l’uscita (dopo conferma), non bloccare
      if (allowLeaveRef.current) return;

      // Se non ci sono modifiche o stiamo inviando/pubblicando, lascia passare
      if (!hasUnsavedChanges || isSubmitting) return;

      // Blocca l’azione (es. tornare indietro)
      e.preventDefault();

      Alert.alert(
        "Abbandonare le modifiche?",
        "Hai modifiche non salvate. Uscendo le perderai.",
        [
          { text: "Annulla", style: "cancel" },
          {
            text: "Esci senza salvare",
            style: "destructive",
            onPress: () => {
              // Sblocca una sola volta e ripeti l’azione originale
              allowLeaveRef.current = true;
              // piccolo defer per sicurezza
              setTimeout(() => navigation.dispatch(e.data.action), 0);
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, hasUnsavedChanges, isSubmitting]);

  return (
    <CreateListingScreen
      onDirtyChange={setHasUnsavedChanges}
      onSubmitStart={() => setIsSubmitting(true)}
      onSubmitEnd={() => setIsSubmitting(false)}
      route={route}
    />
  );
}
