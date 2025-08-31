import { View, TouchableOpacity, Image, StyleSheet } from "react-native";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setLocale("it")}>
        <Image source={{ uri: "https://flagcdn.com/w20/it.png" }} style={[styles.flag, locale === "it" && styles.active]} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setLocale("en")}>
        <Image source={{ uri: "https://flagcdn.com/w20/gb.png" }} style={[styles.flag, locale === "en" && styles.active]} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setLocale("es")}>
        <Image source={{ uri: "https://flagcdn.com/w20/es.png" }} style={[styles.flag, locale === "es" && styles.active]} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", gap: 8, backgroundColor: "white", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  flag: { width: 28, height: 20, borderRadius: 4, opacity: 0.7 },
  active: { opacity: 1, borderWidth: 1, borderColor: "#111827" },
});
