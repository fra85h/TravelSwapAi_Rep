// Nessuna frase scritta a mano dentro il JSX.
//
// La parità i18n (uiCopy.test.js) verifica che le tre lingue abbiano le
// stesse chiavi. Non vede il caso opposto, ed è quello che è successo: una
// frase scritta direttamente nel componente non ha nessuna chiave, quindi
// non manca da nessun dizionario e nessun controllo se ne accorge. Chi usa
// l'app in inglese o spagnolo se la trova in italiano.
//
// Trovate così: la spiegazione dell'affidabilità in "Crea annuncio", la
// scheda dei suggerimenti, il pulsante di stima prezzo, e una riga
// "model: gpt-4o-mini" nel dettaglio annuncio — che oltre a non essere
// tradotta nominava un pezzo del sistema a chi voleva solo capire perché
// quell'annuncio gli veniva proposto.
//
// COME FUNZIONA: si legge l'albero sintattico e si guardano i nodi JSXText,
// cioè il testo letterale che finisce a schermo. Tutto ciò che sta fra
// graffe — `t(...)`, variabili, ternari — non è un JSXText e non viene
// nemmeno guardato. Nessun falso positivo da regex.
//
// Il parser arriva da @babel/core (già fra le devDependencies) e non da
// @babel/parser: dichiarare quest'ultimo a parte avrebbe alzato di tre
// pacchetti la catena Babel condivisa con Metro e Jest, cioè avrebbe toccato
// il bundle per un controllo sui testi. `configFile: false` serve a leggere
// il file così com'è, senza applicare i preset del progetto.
import fs from "fs";
import path from "path";
import { parseSync } from "@babel/core";

const OPZIONI_PARSER = {
  configFile: false,
  babelrc: false,
  parserOpts: { sourceType: "module", plugins: ["jsx"] },
};

const RADICE = path.join(__dirname, "..");
const CARTELLE = ["screens", "components"];

// Eccezioni motivate. Il nome del marchio non si traduce: "TravelSwap" resta
// TravelSwap in tutte e tre le lingue, e metterlo in un dizionario
// significherebbe solo dare a qualcuno la possibilità di sbagliarlo.
const AMMESSE = new Set(["TravelSwap"]);

function camminaAst(nodo, visita) {
  if (!nodo || typeof nodo !== "object") return;
  if (Array.isArray(nodo)) {
    for (const figlio of nodo) camminaAst(figlio, visita);
    return;
  }
  if (typeof nodo.type === "string") visita(nodo);
  for (const chiave of Object.keys(nodo)) {
    if (chiave === "loc" || chiave === "leadingComments" || chiave === "trailingComments") continue;
    camminaAst(nodo[chiave], visita);
  }
}

/** Il testo letterale di un file, con la riga in cui si trova. */
function frasiHardcoded(file) {
  const ast = parseSync(fs.readFileSync(file, "utf8"), { ...OPZIONI_PARSER, filename: file });
  const colpevoli = [];
  camminaAst(ast, (n) => {
    if (n.type !== "JSXText") return;
    const testo = n.value.replace(/\s+/g, " ").trim();
    // Tre lettere di fila = è una parola. Sotto quella soglia restano solo
    // separatori e simboli: "•", "·", "€", "—", "✓".
    if (!/[A-Za-zÀ-ù]{3}/.test(testo)) return;
    if (AMMESSE.has(testo)) return;
    colpevoli.push(`${path.relative(RADICE, file)}:${n.loc.start.line} → "${testo.slice(0, 60)}"`);
  });
  return colpevoli;
}

function fileJsx(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fileJsx(p));
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("l'interfaccia parla la lingua dell'utente", () => {
  const files = CARTELLE.flatMap((c) => fileJsx(path.join(RADICE, c)));

  it("ci sono schermate e componenti da controllare", () => {
    // Se un refactor sposta le cartelle, il test deve fallire invece di
    // passare a vuoto su zero file — è il modo in cui un controllo smette di
    // controllare senza che nessuno se ne accorga.
    expect(files.length).toBeGreaterThan(20);
  });

  it("il controllo vede davvero una frase scritta a mano", () => {
    // Un test che non sa fallire non protegge niente: qui si verifica che
    // riconosca una frase piantata apposta, prima di fidarsi del suo "zero".
    const finto = `
      const C = () => (
        <View>
          {cond ? <Text>{t("k", "tradotto")}</Text> : null}
          <Text>Frase scritta a mano</Text>
        </View>
      );`;
    const ast = parseSync(finto, { ...OPZIONI_PARSER, filename: "finto.js" });
    const trovate = [];
    camminaAst(ast, (n) => {
      if (n.type === "JSXText" && /[A-Za-zÀ-ù]{3}/.test(n.value)) trovate.push(n.value.trim());
    });
    expect(trovate).toEqual(["Frase scritta a mano"]);
  });

  it("nessuna frase è scritta a mano nel JSX invece che nel dizionario", () => {
    const colpevoli = files.flatMap(frasiHardcoded);
    expect(colpevoli).toEqual([]);
  });
});
