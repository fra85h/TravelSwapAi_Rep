// La soglia di versione minima è una funzione che può chiudere fuori
// tutti quanti, quindi va provata come tale.
//
// Il rischio non è simmetrico. Un falso negativo lascia entrare un'app un po'
// vecchia: fastidioso. Un falso positivo blocca chi poteva lavorare
// benissimo, e senza un canale OTA per correggere l'errore quelle persone
// restano fuori fino alla prossima release sullo store. Per questo la regola
// è "nel dubbio si passa", e la maggior parte di questi test difende proprio
// il dubbio.
import { confrontaVersioni, troppoVecchia } from "../lib/appVersion.mjs";

describe("confronto fra versioni", () => {
  it("ordina le tre parti da sinistra a destra", () => {
    expect(confrontaVersioni("1.0.0", "2.0.0")).toBe(-1);
    expect(confrontaVersioni("2.0.0", "1.9.9")).toBe(1);
    expect(confrontaVersioni("1.2.3", "1.2.3")).toBe(0);
    expect(confrontaVersioni("1.10.0", "1.9.0")).toBe(1); // 10 > 9, non "1.1" < "1.9"
  });

  it("le parti mancanti valgono zero", () => {
    expect(confrontaVersioni("1.2", "1.2.0")).toBe(0);
    expect(confrontaVersioni("1", "1.0.0")).toBe(0);
    expect(confrontaVersioni("1.2", "1.2.1")).toBe(-1);
  });

  it("l'etichetta dopo il numero non ordina niente", () => {
    // "1.2.3-beta.1" e "1.2.3" sono la stessa riga per questo scopo: se
    // servisse distinguerle, servirebbe una soglia più fine di una versione.
    expect(confrontaVersioni("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(confrontaVersioni("1.2.4-rc", "1.2.3")).toBe(1);
  });

  it("una versione illeggibile è 'non lo so', non 'più vecchia'", () => {
    for (const v of [null, undefined, "", "   ", "boh", "v-uno"]) {
      expect(confrontaVersioni(v, "1.0.0")).toBe(null);
      expect(confrontaVersioni("1.0.0", v)).toBe(null);
    }
  });
});

describe("la soglia", () => {
  it("senza soglia impostata non blocca mai", () => {
    // È lo stato predefinito: il meccanismo c'è ma dorme finché qualcuno non
    // decide una soglia. Deve essere impossibile bloccare per distrazione.
    for (const soglia of [null, undefined, "", "   "]) {
      expect(troppoVecchia("0.0.1", soglia)).toBe(false);
    }
  });

  it("blocca solo chi è indietro", () => {
    expect(troppoVecchia("1.0.0", "1.1.0")).toBe(true);
    expect(troppoVecchia("1.1.0", "1.1.0")).toBe(false); // pari passa: la soglia è "da questa in su"
    expect(troppoVecchia("1.2.0", "1.1.0")).toBe(false);
  });

  it("nel dubbio si passa", () => {
    // Se non si riesce a leggere una delle due versioni, si va avanti. Una
    // soglia che sbaglia è peggio di una soglia che non scatta.
    expect(troppoVecchia("boh", "1.1.0")).toBe(false);
    expect(troppoVecchia("1.0.0", "chissà")).toBe(false);
    expect(troppoVecchia(undefined, "1.1.0")).toBe(false);
  });

  it("la versione attuale dell'app non è bloccata da se stessa", () => {
    // Guardia contro l'errore più stupido e più probabile: mettere come
    // soglia la versione che si sta pubblicando e scoprire che blocca
    // proprio lei per un fuori-di-uno.
    const attuale = require("../app.json").expo.version;
    expect(troppoVecchia(attuale, attuale)).toBe(false);
  });
});
