// Lettura dei link di autenticazione. Il caso che conta davvero è il primo:
// i token del reset password arrivano nel FRAMMENTO, ed è esattamente quello
// che il codice precedente non leggeva (si affidava a Linking.parse, che il
// frammento non lo espone). Se questo test sparisce, il reset password torna
// a rompersi in silenzio: la schermata dice "Link non valido" e nessun log
// segnala un errore, perché nessuna chiamata fallisce — semplicemente non
// viene fatta.
import { parseAuthParams, makeAuthRedirectUrl } from "../lib/authLinks";

describe("parseAuthParams", () => {
  it("legge i token dal frammento di un link di reset (flusso implicito)", () => {
    const url =
      "https://travelswap.app/auth/reset#access_token=abc123&refresh_token=ref456&expires_in=3600&token_type=bearer&type=recovery";
    expect(parseAuthParams(url)).toMatchObject({
      access_token: "abc123",
      refresh_token: "ref456",
      type: "recovery",
    });
  });

  it("legge il code dalla query (flusso PKCE)", () => {
    expect(parseAuthParams("https://travelswap.app/auth/reset?code=pkce-code").code).toBe(
      "pkce-code",
    );
  });

  it("funziona anche con lo schema nativo", () => {
    expect(parseAuthParams("travelswap://auth/reset#access_token=nativo").access_token).toBe(
      "nativo",
    );
  });

  it("riconosce un link scaduto, che arriva senza token", () => {
    const url =
      "https://travelswap.app/auth/reset#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    const params = parseAuthParams(url);
    expect(params.access_token).toBeUndefined();
    expect(params.error_code).toBe("otp_expired");
    expect(params.error_description).toBe("Email link is invalid or has expired");
  });

  it("legge query e frammento insieme, con la query che ha la precedenza", () => {
    const params = parseAuthParams("https://x.test/p?type=query#type=fragment&access_token=t");
    expect(params.type).toBe("query");
    expect(params.access_token).toBe("t");
  });

  it("decodifica i valori percent-encoded", () => {
    expect(parseAuthParams("https://x.test/p#msg=a%20b%2Bc").msg).toBe("a b+c");
  });

  it("non esplode su url vuoti o assenti", () => {
    expect(parseAuthParams(null)).toEqual({});
    expect(parseAuthParams("")).toEqual({});
    expect(parseAuthParams("https://travelswap.app/auth/reset")).toEqual({});
  });
});

describe("makeAuthRedirectUrl", () => {
  // L'ambiente di jest è quello nativo (nessun window): il web si simula
  // aggiungendo un window fittizio, che è poi l'unica cosa che la funzione
  // guarda per capire dove sta girando.
  const withWindow = (origin, fn) => {
    global.window = { location: { origin } };
    try {
      return fn();
    } finally {
      delete global.window;
    }
  };

  it("sul web costruisce un indirizzo assoluto sull'origine corrente", () => {
    // Il caso che si rompeva: Linking.createURL qui restituiva
    // "https:///auth/reset", senza host, e Supabase lo scartava.
    expect(withWindow("https://travelswap.app", () => makeAuthRedirectUrl("/auth/reset"))).toBe(
      "https://travelswap.app/auth/reset",
    );
  });

  it("normalizza il percorso senza slash iniziale", () => {
    expect(withWindow("https://travelswap.app", () => makeAuthRedirectUrl("auth/reset"))).toBe(
      "https://travelswap.app/auth/reset",
    );
  });

  it("in locale segue l'origine su cui gira, porta compresa", () => {
    expect(withWindow("http://localhost:8081", () => makeAuthRedirectUrl("/auth/reset"))).toBe(
      "http://localhost:8081/auth/reset",
    );
  });

  it("fuori dal web resta un deep link con lo schema dell'app", () => {
    expect(makeAuthRedirectUrl("/auth/reset")).toMatch(/^travelswap:\/\//);
  });
});
