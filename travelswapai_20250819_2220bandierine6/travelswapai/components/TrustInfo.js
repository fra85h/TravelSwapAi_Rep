// components/TrustInfo.js
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function TrustInfo() {
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ marginLeft: 8 }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Informazioni sul TrustScore"
        onPress={() => setVisible(true)}
        style={{ padding: 4 }}
      >
        <Ionicons name="information-circle-outline" size={20} color="#6B7280" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>Come calcoliamo l’affidabilità 🔮</Text>
            <Text style={styles.text}>
              Il punteggio (0–100) è una media ponderata di:
              {"\n"}• Controlli locali (completezza, coerenza date/valori)
              {"\n"}• Analisi AI sul testo della descrizione
              {"\n"}• Analisi AI (facoltativa) sulle immagini
            </Text>
            <Text style={[styles.text, { marginTop: 8 }]}>
              Più alto = annuncio più affidabile. Non è una garanzia: usa sempre buon senso.
            </Text>

            <TouchableOpacity onPress={() => setVisible(false)} style={styles.btn}>
              <Text style={styles.btnText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#00000066",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    maxWidth: 380,
    width: "100%",
  },
  title: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 8 },
  text: { color: "#374151", fontSize: 14, lineHeight: 20 },
  btn: {
    marginTop: 14,
    backgroundColor: "#111827",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
