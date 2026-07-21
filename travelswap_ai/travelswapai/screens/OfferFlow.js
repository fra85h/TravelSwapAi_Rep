// screens/OfferFlow.js — flussi completi Proponi acquisto / Proponi scambio
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getCurrentUser, getPublicListingById } from "../lib/db";
import {
  createOfferBuy,
  createOfferSwap,
  getMyPendingOfferFor,
  cancelOffer,
  listMyActiveListings
} from "../lib/offers";
import { useI18n } from "../lib/i18n";
import { notifyActivityChanged } from "../lib/ActivityContext";
import { theme } from "../lib/theme";

const fmtMoney = (v, c) => (v == null || isNaN(Number(v)) ? null : `${Number(v).toFixed(2)} ${c || "€"}`);

export default function OfferFlow() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t, locale } = useI18n();

  const { mode: modeParam = "BUY", listingId } = route.params || {};
  // normalizza il case: alcuni punti dell'app passano "buy"/"swap" minuscolo
  const mode = String(modeParam).toUpperCase();

  const [me, setMe] = useState(null);
  const [target, setTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // BUY fields
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [message, setMessage] = useState("");

  // SWAP fields
  const [myListings, setMyListings] = useState([]);
  const [selectedMyListing, setSelectedMyListing] = useState(null);

  // Existing pending
  const [pendingOffer, setPendingOffer] = useState(null);
  const isBuy = mode === "BUY";

  // Sottotitolo localizzato: "Treno • Roma Termini → Firenze"
  const fmtMeta = useCallback((l) => {
    const typeLabel = t(`listing.type.${String(l?.type || "").toLowerCase()}`, l?.type || "");
    const from = l?.route_from;
    const to = l?.route_to;
    const where = from ? (to ? `${from} → ${to}` : from) : (l?.location || "-");
    return typeLabel ? `${typeLabel} • ${where}` : where;
  }, [t]);

  // Data del viaggio/soggiorno: mancava del tutto in questa schermata, che
  // decide un'offerta di ACQUISTO/SCAMBIO senza mostrare a quale data si
  // riferisce l'annuncio (né il prezzo richiesto, vedi fmtPrice sotto).
  const fmtWhen = useCallback((l) => {
    const raw = String(l?.type || "").toLowerCase() === "hotel" ? l?.check_in : l?.depart_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    try {
      return d.toLocaleDateString(locale || undefined, { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return d.toLocaleDateString();
    }
  }, [locale]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const u = await getCurrentUser().catch(() => null);
      setMe(u);

      const l = await getPublicListingById(listingId);
      setTarget(l);

      // controlli base
      if (u?.id && l?.user_id === u.id) {
        setError(t("offerFlow.cantOfferOwn", "Non puoi proporre un'offerta al tuo stesso annuncio."));
        return;
      }
      if (l?.status !== "active") {
        setError(t("offerFlow.listingNotActive", "Questo annuncio non è attivo."));
        return;
      }

      // Un'offerta (acquisto o scambio) ha senso SOLO verso un VENDO: un CERCO
      // è una richiesta, non un biglietto che si possa comprare o ricevere.
      if (String(l?.cerco_vendo || "").toUpperCase() === "CERCO") {
        setError(t("offerFlow.targetIsCerco", "Questo è un annuncio di ricerca: non si acquista né si scambia. Se hai il biglietto giusto, pubblicalo come \"Vendo\"."));
        return;
      }

      // pending esistente
      const p = await getMyPendingOfferFor(listingId);
      setPendingOffer(p);

      // carica i miei annunci per SWAP — solo i VENDO: puoi offrire in scambio
      // solo un biglietto che possiedi, non una tua richiesta (CERCO).
      if (!isBuy && u?.id) {
        const mine = await listMyActiveListings();
        setMyListings((mine || []).filter((x) => String(x?.cerco_vendo || "").toUpperCase() === "VENDO"));
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [listingId, isBuy, t]);

  useEffect(() => { load(); }, [load]);

  // Auto-selezione quando c'è un solo annuncio da offrire: niente attrito,
  // la CTA è subito attiva.
  useEffect(() => {
    if (!isBuy && myListings.length === 1 && !selectedMyListing) {
      setSelectedMyListing(myListings[0]);
    }
  }, [isBuy, myListings, selectedMyListing]);

  const canSubmit = useMemo(() => {
    if (!me || !target || pendingOffer) return false;
    if (isBuy) return true; // amount è opzionale
    return !!selectedMyListing;
  }, [me, target, pendingOffer, isBuy, selectedMyListing]);

  const onSubmit = async () => {
    try {
      if (!me) { Alert.alert(t("offerFlow.loginRequiredTitle", "Login richiesto"), t("offerFlow.loginRequiredMsg", "Accedi per inviare proposte.")); return; }
      if (pendingOffer) { Alert.alert(t("offerFlow.alreadySentTitle", "Già inviata"), t("offerFlow.alreadySentMsg", "Hai già una proposta in attesa per questo annuncio.")); return; }

      if (isBuy) {
        const parsed = amount ? Number(amount) : null;
        if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
          Alert.alert(t("offerFlow.invalidAmountTitle", "Importo non valido"), t("offerFlow.invalidAmountMsg", "Inserisci un importo valido oppure lascia vuoto."));
          return;
        }
        // Valuta libera senza vincoli finiva così com'è in offers.currency
        // (minuscolo, valuta inventata, stringa vuota...). Il dominio è
        // EUR-only: normalizziamo e blocchiamo un formato palesemente errato,
        // senza rimuovere il campo (potrebbe servire in futuro).
        const normCurrency = String(currency || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(normCurrency)) {
          Alert.alert(t("offerFlow.invalidCurrencyTitle", "Valuta non valida"), t("offerFlow.invalidCurrencyMsg", "Inserisci un codice valuta di 3 lettere (es. EUR)."));
          return;
        }
        await createOfferBuy(listingId, { amount: parsed, currency: normCurrency, message });
      } else {
        if (!selectedMyListing) {
          Alert.alert(t("offerFlow.selectListingTitle", "Seleziona annuncio"), t("offerFlow.selectListingMsg", "Scegli uno dei tuoi annunci da proporre in scambio."));
          return;
        }
        await createOfferSwap(selectedMyListing.id, listingId, { message });
      }

      notifyActivityChanged();
      Alert.alert(t("offerFlow.sentTitle", "Proposta inviata"), t("offerFlow.sentMsg", "Il proprietario riceverà subito la tua proposta."));
      navigation.goBack();
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    }
  };

  const onCancelPending = async () => {
    try {
      if (!pendingOffer?.id) return;
      await cancelOffer(pendingOffer.id);
      setPendingOffer(null);
      notifyActivityChanged();
      Alert.alert(t("common.ok", "OK"), t("offerFlow.canceled", "Proposta cancellata"));
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator /></View>;
  }
  if (error) {
    return (
      <View style={s.center}>
        <Text style={{ color: theme.colors.danger, marginBottom: 12 }}>{error}</Text>
        <TouchableOpacity style={s.btn} onPress={load}><Text style={s.btnTxt}>{t("common.retry", "Riprova")}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={s.title}>
        {isBuy ? t("offers.proposePurchase", "Proponi acquisto") : t("offers.proposeSwap", "Proponi scambio")}
      </Text>

      {/* Card annuncio target: cosa ricevi (swap) / cosa acquisti (buy) */}
      <Text style={s.eyebrow}>
        {isBuy ? t("offerFlow.buyLabel", "Acquisti") : t("offerFlow.receiveLabel", "Ricevi")}
      </Text>
      <View style={s.target}>
        <Text style={s.tTitle}>{target?.title || t("offerFlow.listing", "Annuncio")}</Text>
        <Text style={s.tMeta}>{fmtMeta(target)}</Text>
        {fmtWhen(target) ? <Text style={s.tMeta}>{fmtWhen(target)}</Text> : null}
        {fmtMoney(target?.price, target?.currency) ? (
          <Text style={s.tPrice}>
            {t("offerFlow.askingPrice", "Prezzo richiesto")}{": "}{fmtMoney(target?.price, target?.currency)}
          </Text>
        ) : null}
      </View>

      {pendingOffer ? (
        <View style={s.pendingBox}>
          <Text style={s.pendingTitle}>{t("offerFlow.pendingAlready", "Hai già una proposta in attesa")}</Text>
          {pendingOffer.message ? <Text style={s.pendingMsg}>{pendingOffer.message}</Text> : null}
          <View style={s.row}>
            <TouchableOpacity style={[s.btnOutline]} onPress={onCancelPending}>
              <Text style={s.btnOutlineTxt}>{t("offerFlow.cancelProposal", "Cancella proposta")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn]} onPress={() => navigation.goBack()}>
              <Text style={s.btnTxt}>{t("common.close", "Chiudi")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : isBuy ? (
        <>
          <Text style={s.label}>{t("offerFlow.amountLabel", "Importo offerto (opzionale)")}</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder={t("offerFlow.amountPlaceholder", "Es. 120.00")}
            keyboardType="decimal-pad"
            style={s.input}
          />
          <Text style={s.label}>{t("offerFlow.currencyLabel", "Valuta")}</Text>
          <TextInput
            value={currency}
            onChangeText={(v) => setCurrency(v.toUpperCase())}
            autoCapitalize="characters"
            maxLength={3}
            style={s.input}
          />
          <Text style={s.label}>{t("offerFlow.messageOptional", "Messaggio (opzionale)")}</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t("offerFlow.addDetailsOrRequests", "Aggiungi dettagli o richieste")}
            style={[s.input, { height: 100, textAlignVertical: "top" }]}
            multiline
          />
          {/* Teaser chat: dice subito che il canale di contatto arriverà
              DOPO l'accettazione — gestisce l'aspettativa e tiene l'accordo
              dentro l'app invece che su contatti esterni. */}
          <Text style={s.chatTeaser}>
            {t("chat.teaserSend", "Dopo l'accettazione potrai chattare con l'altra persona per organizzare lo scambio.")}
          </Text>
          <TouchableOpacity
            style={[s.btn, s.cta, !canSubmit && s.btnDisabled]}
            disabled={!canSubmit}
            onPress={onSubmit}
          >
            <Text style={s.btnTxt}>{t("offerFlow.sendProposal", "Invia proposta")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Freccia di scambio: rende chiara la direzione ricevi ⇄ offri */}
          <View style={s.swapArrow}>
            <Ionicons name="swap-vertical" size={22} color={theme.colors.accent} />
          </View>

          <Text style={s.eyebrow}>{t("offerFlow.offerLabel", "Offri")}</Text>
          <Text style={s.label}>{t("offerFlow.chooseOwnListing", "Scegli un tuo annuncio")}</Text>

          {myListings.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={{ color: theme.colors.textMuted }}>{t("offerFlow.noActiveListings", "Non hai annunci attivi.")}</Text>
              <TouchableOpacity onPress={() => navigation.navigate("CreateListing")} style={{ marginTop: 8 }}>
                <Text style={{ color: theme.colors.accent, fontWeight: "800" }}>
                  {t("offerFlow.createListingCta", "＋ Crea prima un annuncio da offrire in scambio")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            myListings.map((item) => {
              const selected = selectedMyListing?.id === item.id;
              return (
                <TouchableOpacity
                  key={String(item.id)}
                  style={[s.card, selected && s.cardSelected]}
                  onPress={() => setSelectedMyListing(item)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{item.title || t("offerFlow.listing", "Annuncio")}</Text>
                    <Text style={s.cardMeta}>{fmtMeta(item)}</Text>
                  </View>
                  <View style={[s.radio, selected && s.radioOn]}>
                    {selected ? <Ionicons name="checkmark" size={16} color={theme.colors.accentOn} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          <Text style={[s.label, { marginTop: 16 }]}>{t("offerFlow.messageOptional", "Messaggio (opzionale)")}</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t("offerFlow.addDetailsForSwap", "Aggiungi dettagli per lo scambio")}
            style={[s.input, { height: 100, textAlignVertical: "top" }]}
            multiline
          />

          <Text style={s.chatTeaser}>
            {t("chat.teaserSend", "Dopo l'accettazione potrai chattare con l'altra persona per organizzare lo scambio.")}
          </Text>
          <TouchableOpacity
            style={[s.btn, s.cta, !canSubmit && s.btnDisabled]}
            disabled={!canSubmit}
            onPress={onSubmit}
          >
            <Text style={s.btnTxt}>{t("offerFlow.sendProposal", "Invia proposta")}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
  title: { fontFamily: theme.fonts.headingExtraBold, fontSize: 20, marginBottom: 16 },
  eyebrow: {
    fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase",
    color: theme.colors.textMuted, marginBottom: 6,
  },
  chatTeaser: { color: theme.colors.textMuted, fontSize: 12, fontStyle: "italic", marginTop: 8, marginBottom: 8 },
  target: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, marginBottom: 12, backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  tTitle: { fontWeight: "800" },
  tMeta: { color: theme.colors.textMuted, marginTop: 4 },
  tPrice: { color: theme.colors.text, fontWeight: "700", marginTop: 6 },
  swapArrow: { alignItems: "center", marginTop: 2, marginBottom: 10 },
  label: { fontWeight: "700", marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  btn: { backgroundColor: theme.colors.accent, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  cta: { marginTop: 18 },
  btnTxt: { color: theme.colors.accentOn, fontWeight: "800" },
  btnOutline: { borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 12, borderRadius: 12, alignItems: "center", paddingHorizontal: 14 },
  btnOutlineTxt: { color: theme.colors.text, fontWeight: "700" },
  btnDisabled: { opacity: 0.5 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, marginBottom: 10, backgroundColor: theme.colors.surface, ...theme.shadow.sm,
  },
  cardSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  cardTitle: { fontWeight: "800" },
  cardMeta: { color: theme.colors.textMuted, marginTop: 4 },
  radio: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: theme.colors.border,
    alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface,
  },
  radioOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accent },
  emptyBox: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 14, marginBottom: 4, backgroundColor: theme.colors.surface,
  },
  pendingBox: { borderWidth: 1, borderColor: "#F59E0B", backgroundColor: "#FFFBEB", borderRadius: 12, padding: 12, marginTop: 8 },
  pendingTitle: { fontWeight: "800", color: "#92400E" },
  pendingMsg: { marginTop: 6, color: "#92400E" },
  row: { flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "space-between" },
});
