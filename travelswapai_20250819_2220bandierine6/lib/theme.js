export const theme = {
  colors: {
    background: "#F8FAFC",
    surface: "#FFFFFF",
    surfaceMuted: "#F3F4F6",
    border: "#E5E7EB",
    text: "#0F172A",
    textMuted: "#6B7280",
   primary: "#4F46E5",      // Indigo 600
   primaryMuted: "#6366F1", // Indigo 500/400 per hover/pressed
    success: "#16A34A",
    danger: "#DC2626",
    warning: "#F59E0B",
    info: "#2563EB",
  },
  radius: { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32 },
  shadow: {
    sm: { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
    md: { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
  },
  typography: {
    title: { fontSize: 22, fontWeight: "800" },
    subtitle: { fontSize: 16, fontWeight: "600", color: "#6B7280" },
    body: { fontSize: 16, color: "#0F172A" },
    small: { fontSize: 12, color: "#6B7280" },
  }
};
export default theme;
