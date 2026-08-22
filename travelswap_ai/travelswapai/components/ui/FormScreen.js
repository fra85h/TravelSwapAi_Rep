// components/ui/FormScreen.js — una schermata fatta di campi da compilare.
//
// Esiste per una cosa sola: su iOS la finestra NON si ridimensiona quando
// compare la tastiera. Su Android il sistema lo fa da sé (adjustResize), su
// iOS no — il contenuto resta dov'è e la tastiera ci si appoggia sopra. Sulle
// schermate di accesso questo significava non vedere più il campo che si sta
// scrivendo, e soprattutto non poter raggiungere il pulsante: su un telefono
// piccolo "Accedi" finiva esattamente sotto la tastiera, e l'unico modo per
// arrivarci era chiuderla a mano.
//
// keyboardShouldPersistTaps="handled" chiude il difetto gemello, che è ancora
// più subdolo perché sembra che l'app non risponda: con la tastiera aperta,
// il primo tocco su un pulsante viene consumato per chiudere la tastiera e
// basta. Bisogna premere due volte, e chi lo fa pensa che il primo tocco sia
// andato perso.
//
// Il contenuto sta dentro una ScrollView con flexGrow: 1, così una schermata
// corta resta disposta com'era (niente si sposta) ma una schermata che con la
// tastiera aperta non ci sta più si può scorrere.
import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { theme } from "../../lib/theme";

export default function FormScreen({ children, contentStyle, style }) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}
      // Su Android il ridimensionamento lo fa già il sistema: aggiungere
      // padding qui lo farebbe due volte, lasciando una fascia vuota sotto.
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <ScrollView
        contentContainerStyle={[{ flexGrow: 1, padding: 20 }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
