// Una scelta fra più di due opzioni non può passare da Alert.alert.
//
// Sul web `Alert.alert` di React Native è un no-op, e lo shim in
// lib/webAlert.js lo rimappa sui dialoghi del browser. Ma il browser ha solo
// `alert()` (un pulsante) e `confirm()` (due): con tre opzioni o più, lo
// shim è costretto a mostrarne due e a eseguire SEMPRE la prima non-cancel.
//
// Dove questo mordeva davvero: la segnalazione di un problema. In chat 1:1
// il motivo partiva sempre come "non ho ricevuto il biglietto"; nella catena
// a 3 la segnalazione partiva contro il primo partecipante dell'elenco E col
// primo motivo — due dati sbagliati su due, in una contestazione che blocca
// lo scambio di tre persone. Nessuno se ne accorgeva, perché sul telefono
// funzionava benissimo.
//
// Il primo test è una guardia strutturale: cerca gli Alert con tre o più
// pulsanti in tutte le schermate. Se qualcuno ne riscrive uno, fallisce qui
// invece che in produzione su web.
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");

/** Il testo dell'argomento di una chiamata, bilanciando le parentesi. */
function argomento(s, apertura) {
  let livello = 0;
  for (let i = apertura; i < s.length; i++) {
    if (s[i] === "(") livello++;
    else if (s[i] === ")") {
      livello--;
      if (livello === 0) return s.slice(apertura + 1, i);
    }
  }
  return "";
}

function fileDaControllare() {
  const out = [];
  for (const dir of ["screens", "components"]) {
    const base = path.join(RADICE, dir);
    const visita = (d) => {
      for (const voce of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, voce.name);
        if (voce.isDirectory()) visita(p);
        else if (voce.name.endsWith(".js")) out.push(p);
      }
    };
    if (fs.existsSync(base)) visita(base);
  }
  return out;
}

function alertConTroppePossibilita(testo) {
  const trovati = [];
  const re = /Alert\.alert\s*\(/g;
  let m;
  while ((m = re.exec(testo))) {
    const arg = argomento(testo, m.index + m[0].length - 1);
    const k = arg.lastIndexOf("[");
    if (k < 0) continue;
    const blocco = arg.slice(k);
    // I pulsanti scritti a mano più quelli generati da uno spread: la
    // segnalazione nella catena a 3 costruiva l'elenco con .map(), e per
    // questo era sfuggita al primo controllo che feci.
    const n =
      (blocco.match(/\btext\s*:/g) || []).length +
      (blocco.match(/\.map\(/g) || []).length;
    if (n >= 3) trovati.push({ pulsanti: n, riga: testo.slice(0, m.index).split("\n").length });
  }
  return trovati;
}

describe("scelte multiple", () => {
  it("nessuna schermata chiede più di due cose con un Alert", () => {
    const colpevoli = [];
    for (const f of fileDaControllare()) {
      const testo = fs.readFileSync(f, "utf8");
      for (const t of alertConTroppePossibilita(testo)) {
        colpevoli.push(`${path.relative(RADICE, f)}:${t.riga} (${t.pulsanti} pulsanti)`);
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it("il controllo funziona davvero", () => {
    // Senza questo, la guardia sopra passerebbe anche se il rilevatore fosse
    // rotto — ed è già successo: la prima versione contava i "text:" in una
    // finestra di caratteri e prendeva lucciole per lanterne.
    const finto = `
      Alert.alert("t", "m", [
        { text: "uno", onPress: a },
        { text: "due", onPress: b },
        { text: "tre", onPress: c },
        { text: "annulla", style: "cancel" },
      ]);`;
    expect(alertConTroppePossibilita(finto)).toHaveLength(1);

    // Due pulsanti vanno benissimo: confirm() li regge.
    const ok = `Alert.alert("t", "m", [{ text: "ok", onPress: a }, { text: "no", style: "cancel" }]);`;
    expect(alertConTroppePossibilita(ok)).toHaveLength(0);

    // E deve vedere anche l'elenco costruito con uno spread.
    const conMap = `Alert.alert("t", "m", [...gente.map((p) => ({ text: p.nome })), { text: "annulla", style: "cancel" }]);`;
    expect(alertConTroppePossibilita(conMap)).toHaveLength(1);
  });
});

// La segnalazione nella catena a 3 fa due domande in fila. La regola di quale
// passo mostrare è pura e vale la pena fissarla: con un solo interlocutore la
// domanda "contro chi" non ha senso e va saltata, come faceva la versione a
// due Alert.
function primoPasso(altriPartecipanti) {
  if (!altriPartecipanti.length) return null;
  return altriPartecipanti.length === 1
    ? { tipo: "motivo", participant: altriPartecipanti[0] }
    : { tipo: "chi" };
}

describe("segnalazione nella catena a 3", () => {
  it("con due interlocutori chiede prima contro chi", () => {
    expect(primoPasso([{ userId: "a" }, { userId: "b" }])).toEqual({ tipo: "chi" });
  });

  it("con un solo interlocutore va dritta al motivo", () => {
    expect(primoPasso([{ userId: "a" }])).toEqual({ tipo: "motivo", participant: { userId: "a" } });
  });

  it("senza interlocutori non apre niente", () => {
    // Il chiamante mostra un errore: aprire un foglio vuoto sarebbe peggio.
    expect(primoPasso([])).toBe(null);
  });
});
