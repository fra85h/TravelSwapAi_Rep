// Config di Jest per l'app RN/Expo. Preset ufficiale "jest-expo" (allineato
// alla versione di Expo SDK installata, ~54): applica in automatico il
// transform babel-preset-expo e i mock dei moduli nativi Expo/RN, senza
// bisogno di un babel.config.js dedicato nel progetto.
// Il preset non transforma i .mjs (lib/*.mjs, condivisi col backend): senza
// questa aggiunta jest li tratta come CommonJS grezzo e fallisce su `export`.
const { transform } = require("jest-expo/jest-preset");

module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  transform: {
    ...transform,
    "\\.mjs$": transform["\\.[jt]sx?$"],
  },
};
