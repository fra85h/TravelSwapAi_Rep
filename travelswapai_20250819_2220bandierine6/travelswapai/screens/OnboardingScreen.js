// screens/OnboardingScreen.js
import React, { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, CommonActions } from "@react-navigation/native";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Platform,
  Image,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import LanguageSwitcher from "./LanguageSwitcher";

// --- util una sola volta ---
const markSeen = () => AsyncStorage.setItem("hasSeenOnboarding", "1").catch(() => {});
const { width } = Dimensions.get("window");

// solo CHIAVI i18n: i testi veri li prende t()
const SLIDES = [
  { key: "1", title: "onboarding.welcomeTitle",  text: "onboarding.welcomeText" },
  { key: "2", title: "onboarding.hotelTitle",    text: "onboarding.hotelText" },
  { key: "3", title: "onboarding.matchingTitle", text: "onboarding.matchingText" },
];

export default function OnboardingScreen() {
  const { t } = useI18n();
  const nav = useNavigation();
  const scrollRef = useRef(null);
  const [index, setIndex] = useState(0);

  // animazione rotazione asse Y (ruota su se stessa, effetto moneta)
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 5000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [spinValue]);

  const spinY = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const goHome = () => {
    markSeen();
    nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: "Login" }] }));
  };

  const onNext = () => {
    if (index >= SLIDES.length - 1) return goHome();
    const next = index + 1;
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  const onScrollEnd = (e) => {
    const newIdx = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newIdx !== index) setIndex(newIdx);
  };

  return (
    <View style={styles.root}>
      {/* TOP: bandierine in safe area */}
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={styles.langWrap}>
          <LanguageSwitcher />
        </View>
      </SafeAreaView>

      {/* corpo */}
      <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          contentContainerStyle={{ alignItems: "center" }}
        >
          {SLIDES.map((s) => (
            <View key={s.key} style={[styles.page, { width }]}>
              <View style={styles.card}>
                {/* LOGO: rotazione asse Y + riflesso, senza alcuno sfondo */}
                <Animated.View
                  style={{
                    transform: [{ perspective: 800 }, { rotateY: spinY }],
                    marginBottom: 16,
                  }}
                >
                  <View>
                    <Image
                      source={require("../assets/logo.png")}
                      style={{ width: 160, height: 160 }}
                      resizeMode="contain"
                    />
                    {/* riflesso lucido leggero */}
                    <LinearGradient
                      colors={["rgba(255,255,255,0.35)", "transparent"]}
                      style={styles.gloss}
                    />
                  </View>
                </Animated.View>

                {/* Testi */}
                <Text style={styles.title} numberOfLines={2}>{t(s.title)}</Text>
                <Text style={styles.text}  numberOfLines={3}>{t(s.text)}</Text>
              </View>

              {/* Dots */}
              <View style={styles.dotsRow}>
                {SLIDES.map((_, i) => (
                  <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </LinearGradient>

      {/* BOTTOM: Salta / Avanti in safe area */}
      <SafeAreaView edges={["bottom"]} style={styles.safeBottom}>
        <View style={styles.bottomBar}>
          <TouchableOpacity onPress={goHome} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.bottomText}>{t("common.skip")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onNext} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.bottomText}>
              {index === SLIDES.length - 1 ? t("common.start") : t("common.next")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  // top
  safeTop: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  langWrap: {
    alignItems: "flex-end",
    paddingRight: 12,
    paddingTop: Platform.OS === "android" ? 8 : 0,
  },
  // slide
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
  },
  // card senza sfondo/riquadro bianco
  card: {
    backgroundColor: "transparent", // <-- niente riquadro bianco
    borderRadius: theme.radius.lg,
    padding: 20,
    width: "88%",
    borderWidth: 0,                 // <-- nessun bordo
    borderColor: "transparent",
    alignItems: "center",
    shadowColor: "transparent",     // <-- nessuna ombra
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  title: { fontSize: 24, fontWeight: "800", textAlign: "center", color: theme.colors.text },
  text: { fontSize: 16, color: theme.colors.textMuted, textAlign: "center", marginTop: 8 },
  // dots
  dotsRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 18, gap: 8 },
  dot: { height: 8, width: 8, borderRadius: 999, backgroundColor: "#D1D5DB" },
  dotActive: { width: 16, backgroundColor: theme.colors.boardingText },
  // bottom
  safeBottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  bottomText: { fontSize: 16, fontWeight: "600", color: theme.colors.text },
  // riflesso
  gloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
});
