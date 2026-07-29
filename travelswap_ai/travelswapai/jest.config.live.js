// Config separata per i test che colpiscono il Supabase VERO (stesso
// progetto usato da .env, non un progetto di test dedicato — l'app non è
// ancora pubblicata, quindi è sicuro scrivere/cancellare righe finte). Mai
// nella run di default (`npx jest`): solo `npm run test:live`, azione
// esplicita.
const { transform } = require("jest-expo/jest-preset");

module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.live.js"],
  transform: {
    ...transform,
    "\\.mjs$": transform["\\.[jt]sx?$"],
  },
  testMatch: ["<rootDir>/__tests__/**/*.live.test.js"],
  // Le chiamate di rete reali (signUp, insert, delete) sono più lente del
  // solito default di jest (5s).
  testTimeout: 30000,
};
