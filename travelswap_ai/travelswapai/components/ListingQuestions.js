// components/ListingQuestions.js — domande e risposte pubbliche su un annuncio.
//
// Un solo componente per entrambi i ruoli, perché la lista è la stessa: chi
// guarda vede le risposte, il proprietario vede in più i pulsanti per
// rispondere. Separarli avrebbe significato duplicare il rendering dell'elenco.
//
// Nessun campo di testo, da nessuna parte: domande e risposte sono codici
// presi dal catalogo condiviso (lib/listingQuestions.mjs). È la ragione per
// cui questo canale può esistere prima dell'accettazione senza aprire la porta
// a spam e scambi di recapiti fuori piattaforma.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { questionsForListing, canAskAbout, getQuestion } from "../lib/listingQuestions.mjs";
import {
  listListingQuestions, askListingQuestion, answerListingQuestion,
} from "../lib/listingQuestionsApi";

export default function ListingQuestions({ listing, meId }) {
  const { t } = useI18n();
  const [righe, setRighe] = useState([]);
  const [caricando, setCaricando] = useState(true);
  const [apertoElenco, setApertoElenco] = useState(false);
  const [inCorso, setInCorso] = useState(null);

  const listingId = listing?.id;
  const sonoIlProprietario = !!meId && String(listing?.user_id) === String(meId);

  const carica = useCallback(async () => {
    if (!listingId) return;
    setCaricando(true);
    try {
      setRighe(await listListingQuestions(listingId));
    } finally {
      setCaricando(false);
    }
  }, [listingId]);

  useEffect(() => { carica(); }, [carica]);

  const chiedi = async (code) => {
    setInCorso(code);
    try {
      await askListingQuestion(listingId, code);
      setApertoElenco(false);
      await carica();
      Alert.alert(t("listingQuestions.title", "Domande e risposte"),
        t("listingQuestions.sent", "Domanda inviata: ti avvisiamo quando risponde."));
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || String(e));
    } finally {
      setInCorso(null);
    }
  };

  const rispondi = async (riga, answer) => {
    setInCorso(riga.id);
    try {
      await answerListingQuestion(riga.id, riga.code, answer);
      await carica();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || String(e));
    } finally {
      setInCorso(null);
    }
  };

  // Le domande già presenti non si ripropongono: il vincolo di unicità a DB è
  // il backstop, questo evita di mostrarle proprio.
  const giaPoste = righe.map((r) => r.code);
  const disponibili = questionsForListing(listing, giaPoste);
  const possoChiedere = !sonoIlProprietario && canAskAbout(listing, meId).allowed;

  if (caricando) {
    return (
      <View style={styles.box}>
        <Text style={styles.titolo}>{t("listingQuestions.title", "Domande e risposte")}</Text>
        <ActivityIndicator style={{ marginTop: 8 }} />
      </View>
    );
  }

  // Nessuna domanda e nessuna possibilità di farne: la sezione non serve.
  if (!righe.length && !possoChiedere) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.titolo}>{t("listingQuestions.title", "Domande e risposte")}</Text>

      {!righe.length ? (
        <Text style={styles.vuoto}>
          {t("listingQuestions.noneYet", "Nessuna domanda per ora. Se ti serve un dettaglio, chiedilo prima di proporre.")}
        </Text>
      ) : null}

      {righe.map((r) => {
        const def = getQuestion(r.code);
        return (
          <View key={r.id} style={styles.riga}>
            <Text style={styles.domanda}>
              {t(`listingQuestions.q.${r.code}`, r.code)}
            </Text>

            {r.answer ? (
              <Text style={styles.risposta}>
                {t(`listingQuestions.a.${r.code}.${r.answer}`, r.answer)}
              </Text>
            ) : sonoIlProprietario && def ? (
              <>
                {/* Avviso solo dove serve davvero: una foto del biglietto
                    contiene QR e codice di prenotazione, cioè il dato che
                    l'app tiene segregato e non mostra mai. Pubblicarla in
                    chiaro significa regalare il biglietto a chi la vede. */}
                {r.code === "photo" || r.code === "hotel_photo" ? (
                  <Text style={styles.avviso}>
                    {t("listingQuestions.photoWarning", "⚠️ Copri il codice QR e il codice di prenotazione prima di fotografare il biglietto: chi li vede potrebbe usarlo.")}
                  </Text>
                ) : null}
                <View style={styles.opzioni}>
                  {def.answers.map((a) => (
                    <TouchableOpacity
                      key={a}
                      style={styles.opzione}
                      disabled={inCorso === r.id}
                      onPress={() => rispondi(r, a)}
                    >
                      <Text style={styles.opzioneTesto}>
                        {t(`listingQuestions.a.${r.code}.${a}`, a)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.attesa}>{t("listingQuestions.waiting", "In attesa di risposta")}</Text>
            )}
          </View>
        );
      })}

      {possoChiedere && disponibili.length > 0 ? (
        <TouchableOpacity style={styles.cta} onPress={() => setApertoElenco((v) => !v)}>
          <Text style={styles.ctaTesto}>
            {t("listingQuestions.askCta", "Chiedi informazioni")}
          </Text>
        </TouchableOpacity>
      ) : null}

      {possoChiedere && !disponibili.length && righe.length ? (
        <Text style={styles.vuoto}>
          {t("listingQuestions.allAsked", "Hai già chiesto tutto quello che si può chiedere qui.")}
        </Text>
      ) : null}

      {apertoElenco ? (
        <View style={styles.elenco}>
          <Text style={styles.elencoTitolo}>
            {t("listingQuestions.askTitle", "Cosa vuoi sapere?")}
          </Text>
          {disponibili.map((q) => (
            <TouchableOpacity
              key={q.code}
              style={styles.scelta}
              disabled={inCorso === q.code}
              onPress={() => chiedi(q.code)}
            >
              <Text style={styles.sceltaTesto}>
                {t(`listingQuestions.q.${q.code}`, q.code)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.colors?.card || "#FFFFFF",
    borderRadius: 16, padding: 14, marginTop: 12,
    borderWidth: 1, borderColor: theme.colors?.border || "#E5E7EB",
  },
  titolo: { fontSize: 16, fontWeight: "800", color: theme.colors?.boardingText || "#111827" },
  vuoto: { color: theme.colors?.textMuted || "#6B7280", marginTop: 8, lineHeight: 20 },
  riga: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors?.border || "#E5E7EB" },
  domanda: { fontWeight: "700", color: theme.colors?.boardingText || "#111827" },
  risposta: { marginTop: 4, color: theme.colors?.text || "#111827" },
  attesa: { marginTop: 4, fontStyle: "italic", color: theme.colors?.textMuted || "#6B7280" },
  avviso: { marginTop: 6, color: "#92400E", backgroundColor: "#FFFBEB", borderRadius: 10, padding: 8, lineHeight: 18 },
  opzioni: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  opzione: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE",
  },
  opzioneTesto: { fontWeight: "700", color: "#3730A3" },
  cta: {
    marginTop: 14, paddingVertical: 12, borderRadius: 12, alignItems: "center",
    backgroundColor: theme.colors?.accent || "#C99A2E",
  },
  ctaTesto: { fontWeight: "800", color: theme.colors?.accentOn || "#1B2159" },
  elenco: { marginTop: 10 },
  elencoTitolo: { fontWeight: "700", marginBottom: 6, color: theme.colors?.boardingText || "#111827" },
  scelta: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginTop: 6,
    backgroundColor: "#F4F5F9", borderWidth: 1, borderColor: theme.colors?.border || "#E5E7EB",
  },
  sceltaTesto: { color: theme.colors?.text || "#111827" },
});
