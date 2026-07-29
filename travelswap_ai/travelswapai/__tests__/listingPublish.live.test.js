// Test funzionale LIVE del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 1 "Pubblicazione annuncio (account A)", step 1+3): colpisce il
// Supabase VERO del progetto (stesso .env dell'app, non un mock) con un
// account usa-e-getta, esattamente come fa l'app (screens/CreateListingScreen.js
// → lib/db.js insertListing()), quindi copre anche RLS e i trigger DB che il
// test mockato (server/test/createListingPublish.test.js) non può vedere.
//
// Esegui con `npm run test:live` (mai con `npx jest` di default): richiede
// rete verso Supabase e SCRIVE una riga vera, cancellata a fine test.
//
// Limite noto: l'utente Auth usa-e-getta creato qui NON viene cancellato
// (richiederebbe la Admin API con SUPABASE_SERVICE_ROLE_KEY, non disponibile
// in questo checkout) — resta nel progetto, solo l'annuncio viene ripulito.
import { supabase } from "../lib/supabase";
import { insertListing } from "../lib/db";

function randomEmail() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@travelswap-test.invalid`;
}

test("[LIVE] Pubblicazione annuncio (account A): treno VENDO, tratta reale, data futura, prezzo", async () => {
  const email = randomEmail();
  const password = `Test${Math.random().toString(36).slice(2)}!9`;

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) throw signUpError;
  if (!signUpData.session) {
    throw new Error(
      "signUp non ha restituito una sessione attiva: probabile conferma email obbligatoria " +
      "sul progetto Supabase (Auth → Providers → Email → 'Confirm email'). " +
      "Con la conferma email attiva questo test non può autenticarsi da solo."
    );
  }
  const accountA = signUpData.user;

  const departAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7 giorni
  const arriveAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(); // +3h

  let listing;
  try {
    listing = await insertListing({
      type: "train",
      title: "Roma → Milano, Frecciarossa 9506",
      description: "Biglietto singolo, non cambiabile, ceduto per impegno improvviso.",
      cerco_vendo: "VENDO",
      route_from: "Roma",
      route_to: "Milano",
      depart_at: departAt,
      arrive_at: arriveAt,
      price: 45,
    });

    // Stesso "atteso" della checklist manuale, step 3 — qui verificato contro
    // il DB vero (RLS + trigger inclusi, non un fake):
    expect(listing.status).toBe("active");
    expect(listing.cerco_vendo).toBe("VENDO");
    expect(listing.type).toBe("train");
    expect(listing.route_from).toBe("Roma");
    expect(listing.route_to).toBe("Milano");
    expect(listing.price).toBe(45);
    expect(listing.user_id).toBe(accountA.id);
    expect(listing.id).toBeTruthy();
  } finally {
    if (listing?.id) {
      await supabase.from("listings").delete().eq("id", listing.id);
    }
  }
});
