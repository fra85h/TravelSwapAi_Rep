// Una schermata con campi da compilare deve sapere che esiste la tastiera.
//
// Su iOS la finestra NON si ridimensiona quando la tastiera compare: su
// Android lo fa il sistema, su iOS no. Il contenuto resta dov'è e la tastiera
// ci si appoggia sopra. Sulle schermate di accesso questo voleva dire non
// vedere più il campo che si sta scrivendo e, peggio, non poter raggiungere
// il pulsante: su un telefono piccolo "Accedi" finiva sotto la tastiera.
//
// Questo test è una guardia strutturale con un elenco esplicito di ciò che
// manca ancora. Serve a due cose: che una schermata NUOVA con campi di testo
// non possa nascere senza gestione della tastiera, e che il debito residuo
// resti scritto da qualche parte invece di essere dimenticato.
const fs = require("fs");
const path = require("path");

const SCHERMATE = path.join(__dirname, "..", "screens");

// Schermate con campi di testo che la tastiera non la gestiscono ancora.
// Non è un permesso: è il debito che resta, messo nero su bianco. Chi ne
// sistema una la toglie da qui; nessuno però può AGGIUNGERCENE una nuova
// senza accorgersi di cosa sta facendo.
const ANCORA_SCOPERTE = new Set([
  "HomeScreen.js",
  "OfferFlow.js",
  "PreferencesOnboardingScreen.js",
  "SavedSearchesScreen.js",
]);

const gestisceLaTastiera = (testo) =>
  /KeyboardAvoidingView|KeyboardAware|FormScreen/.test(testo);

const haCampiDiTesto = (testo) => /<TextInput|<Input\b/.test(testo);

describe("tastiera sulle schermate con campi", () => {
  const file = fs.readdirSync(SCHERMATE).filter((f) => f.endsWith(".js"));

  it("nessuna schermata nuova nasce senza gestione della tastiera", () => {
    const scoperte = file.filter((f) => {
      const testo = fs.readFileSync(path.join(SCHERMATE, f), "utf8");
      return haCampiDiTesto(testo) && !gestisceLaTastiera(testo) && !ANCORA_SCOPERTE.has(f);
    });
    expect(scoperte).toEqual([]);
  });

  it("login, recupero e reset password sono coperte", () => {
    // Sono le tre sistemate qui, e sono anche le prime che vede chi si
    // iscrive: se la tastiera copre il pulsante lì, non arriva dentro l'app.
    for (const f of ["LoginScreen.js", "ForgotPasswordScreen.js", "ResetPasswordScreen.js"]) {
      const testo = fs.readFileSync(path.join(SCHERMATE, f), "utf8");
      expect(gestisceLaTastiera(testo)).toBe(true);
    }
  });

  it("l'elenco del debito non contiene schermate già sistemate", () => {
    // Una voce di troppo qui è un buco silenzioso: coprirebbe una schermata
    // che nel frattempo qualcuno ha sistemato, e il giorno che si rompe di
    // nuovo il test non direbbe niente.
    const inutili = [...ANCORA_SCOPERTE].filter((f) => {
      const p = path.join(SCHERMATE, f);
      if (!fs.existsSync(p)) return true;
      const testo = fs.readFileSync(p, "utf8");
      return gestisceLaTastiera(testo) || !haCampiDiTesto(testo);
    });
    expect(inutili).toEqual([]);
  });
});
