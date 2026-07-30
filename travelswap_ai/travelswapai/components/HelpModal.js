// components/HelpModal.js
// Analisi empatia/UX, sezione E punto 16: "cosa fare se..." raggiungibile
// direttamente dalla schermata di conferma/disputa — prima mancava
// qualunque guida contestuale, l'utente doveva capire da solo cosa fare
// in caso di problema. Componente generico: chi lo usa passa le proprie
// domande/risposte (ChatScreen per i 1:1, ChainChatScreen per le catene a
// 3 hanno contenuti diversi).
import React from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";

// actionLabel/onAction: azione secondaria opzionale (es. "Segnala un
// problema" in ChainChatScreen) — solo se chi usa il modale la passa
// davvero, mai promessa a chi non ce l'ha (es. ChatScreen ha già il suo
// bottone di segnalazione dedicato fuori da qui).
export default function HelpModal({ visible, onClose, title, items, closeLabel, actionLabel, onAction }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel}>
              <Ionicons name="close" size={22} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {items.map((it, i) => (
              <View key={i} style={styles.item}>
                <Text style={styles.itemTitle}>{it.q}</Text>
                <Text style={styles.itemBody}>{it.a}</Text>
              </View>
            ))}
          </ScrollView>
          {actionLabel && onAction ? (
            <TouchableOpacity style={styles.actionBtn} onPress={onAction}>
              <Text style={styles.actionBtnText}>{actionLabel}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>{closeLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
    maxHeight: "80%", paddingBottom: 20,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  title: { fontSize: 17, fontWeight: "800", color: theme.colors.text },
  body: { paddingHorizontal: 18, paddingTop: 12, gap: 16 },
  item: { gap: 4 },
  itemTitle: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  itemBody: { fontSize: 13.5, color: theme.colors.textMuted, lineHeight: 19 },
  closeBtn: {
    marginHorizontal: 18, marginTop: 10, paddingVertical: 12, borderRadius: 999,
    backgroundColor: theme.colors.accent, alignItems: "center",
  },
  closeBtnText: { color: theme.colors.accentOn, fontWeight: "800", fontSize: 14 },
  actionBtn: {
    marginHorizontal: 18, marginTop: 14, paddingVertical: 12, borderRadius: 999,
    borderWidth: 1, borderColor: "#991B1B", alignItems: "center",
  },
  actionBtnText: { color: "#991B1B", fontWeight: "800", fontSize: 14 },
});
