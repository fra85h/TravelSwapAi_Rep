// components/ui/ActionSheet.js — menu di azioni multiple, cross-platform.
// Alert.alert con più di 2 bottoni non è affidabile ovunque: su web il
// nostro shim (lib/webAlert.js) usa window.confirm(), che è binario e fa
// sparire silenziosamente ogni opzione oltre alla prima non-cancel.
import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable, ScrollView } from "react-native";
import { theme } from "../../lib/theme";

// Tetto d'altezza per la lista opzioni: con poche opzioni (menu profilo,
// motivi di segnalazione) non cambia nulla, ma con MOLTE opzioni (es. il
// picker "quale annuncio segnalo" con tanti annunci compatibili) prima il
// foglio cresceva senza limite e faceva scrollare l'intera pagina, con
// titolo e "Annulla" che uscivano dalla vista — brutto e disorientante.
// Ora scrolla solo la lista, titolo e Annulla restano sempre visibili.
const OPTIONS_MAX_HEIGHT = 340;

export default function ActionSheet({ visible, title, message, options = [], cancelLabel = "Annulla", onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {(title || message) && (
            <View style={styles.header}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {message ? <Text style={styles.message} numberOfLines={2}>{message}</Text> : null}
            </View>
          )}
          <ScrollView style={{ maxHeight: OPTIONS_MAX_HEIGHT }} bounces={false}>
            {options.map((opt, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.row, idx < options.length - 1 && styles.rowBorder]}
                onPress={() => { onClose?.(); opt.onPress?.(); }}
              >
                <Text style={[styles.rowText, opt.destructive && styles.destructiveText]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cancelRow} onPress={onClose}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingBottom: 24,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, alignItems: "center" },
  title: { fontWeight: "800", fontSize: 16, color: theme.colors.text, textAlign: "center" },
  message: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4, textAlign: "center" },
  row: { paddingVertical: 16, paddingHorizontal: 20, alignItems: "center" },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rowText: { fontSize: 16, fontWeight: "700", color: theme.colors.text },
  destructiveText: { color: theme.colors.danger },
  cancelRow: { marginTop: 8, marginHorizontal: 16, paddingVertical: 14, alignItems: "center", backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.lg },
  cancelText: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
});
