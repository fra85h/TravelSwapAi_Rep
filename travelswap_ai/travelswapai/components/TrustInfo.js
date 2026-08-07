// components/TrustInfo.js — "da dove esce questo numero?"
//
// Compare due volte in "Crea annuncio", accanto al punteggio di affidabilità.
// I testi stavano scritti qui dentro, in italiano: chi usa l'app in inglese o
// spagnolo si trovava la spiegazione del punteggio in una lingua che non ha
// scelto, proprio nel momento in cui quel numero sta per finire pubblico.
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";

export default function TrustInfo() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ marginLeft: 8 }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t("trustInfo.open", "Come si calcola l'affidabilità")}
        onPress={() => setVisible(true)}
        style={{ padding: 4 }}
      >
        <Ionicons name="information-circle-outline" size={20} color="#6B7280" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{t("trustInfo.title", "Come calcoliamo l'affidabilità")}</Text>
            <Text style={styles.text}>
              {t("trustInfo.body", "Il punteggio va da 0 a 100 ed è una media pesata di tre cose:")}
              {"\n"}• {t("trustInfo.bullet1", "coerenza dei dati che hai inserito (date, prezzo, tratta)")}
              {"\n"}• {t("trustInfo.bullet2", "analisi del testo della descrizione")}
              {"\n"}• {t("trustInfo.bullet3", "analisi delle foto, quando ci sono")}
            </Text>
            <Text style={[styles.text, { marginTop: 8 }]}>
              {t("trustInfo.footer", "Più è alto, più l'annuncio risulta attendibile a chi lo guarda. Non è una garanzia: riguarda l'annuncio, non la persona.")}
            </Text>

            <TouchableOpacity onPress={() => setVisible(false)} style={styles.btn}>
              <Text style={styles.btnText}>{t("common.close", "Chiudi")}</Text>
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
