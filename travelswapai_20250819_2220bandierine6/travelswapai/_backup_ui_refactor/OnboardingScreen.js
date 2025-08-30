import React, { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CommonActions } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Button from "../components/ui/Button";
import { theme } from "../lib/theme";
import Button from "../components/ui/Button";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import LanguageSwitcher from "./LanguageSwitcher"; // lasciato invariato come nel tuo import

// Persist onboarding flag quickly (no await)
const markSeen = () => AsyncStorage.setItem("hasSeenOnboarding", "1").catch(() => {});
const AnimatedLG = Animated.createAnimatedComponent(LinearGradient);
const { width } = Dimensions.get("window");

const SLIDES = [
  { key: "1", title: "onboarding.welcomeTitle", text: "onboarding.welcomeText" },
  { key: "2", title: "onboarding.hotelTitle", text: "onboarding.hotelText" },
  { key: "3", title: "onboarding.matchingTitle", text: "onboarding.matchingText" }
];

export default function OnboardingScreen({ navigation }) {
  const { t, setLang } = useI18n();

  const rotateAnim = useRef(new Animated.Value(0)).current;
  const shineX = useRef(new Animated.Value(-200)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 4500, useNativeDriver: true })
    ).start();

    const loopShine = () => {
      shineX.setValue(-200);
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(shineX, { toValue: 200, duration: 1200, useNativeDriver: true })
      ]).start(loopShine);
    };
    loopShine();
  }, []);

  const [index, setIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const onScrollIndex = ({ nativeEvent: { contentOffset: { x } } }) => {
    const i = Math.round(x / width);
    if (i !== index) setIndex(i);
  };
  const listRef = useRef(null);

  const goToOffers = () =>
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "Login" }],
      })
    );

  const onNext = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      // PRIMA andava a MainTabs: ora portiamo a Login
      navigation.replace("Login");
      // oppure:
      // goToOffers();
    }
  };

  const onSkip = () => { markSeen(); navigation.replace("Login"); };

  // Component: moneta 3D con doppia faccia (evita l'effetto "mezzo logo")
  const LogoCoin = ({ size = 140 }) => {
    const spinFront = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
    const spinBack  = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "540deg"] });
    const scale = rotateAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.88, 1] });

    return (
      <View style={{ alignSelf: "center", marginBottom: 16 }}>
        <View style={{ width: size, height: size }}>
          {/* Faccia frontale */}
          <Animated.Image
            source={require("../assets/logo.png")}
            style={[
              styles.logoBase(size),
              {
                backfaceVisibility: "hidden",
                transform: [{ perspective: 900 }, { rotateY: spinFront }, { scale }]
              }
            ]}
            resizeMode="contain"
          />
          {/* Faccia posteriore */}
          <Animated.Image
            source={require("../assets/logo.png")}
            style={[
              styles.logoBase(size),
              {
                position: "absolute",
                top: 0,
                left: 0,
                backfaceVisibility: "hidden",
                transform: [{ perspective: 900 }, { rotateY: spinBack }, { scale }]
              }
            ]}
            resizeMode="contain"
          />
          {/* Riflesso diagonale */}
          <AnimatedLG
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.5)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            pointerEvents="none"
            style={{
              position: "absolute",
              top: -20,
              left: -60,
              width: 120,
              height: size + 40,
              transform: [{ translateX: shineX }, { rotate: "20deg" }],
              borderRadius: 16
            }}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 🌍 Bandierine in alto a destra (overlay fisso) */}
      <View style={styles.langWrap}>
        <LanguageSwitcher />
      </View>

      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(i) => i.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: "center" }}
        getItemLayout={(data, i) => ({ length: width, offset: width * i, index: i })}
        // ✅ Animated.event + listener che aggiorna l’indice
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true, listener: onScrollIndex }
        )}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          setIndex(newIndex);
        }}
        renderItem={({ item }) => (
          <View style={{ width, paddingHorizontal: 24, paddingTop: 40 }}>
            {/* Logo */}
            <LogoCoin size={140} />
            {/* Testi della slide */}
            <Text style={styles.title}>{t(item.title)}</Text>
            <Text style={styles.text}>{t(item.text)}</Text>
          </View>
        )}
        getItemLayout={(data, i) => ({ length: width, offset: width * i, index: i })}
      />

      {/* Indicatori */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const dotWidth = scrollX.interpolate({ inputRange, outputRange: [8, 20, 8], extrapolate: "clamp" });
          const opacity  = scrollX.interpolate({ inputRange, outputRange: [0.3, 1, 0.3], extrapolate: "clamp" });
          return <Animated.View key={i} style={[styles.dot, { width: dotWidth, opacity }]} />;
        })}
      </View>

      {/* Pulsanti */}
      <View style={styles.actions}>
        <TouchableOpacity onPress={onSkip} style={[styles.btn, styles.btnGhost]}>
          <Text style={[styles.btnText, { color: "#111" }]}>Salta</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNext} style={styles.btn}>
          <Text style={styles.btnText}>{index === SLIDES.length - 1 ? "Comincia" : "Avanti"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const handlePrimary = () => {
  if (index < SLIDES.length - 1) {
    listRef.current?.scrollToOffset({
      offset: (index + 1) * width,
      animated: true,
    });
  } else { markSeen(); navigation.replace("Login"); }
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  gradient: { flex: 1 },
  langWrap: { position: "absolute", top: 12, right: 16, zIndex: 10 },
  page: { flex:1, alignItems:"center", justifyContent:"center", paddingHorizontal:24, paddingTop:24, paddingBottom:18 },
  card: { backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width:"100%", borderWidth:1, borderColor: theme.colors.border },
  title: { fontSize: 24, fontWeight: "800", textAlign: "center", color: theme.colors.text },
  text: { fontSize: 16, color: theme.colors.textMuted, textAlign: "center", marginTop: 8 },
  dotsRow: { flexDirection:"row", justifyContent:"center", alignItems:"center", marginTop:18, gap:8 },
  dot: { height: 8, width: 8, borderRadius: 999, backgroundColor: "#111" },
  actions: { flexDirection:"row", justifyContent:"space-between", gap:12, marginTop:16 },
  logoBase: (size) => ({ width: size, height: size }),
});
