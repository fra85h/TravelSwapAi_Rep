import "react-native-gesture-handler/jestSetup";

jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default
);

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// expo-linking (Linking.createURL in App.js) legge lo scheme da qui: senza
// manifest, in test lancia "needs access to the expo-constants manifest".
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    // Object.defineProperty(exports, "__esModule", { enumerable: false })
    // nel modulo reale: uno spread di "actual" da solo lo perde, e senza
    // l'interop tratta l'intero mock come "default" (expoConfig sparisce).
    __esModule: true,
    ...actual,
    default: { ...actual.default, expoConfig: { scheme: "travelswap" } },
  };
});

// lib/supabase.js lancia un errore se queste mancano: in test non serve una
// connessione vera, solo che createClient() non esploda all'import.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
