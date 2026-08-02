// lib/passwordRecovery.js — segnala che è in corso un reset password.
//
// Serve a distinguere due cose che per Supabase sono identiche e per
// l'utente no: una sessione ottenuta accedendo, e la sessione di recupero
// che nasce aprendo il link ricevuto per email. Sono lo stesso oggetto, e
// `useAuth().session` non le distingue.
//
// Senza questo flag succede quanto osservato in produzione: il link di
// reset stabilisce la sessione, RootNavigator vede `session` valorizzata e
// porta dentro l'app — l'utente si ritrova autenticato senza aver mai
// scelto la nuova password, cioè esattamente ciò che era andato a fare. La
// vecchia password, per giunta, resta valida.
//
// Finché il flag è alzato, RootNavigator tratta la sessione come assente:
// il ramo di route non cambia, la schermata di reset non viene smontata, e
// i passaggi intermedi riservati a chi entra (consenso legale, preferenze)
// non si intromettono.
//
// Volutamente fuori da React: il flag va alzato in modo sincrono, un
// istante PRIMA di `setSession`, altrimenti fra l'arrivo della sessione e
// il ri-render resta una finestra in cui l'app porta dentro comunque.
import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set();

const emit = () => {
  for (const l of listeners) l();
};

export function beginPasswordRecovery() {
  if (active) return;
  active = true;
  emit();
}

export function endPasswordRecovery() {
  if (!active) return;
  active = false;
  emit();
}

export function isPasswordRecoveryActive() {
  return active;
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function usePasswordRecovery() {
  return useSyncExternalStore(subscribe, isPasswordRecoveryActive, isPasswordRecoveryActive);
}

// Solo per i test: riporta il modulo allo stato iniziale senza notificare.
export function __resetPasswordRecoveryForTests() {
  active = false;
  listeners.clear();
}
