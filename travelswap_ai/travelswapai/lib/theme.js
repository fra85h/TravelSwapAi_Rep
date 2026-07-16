// Palette "Swap Gold": indigo profondo come inchiostro/brand, oro come
// accento delle azioni principali (richiama la moneta 3D dell'onboarding
// e il concetto di scambio di valore alla base di TravelSwap).
export const theme = {
  colors: {
    background: "#F9F8FC",
    surface: "#FFFFFF",
    surfaceMuted: "#F4F1F8",
    border: "#E6E2EE",
    text: "#1B2159",
    textMuted: "#6B6F92",

    // "primary" = sfondo chiaro per badge, pill di selezione, avatar, CTA
    // secondari — sempre con testo scuro sopra (boardingText/text). Ritirato
    // il lilla: assorbito nell'ORO tenue per ridurre le tinte in gioco
    // (palette a 3: navy + oro + verde semantico). Ruolo invariato.
    primary: "#F4E7C0",
    primaryMuted: "#E6CE8C", // variante più marcata per bordi/stati pressed/selected

    // Accento oro: riservato ai CTA principali e ai momenti "premium".
    // Non va mai usato come colore di testo su sfondo chiaro (contrasto
    // insufficiente) — per il testo sopra un riempimento oro usare accentOn.
    accent: "#C99A2E",
    accentSoft: "#FBF0D9",
    accentOn: "#1B2159",

    success: "#16A34A",
    danger: "#DC2626",
    warning: "#F59E0B",
    info: "#2563EB",

    // UI CTA color "Boarding pass" (sfondi lavanda tenue per badge/pill secondarie)
    boardingBg: "#EDEBFA",
    boardingText: "#1B2159",
    boardingBgPressed: "#DFDAF3",
  },
  // Font dei titoli (Plus Jakarta Sans, caricato in App.js). Il testo
  // corrente resta sul font di sistema: il display face si usa solo
  // per i titoli, con misura.
  fonts: {
    headingSemibold: "PlusJakartaSans_600SemiBold",
    headingBold: "PlusJakartaSans_700Bold",
    headingExtraBold: "PlusJakartaSans_800ExtraBold",
  },
  radius: { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32 },
  shadow: {
    sm: { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
    md: { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
    lg: { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.14, shadowRadius: 28, elevation: 10 },
  },
  typography: {
    // fontWeight non va impostato insieme a un fontFamily custom: il peso
    // è già "cotto" nel file del font caricato (vedi fonts.heading*).
    title: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 26, letterSpacing: -0.3 },
    sectionTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 17, letterSpacing: -0.2 },
    subtitle: { fontSize: 16, fontWeight: "600", color: "#6B6F92" },
    body: { fontSize: 16, color: "#1B2159" },
    small: { fontSize: 12, color: "#6B6F92" },
  }
};
export default theme;
