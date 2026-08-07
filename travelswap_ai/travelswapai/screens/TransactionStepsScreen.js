// screens/TransactionStepsScreen.js — "cosa devo fare adesso".
//
// Dopo che una proposta è stata accettata restano dei passaggi che avvengono
// FUORI dall'app (reintestazione presso l'operatore, eventuale pagamento fra
// le parti) e che finora non erano scritti da nessuna parte: si tornava in
// chat con una riga di stato. Qui c'è la sequenza completa, con un solo
// passaggio espanso alla volta e il turno attribuito esplicitamente — è
// l'attesa senza sapere di chi sia il turno il momento in cui si sospetta di
// essere stati raggirati.
//
// La sequenza NON è scritta qui: arriva da lib/transactionSteps.js. Questa
// schermata sa solo disegnare un passaggio e collegarlo alla sua azione.
import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Linking, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { getOfferHandshake } from "../lib/chat";
import { confirmExchange } from "../lib/offers";
import { myRatingForOffer } from "../lib/ratingsApi";
import { getPaymentDeclarations } from "../lib/paymentDeclarations";
import PaymentDeclaration from "../components/PaymentDeclaration";
import {
  buildTransactionSteps, STEP_ID, STEP_STATE, STEP_OWNER, PAYMENT_VARIANT,
} from "../lib/transactionSteps";

// Sito ufficiale per la reintestazione. Volutamente una mappa corta e non
// esaustiva: se l'operatore non è fra questi il passaggio resta, sparisce
// solo la scorciatoia — meglio nessun bottone che un bottone che porta
// altrove. Il cambio nominativo va fatto SEMPRE sul canale ufficiale: è la
// singola istruzione che riduce davvero il rischio di raggiro.
const OPERATOR_URLS = {
  trenitalia: "https://www.trenitalia.com",
  italo: "https://www.italotreno.com",
  italotreno: "https://www.italotreno.com",
};

function operatorUrl(name) {
  const k = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  return OPERATOR_URLS[k] || null;
}

export default function TransactionStepsScreen({ route, navigation }) {
  const { t } = useI18n();
  const offerId = route?.params?.offerId;
  const otherName = route?.params?.otherName || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [handshake, setHandshake] = useState(null);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [decl, setDecl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!offerId) { setError("missing"); setLoading(false); return; }
    try {
      setError(null);
      const [hs, mine] = await Promise.all([
        getOfferHandshake(offerId),
        // Il voto è un dettaglio: se non si riesce a leggerlo si mostra il
        // passaggio come da fare, non si blocca tutta la schermata.
        myRatingForOffer(offerId).catch(() => null),
      ]);
      setHandshake(hs);
      setAlreadyRated(mine != null);
      // Dichiarazioni di pagamento: solo negli acquisti (in uno scambio non
      // gira denaro fra le parti). Porta con sé anche il MIO ruolo, che
      // get_offer_handshake non espone — è ciò che permette di attribuire il
      // turno del pagamento invece di lasciarlo indeterminato.
      setDecl(hs?.type === "buy" ? await getPaymentDeclarations(offerId) : null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  // Solo useFocusEffect, non anche useEffect: copre già il primo montaggio, e
  // insieme avrebbero fatto due letture identiche a ogni apertura. Rileggere
  // ad ogni focus serve perché il passaggio successivo dipende anche da cosa
  // fa l'ALTRA persona: tornando dalla chat non si deve restare fermi su una
  // tappa che dall'altro lato è già stata superata.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // I passaggi che restano avvengono fuori dall'app: nessun realtime li
  // annuncia. Il gesto di tirare giù è l'unico modo che l'utente ha per
  // chiedere "e adesso?" senza uscire e rientrare dalla schermata.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const onConfirm = async () => {
    try {
      setBusy(true);
      await confirmExchange(offerId);
      await load();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e?.message || t("transactionSteps.confirmError", "Non sono riuscito a registrare la conferma."));
    } finally {
      setBusy(false);
    }
  };

  const openChat = () => navigation.navigate("Chat", { offerId });

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={theme.colors.accent} /></View>;
  }
  if (error || !handshake) {
    return (
      <View style={s.center}>
        <Text style={s.errText}>{t("transactionSteps.loadError", "Non riesco a leggere lo stato della transazione.")}</Text>
        <TouchableOpacity style={s.btnGhost} onPress={load}>
          <Text style={s.btnGhostTxt}>{t("common.retry", "Riprova")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { steps, remaining, activeIndex } = buildTransactionSteps(handshake, {
    role: decl?.myRole || null,
    otherName,
    alreadyRated,
  });
  const isBuy = handshake.type === "buy";

  // Chi stiamo aspettando. I passaggi che restano avvengono fuori dall'app e
  // non si spuntano da soli (scelta voluta: non sono osservabili), quindi
  // senza questa riga la schermata resta ferma e non si capisce se la palla
  // sia tua o dell'altro. Il dato c'era già — l'attribuzione del turno è in
  // lib/transactionSteps.js — semplicemente non veniva mostrato come attesa.
  const attivo = activeIndex >= 0 ? steps[activeIndex] : null;
  const attesa = !attivo || remaining === 0 ? null
    : attivo.owner === STEP_OWNER.OTHER
      ? t("transactionSteps.waitingOther", "Stai aspettando {name}: la schermata si aggiorna tirando giù.", { name: otherName || t("transactionSteps.otherParty", "l'altra parte") })
      : attivo.owner === STEP_OWNER.ME
      ? t("transactionSteps.waitingMe", "Tocca a te: il passaggio qui sotto aspetta una tua mossa.")
      : attivo.owner === STEP_OWNER.BOTH
      ? t("transactionSteps.waitingBoth", "Serve un gesto da entrambi: finché manca una delle due parti si resta qui.")
      : null;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.title}>
        {isBuy
          ? t("transactionSteps.titleBuy", "Acquisto confermato")
          : t("transactionSteps.titleSwap", "Scambio confermato")}
      </Text>
      {/* Un percorso di lunghezza nota non spaventa; uno di lunghezza ignota sì. */}
      <Text style={[s.subtitle, !attesa && s.subtitleAlone]}>
        {remaining === 0
          ? t("transactionSteps.allDone", "Non manca più niente.")
          : remaining === 1
          ? t("transactionSteps.remainingOne", "Manca 1 passaggio.")
          : t("transactionSteps.remaining", "Mancano {n} passaggi.", { n: remaining })}
      </Text>

      {attesa ? <Text style={s.waiting}>{attesa}</Text> : null}

      <View style={s.timeline}>
        {steps.map((st, i) => (
          <StepRow
            key={st.id}
            step={st}
            last={i === steps.length - 1}
            t={t}
            busy={busy}
            onConfirm={onConfirm}
            openChat={openChat}
            offerId={offerId}
            decl={decl}
            reload={load}
          />
        ))}
      </View>

      <TouchableOpacity style={s.problem} onPress={openChat} accessibilityRole="button">
        <Ionicons name="alert-circle-outline" size={15} color={theme.colors.textMuted} />
        <Text style={s.problemTxt}>{t("transactionSteps.problem", "Qualcosa non va? Scrivine in chat")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- */

function StepRow({ step, last, t, busy, onConfirm, openChat, offerId, decl, reload }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const active = step.state === STEP_STATE.ACTIVE;
  const done = step.state === STEP_STATE.DONE;
  const blocked = step.state === STEP_STATE.BLOCKED;
  const p = step.params || {};

  const title = {
    [STEP_ID.AGREED]: t("transactionSteps.agreed.title", "Proposta accettata"),
    [STEP_ID.PAYMENT]: t("transactionSteps.payment.title", "Pagamento"),
    [STEP_ID.NAME_CHANGE]: t("transactionSteps.nameChange.title", "Cambio nominativo"),
    [STEP_ID.CONFIRM]: t("transactionSteps.confirm.title", "Confermate entrambi"),
    [STEP_ID.RATE]: t("transactionSteps.rate.title", "Valutazione"),
    [STEP_ID.DISPUTE]: t("transactionSteps.dispute.title", "Problema segnalato"),
    [STEP_ID.CANCELLED]: t("transactionSteps.cancelled.title", "Transazione annullata"),
  }[step.id];

  const owner =
    step.owner === STEP_OWNER.ME ? t("transactionSteps.owner.me", "Tocca a te")
    : step.owner === STEP_OWNER.OTHER ? t("transactionSteps.owner.other", "Tocca a loro")
    : step.owner === STEP_OWNER.BOTH ? t("transactionSteps.owner.both", "Tocca a entrambi")
    : null;

  return (
    <View style={s.stepRow}>
      <View style={s.rail}>
        <View style={[s.dot, active && s.dotActive, done && s.dotDone, blocked && s.dotBlocked]}>
          {done ? <Ionicons name="checkmark" size={11} color="#FFF" /> : null}
          {blocked ? <Ionicons name="close" size={11} color="#FFF" /> : null}
        </View>
        {!last ? <View style={s.railLine} /> : null}
      </View>

      <View style={[s.card, active && s.cardActive]}>
        <View style={s.head}>
          <Text style={[s.stepTitle, !active && s.stepTitleMuted]}>{title}</Text>
          {owner && !done ? (
            <Text style={[s.owner, active && s.ownerActive]}>{owner}</Text>
          ) : null}
        </View>

        {active ? <StepBody
          step={step} p={p} t={t} busy={busy}
          whyOpen={whyOpen} setWhyOpen={setWhyOpen}
          onConfirm={onConfirm} openChat={openChat}
          offerId={offerId} decl={decl} reload={reload}
        /> : null}
      </View>
    </View>
  );
}

function StepBody({ step, p, t, busy, whyOpen, setWhyOpen, onConfirm, openChat, offerId, decl, reload }) {
  switch (step.id) {
    case STEP_ID.PAYMENT: {
      const amount = p.amount != null ? `${p.amount} ${p.currency || "EUR"}` : null;
      // Oggi l'unica variante è quella esterna. Quando i pagamenti passeranno
      // dentro l'app basterà aggiungere qui il ramo ESCROW: la sequenza, la
      // schermata e tutto il resto restano com'è.
      const external = p.variant !== PAYMENT_VARIANT.ESCROW;
      return (
        <>
          {amount ? <Text style={s.amount}>{amount}</Text> : null}
          <Text style={s.body}>
            {external
              ? t("transactionSteps.payment.bodyExternal", "Mettetevi d'accordo in chat su come e quando pagare. Il pagamento avviene direttamente fra voi due.")
              : t("transactionSteps.payment.bodyEscrow", "Paga dall'app: l'importo resta bloccato e viene versato solo a scambio avvenuto.")}
          </Text>
          {external ? (
            <>
              <TouchableOpacity onPress={() => setWhyOpen((v) => !v)} accessibilityRole="button">
                <Text style={s.why}>
                  {t("transactionSteps.payment.why", "Perché fuori dall'app?")} {whyOpen ? "⌃" : "⌄"}
                </Text>
              </TouchableOpacity>
              {whyOpen ? (
                <Text style={s.whyBody}>
                  {t("transactionSteps.payment.whyBody", "Oggi TravelSwap mette in contatto viaggiatori: non gestisce pagamenti e non trattiene denaro, quindi non può rimborsare un pagamento fatto fra voi. Concordate il metodo in chat e conservate la ricevuta.")}
                </Text>
              ) : null}
              <PrimaryBtn onPress={openChat} label={t("transactionSteps.openChat", "Apri la chat")} />
              {/* Registrazione di quanto è stato pagato: non è un pagamento e
                  non blocca nulla — serve a confrontare le due versioni e a
                  capire cosa succede davvero fuori dall'app. */}
              <PaymentDeclaration
                offerId={offerId}
                decl={decl}
                suggestedAmount={p.amount}
                t={t}
                onSaved={reload}
              />
            </>
          ) : null}
        </>
      );
    }

    case STEP_ID.NAME_CHANGE: {
      const url = operatorUrl(p.operator);
      return (
        <>
          <Text style={s.body}>
            {p.operator
              ? t("transactionSteps.nameChange.bodyOperator", "Il biglietto è intestato: va reintestato presso {operator}. Scambiatevi in chat nome, cognome ed eventuale documento, poi fate il cambio sul sito ufficiale.", { operator: p.operator })
              : t("transactionSteps.nameChange.body", "Il biglietto è intestato: va reintestato presso l'operatore. Scambiatevi in chat nome, cognome ed eventuale documento, poi fate il cambio sul sito ufficiale.")}
          </Text>
          {/* Il costo va detto PRIMA di uscire dall'app, non scoperto sul sito
              dell'operatore: è lì che si perde la fiducia. */}
          <Text style={s.note}>
            {p.isBuy
              ? t("transactionSteps.nameChange.costBuy", "Il cambio può avere un costo, o non essere consentito: verificatelo prima di pagare.")
              : t("transactionSteps.nameChange.costSwap", "Il cambio può avere un costo, o non essere consentito: verificatelo prima di procedere. Ognuno paga il proprio, all'operatore — TravelSwap non incassa nulla.")}
          </Text>
          {url ? (
            <PrimaryBtn
              onPress={() => Linking.openURL(url).catch(() => {})}
              label={t("transactionSteps.nameChange.open", "Apri {operator}", { operator: p.operator })}
              icon="open-outline"
            />
          ) : null}
          <GhostBtn onPress={openChat} label={t("transactionSteps.openChat", "Apri la chat")} />
        </>
      );
    }

    case STEP_ID.CONFIRM:
      return (
        <>
          <Text style={s.body}>
            {p.iConfirmed
              ? t("transactionSteps.confirm.waiting", "Hai confermato. La transazione si chiude quando conferma anche l'altra persona.")
              : t("transactionSteps.confirm.body", "Quando è andato tutto a buon fine, confermate entrambi: da lì la transazione è chiusa e potete valutarvi.")}
          </Text>
          {!p.iConfirmed ? (
            <PrimaryBtn
              onPress={onConfirm}
              disabled={busy}
              label={busy ? "…" : t("transactionSteps.confirm.cta", "Conferma")}
            />
          ) : null}
        </>
      );

    case STEP_ID.RATE:
      return (
        <>
          <Text style={s.body}>
            {t("transactionSteps.rate.body", "Lascia una valutazione da 1 a 5 stelle. Resta nascosta all'altra persona finché non vota anche lei (o per 14 giorni), ed è definitiva.")}
          </Text>
          <PrimaryBtn onPress={openChat} label={t("transactionSteps.rate.cta", "Vai alla valutazione")} />
        </>
      );

    case STEP_ID.DISPUTE:
      return (
        <>
          <Text style={s.body}>
            {t("transactionSteps.dispute.body", "È stato segnalato un problema: finché non è risolto la transazione non può proseguire. Parlatene in chat.")}
          </Text>
          {p.reason ? <Text style={s.disputeReason}>{p.reason}</Text> : null}
          <PrimaryBtn onPress={openChat} label={t("transactionSteps.openChat", "Apri la chat")} />
        </>
      );

    case STEP_ID.CANCELLED:
      return (
        <Text style={s.body}>
          {t("transactionSteps.cancelled.body", "Questa transazione è stata annullata: non ci sono altri passaggi da fare.")}
        </Text>
      );

    default:
      return null;
  }
}

function PrimaryBtn({ onPress, label, icon, disabled }) {
  return (
    <TouchableOpacity
      style={[s.btn, disabled && s.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <Ionicons name={icon} size={15} color={theme.colors.accentOn} /> : null}
      <Text style={s.btnTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

function GhostBtn({ onPress, label }) {
  return (
    <TouchableOpacity style={s.btnGhost} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={s.btnGhostTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.md, backgroundColor: theme.colors.background },
  errText: { ...theme.typography.body, textAlign: "center" },

  title: { ...theme.typography.title, color: theme.colors.text },
  subtitle: { ...theme.typography.subtitle, marginTop: 2, marginBottom: theme.spacing.md },
  subtitleAlone: { marginBottom: theme.spacing.xl },
  waiting: {
    ...theme.typography.small, lineHeight: 18, color: theme.colors.text,
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },

  timeline: { gap: 0 },
  stepRow: { flexDirection: "row", gap: theme.spacing.md },
  rail: { alignItems: "center", width: 20 },
  dot: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  dotActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  dotDone: { borderColor: theme.colors.success, backgroundColor: theme.colors.success },
  dotBlocked: { borderColor: theme.colors.danger, backgroundColor: theme.colors.danger },
  railLine: { flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 4 },

  card: { flex: 1, paddingBottom: theme.spacing.xl },
  cardActive: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.primaryMuted,
    borderRadius: theme.radius.md, padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl, paddingBottom: theme.spacing.lg,
    ...theme.shadow.sm,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.sm },
  stepTitle: { ...theme.typography.sectionTitle, color: theme.colors.text, flexShrink: 1 },
  stepTitleMuted: { color: theme.colors.textMuted },
  owner: { ...theme.typography.small, fontWeight: "700" },
  ownerActive: {
    color: theme.colors.accentOn, backgroundColor: theme.colors.primary,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.pill, overflow: "hidden",
  },

  amount: { ...theme.typography.title, fontSize: 22, marginTop: theme.spacing.sm },
  body: { ...theme.typography.body, lineHeight: 22, marginTop: theme.spacing.sm },
  note: { ...theme.typography.small, lineHeight: 17, marginTop: theme.spacing.sm },
  why: { ...theme.typography.small, color: theme.colors.accent, fontWeight: "700", marginTop: theme.spacing.md },
  whyBody: { ...theme.typography.small, lineHeight: 17, marginTop: theme.spacing.xs },
  disputeReason: { ...theme.typography.body, color: theme.colors.danger, fontWeight: "700", marginTop: theme.spacing.sm },

  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill,
    paddingVertical: 12, paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.md,
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt: { color: theme.colors.accentOn, fontWeight: "800" },
  btnGhost: {
    alignItems: "center", justifyContent: "center",
    borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border,
    paddingVertical: 12, paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm,
  },
  btnGhostTxt: { color: theme.colors.text, fontWeight: "700" },

  problem: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: theme.spacing.lg,
  },
  problemTxt: { ...theme.typography.small, textDecorationLine: "underline" },
});
