import { View, Text, TouchableOpacity, Image, StyleSheet } from "react-native";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

export default function LanguageSwitcher({ large = false }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <View style={large ? styles.largeWrap : undefined}>
      {large && <Text style={styles.label}>{t("onboarding.languageLabel", "Lingua")}</Text>}
      <View style={[styles.container, large && styles.containerLarge]}>
        <TouchableOpacity onPress={() => setLocale("it")}>
          <Image source={{ uri: "https://flagcdn.com/w20/it.png" }} style={[styles.flag, large && styles.flagLarge, locale === "it" && styles.active]} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setLocale("en")}>
          <Image source={{ uri: "https://flagcdn.com/w20/gb.png" }} style={[styles.flag, large && styles.flagLarge, locale === "en" && styles.active]} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setLocale("es")}>
          <Image source={{ uri: "https://flagcdn.com/w20/es.png" }} style={[styles.flag, large && styles.flagLarge, locale === "es" && styles.active]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", gap: 8, backgroundColor: "white", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  flag: { width: 28, height: 20, borderRadius: 4, opacity: 0.7 },
  active: { opacity: 1, borderWidth: 1, borderColor: "#111827" },
  largeWrap: { alignItems: "flex-end" },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.textMuted,
    marginBottom: 4,
    marginRight: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  containerLarge: { paddingHorizontal: 10, paddingVertical: 8, gap: 10 },
  flagLarge: { width: 36, height: 26, borderRadius: 5 },
});
