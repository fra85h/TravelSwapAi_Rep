// Setup dei test *.live.test.js: NIENTE valori fittizi per Supabase (a
// differenza di jest.setup.js) — carica il vero .env del progetto, lo
// stesso letto da Expo/EAS, così lib/supabase.js si connette al progetto
// reale invece di lanciare "Variabili mancanti".
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
