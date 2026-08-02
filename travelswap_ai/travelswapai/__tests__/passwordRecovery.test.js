// Il flag che tiene separata la sessione di recupero da un accesso vero.
//
// Regressione reale: aprendo il link di reset, la sessione veniva
// stabilita correttamente e proprio per questo RootNavigator portava
// l'utente DENTRO l'app, saltando il modulo per la nuova password — che
// restava quindi la vecchia, ancora valida. Il flusso corretto è: link →
// sessione di recupero → l'app continua a comportarsi come se nessuno
// fosse autenticato → nuova password → signOut → login.
import { renderHook, act } from "@testing-library/react-native";
import {
  beginPasswordRecovery,
  endPasswordRecovery,
  isPasswordRecoveryActive,
  usePasswordRecovery,
  __resetPasswordRecoveryForTests,
} from "../lib/passwordRecovery";

describe("passwordRecovery", () => {
  beforeEach(() => __resetPasswordRecoveryForTests());

  it("parte spento", () => {
    expect(isPasswordRecoveryActive()).toBe(false);
  });

  it("si alza e si abbassa", () => {
    beginPasswordRecovery();
    expect(isPasswordRecoveryActive()).toBe(true);
    endPasswordRecovery();
    expect(isPasswordRecoveryActive()).toBe(false);
  });

  it("è sincrono: subito dopo begin il valore è già cambiato", () => {
    // È la proprietà che conta. La schermata alza il flag un istante prima
    // di setSession proprio per non lasciare una finestra in cui la
    // sessione esiste e l'app non sa ancora che è di recupero.
    beginPasswordRecovery();
    expect(isPasswordRecoveryActive()).toBe(true);
  });

  it("chiamate ripetute non cambiano nulla", () => {
    beginPasswordRecovery();
    beginPasswordRecovery();
    expect(isPasswordRecoveryActive()).toBe(true);
    endPasswordRecovery();
    endPasswordRecovery();
    expect(isPasswordRecoveryActive()).toBe(false);
  });

  it("l'hook segue il flag: è così che RootNavigator si accorge del reset", () => {
    const { result } = renderHook(() => usePasswordRecovery());
    expect(result.current).toBe(false);

    act(() => beginPasswordRecovery());
    expect(result.current).toBe(true);

    act(() => endPasswordRecovery());
    expect(result.current).toBe(false);
  });

  it("l'hook si aggancia anche a un reset già in corso al momento del mount", () => {
    beginPasswordRecovery();
    const { result } = renderHook(() => usePasswordRecovery());
    expect(result.current).toBe(true);
  });
});
