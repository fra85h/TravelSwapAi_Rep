// components/PaymentDeclaration.js — "quanto hai pagato, e come".
//
// Compare dentro il passaggio del pagamento, solo negli acquisti. L'app non
// custodisce il denaro e non verifica nulla: qui ciascuno registra ciò che
// dichiara di aver fatto. Serve a due cose, in quest'ordine di importanza:
//
//  1) al prodotto, per sapere COSA succede davvero fuori dall'app (importi,
//     metodi, quanto tempo passa, quanto spesso le due versioni divergono).
//     È il dato su cui si deciderà se un pagamento in custodia vale il suo
//     costo, invece di deciderlo a intuito;
//  2) alle due persone, perché due dichiarazioni indipendenti che coincidono
//     valgono più di un "ok" in chat, e una discordanza emerge subito invece
//     che a transazione chiusa.
//
// Doppio cieco, come le valutazioni: la dichiarazione dell'altro si vede solo
// dopo aver fatto la propria (regola applicata dalla RPC, non qui).
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../lib/theme";
import { PAYMENT_METHODS, declarePayment } from "../lib/paymentDeclarations";
import { parseLocalizedNumber } from "../lib/number";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function PaymentDeclaration({ offerId, decl, suggestedAmount, t, onSaved }) {
  const isSeller = decl?.myRole === "seller";
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(
    decl?.mineAmount != null ? String(decl.mineAmount) : (suggestedAmount != null ? String(suggestedAmount) : "")
  );
  const [method, setMethod] = useState(decl?.mineMethod || null);
  const [paidAt, setPaidAt] = useState(decl?.minePaidAt || todayISO());
  const [busy, setBusy] = useState(false);

  if (!decl) return null;

  const methodLabel = (m) => t(`transactionSteps.declare.method.${m}`, m);

  const save = async () => {
    const n = parseLocalizedNumber(String(amount).trim());
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert(t("common.error", "Errore"), t("transactionSteps.declare.badAmount", "Inserisci un importo valido."));
      return;
    }
    if (!method) {
      Alert.alert(t("common.error", "Errore"), t("transactionSteps.declare.badMethod", "Scegli come è avvenuto il pagamento."));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(paidAt))) {
      Alert.alert(t("common.error", "Errore"), t("transactionSteps.declare.badDate", "Indica la data nel formato AAAA-MM-GG."));
      return;
    }
    try {
      setBusy(true);
      await declarePayment(offerId, { amount: n, method, paidAt });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("transactionSteps.declare.saveError", "Non sono riuscito a registrare la dichiarazione."));
    } finally {
      setBusy(false);
    }
  };

  // Già dichiarato e non in modifica: riepilogo, più la controparte se
  // visibile.
  if (decl.mineDeclared && !editing) {
    return (
      <View style={s.box}>
        <Text style={s.boxTitle}>
          {isSeller
            ? t("transactionSteps.declare.mineSeller", "Hai dichiarato di aver incassato")
            : t("transactionSteps.declare.mineBuyer", "Hai dichiarato di aver pagato")}
        </Text>
        <Text style={s.summary}>
          {decl.mineAmount} {decl.mineCurrency} · {methodLabel(decl.mineMethod)} · {decl.minePaidAt}
        </Text>

        {decl.otherDeclared ? (
          <>
            <View style={s.rule} />
            <Text style={s.boxTitle}>
              {isSeller
                ? t("transactionSteps.declare.otherBuyer", "L'altra persona ha dichiarato di aver pagato")
                : t("transactionSteps.declare.otherSeller", "L'altra persona ha dichiarato di aver incassato")}
            </Text>
            <Text style={s.summary}>
              {decl.otherAmount} {decl.mineCurrency} · {methodLabel(decl.otherMethod)} · {decl.otherPaidAt}
            </Text>
            {decl.amountsMatch === false ? (
              // Una discordanza non blocca niente: è un'informazione, e va
              // detta subito invece che scoperta a transazione chiusa.
              <View style={s.mismatch}>
                <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
                <Text style={s.mismatchTxt}>
                  {t("transactionSteps.declare.mismatch", "Le due dichiarazioni non coincidono. Chiaritelo in chat prima di confermare.")}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={s.note}>
            {t("transactionSteps.declare.waitingOther", "L'altra persona non ha ancora dichiarato. Vedrai la sua versione quando lo farà.")}
          </Text>
        )}

        <TouchableOpacity onPress={() => setEditing(true)} accessibilityRole="button">
          <Text style={s.editLink}>{t("transactionSteps.declare.edit", "Correggi")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.box}>
      <Text style={s.boxTitle}>
        {isSeller
          ? t("transactionSteps.declare.askSeller", "Hai ricevuto il pagamento?")
          : t("transactionSteps.declare.askBuyer", "Hai pagato?")}
      </Text>
      <Text style={s.note}>
        {t("transactionSteps.declare.why", "Registralo qui. Non è un pagamento e non blocca nulla: serve a confrontare le due versioni e a farci capire come funzionano davvero gli scambi di denaro fuori dall'app.")}
      </Text>

      {decl.otherDeclared && !decl.mineDeclared ? (
        <Text style={s.nudge}>
          {t("transactionSteps.declare.otherAlready", "L'altra persona ha già dichiarato.")}
        </Text>
      ) : null}

      <View style={s.field}>
        <Text style={s.label}>{t("transactionSteps.declare.amount", "Importo")}</Text>
        <TextInput
          style={s.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0,00"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={t("transactionSteps.declare.amount", "Importo")}
        />
      </View>

      <View style={s.field}>
        <Text style={s.label}>{t("transactionSteps.declare.method.label", "Come")}</Text>
        {/* Elenco chiuso, mai testo libero: un campo libero qui diventerebbe
            il posto dove si scrivono IBAN e numeri di telefono. */}
        <View style={s.chips}>
          {PAYMENT_METHODS.map((m) => (
            <TouchableOpacity
              key={m}
              style={[s.chip, method === m && s.chipOn]}
              onPress={() => setMethod(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: method === m }}
            >
              <Text style={[s.chipTxt, method === m && s.chipTxtOn]}>{methodLabel(m)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.field}>
        <Text style={s.label}>{t("transactionSteps.declare.date", "Quando")}</Text>
        <TextInput
          style={s.input}
          value={paidAt}
          onChangeText={setPaidAt}
          placeholder="AAAA-MM-GG"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          accessibilityLabel={t("transactionSteps.declare.date", "Quando")}
        />
      </View>

      <TouchableOpacity
        style={[s.btn, busy && s.btnDisabled]}
        onPress={save}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={s.btnTxt}>{busy ? "…" : t("transactionSteps.declare.save", "Registra")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  boxTitle: { ...theme.typography.body, fontWeight: "800" },
  summary: { ...theme.typography.body, marginTop: 2 },
  note: { ...theme.typography.small, lineHeight: 17 },
  nudge: { ...theme.typography.small, color: theme.colors.accent, fontWeight: "700" },
  rule: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.sm },
  field: { marginTop: theme.spacing.sm, gap: 4 },
  label: { ...theme.typography.small, fontWeight: "700" },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10,
    color: theme.colors.text,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primaryMuted },
  chipTxt: { ...theme.typography.small, color: theme.colors.text },
  chipTxtOn: { color: theme.colors.accentOn, fontWeight: "800" },
  mismatch: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: theme.spacing.sm },
  mismatchTxt: { ...theme.typography.small, color: theme.colors.danger, flex: 1, lineHeight: 17 },
  editLink: { ...theme.typography.small, color: theme.colors.accent, fontWeight: "700", marginTop: theme.spacing.sm },
  btn: {
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill,
    paddingVertical: 12, marginTop: theme.spacing.md,
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt: { color: theme.colors.accentOn, fontWeight: "800" },
});
