import { withTimeout, TIMEOUT_PREFIX } from "../lib/withTimeout";

describe("withTimeout", () => {
  it("lascia passare il risultato se arriva in tempo", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "passo")).resolves.toBe("ok");
  });

  it("lascia passare anche il rifiuto originale, senza mascherarlo", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "passo")).rejects.toThrow(
      "boom",
    );
  });

  it("rifiuta con l'etichetta del passaggio se il tempo scade", async () => {
    jest.useFakeTimers();
    try {
      const p = withTimeout(new Promise(() => {}), 5000, "updateUser");
      const assertion = expect(p).rejects.toThrow(`${TIMEOUT_PREFIX}updateUser`);
      jest.advanceTimersByTime(5000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("spegne il timer quando la promessa si risolve prima", async () => {
    jest.useFakeTimers();
    try {
      await withTimeout(Promise.resolve("ok"), 5000, "passo");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
