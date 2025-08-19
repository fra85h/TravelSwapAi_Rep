import React, { useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Animated
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";

export default function OfferCard({
  category,
  title,
  dates,
  price,
  imageUrl,
  onMatchPress,
  onPress
}) {
  const { t } = useI18n();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 400, useNativeDriver: true })
    ]).start();
  }, []);

  // Traduzione categoria
  const translatedCategory = useMemo(() => {
    const raw = String(category || "").toLowerCase();
    if (raw.includes("hotel")) return t("offers.hotels", "Hotel");
    if (raw.includes("train") || raw.includes("treno")) return t("offers.trains", "Treni");
    if (raw.includes("flight") || raw.includes("volo")) return t("offers.flights", "Voli");
    return category ?? ""; // fallback: mostra com'è arrivata
  }, [category, t]);

  // Icona/colore coerenti con la categoria originale
  const categoryColor = useMemo(() => {
    const raw = String(category || "").toLowerCase();
    if (raw.includes("hotel")) return "#007AFF";
    if (raw.includes("train") || raw.includes("treno")) return "#34C759";
    if (raw.includes("flight") || raw.includes("volo")) return "#8B5CF6";
    return "#111827";
  }, [category]);

  const categoryIcon = useMemo(() => {
    const raw = String(category || "").toLowerCase();
    if (raw.includes("hotel")) return "bed-outline";
    if (raw.includes("train") || raw.includes("treno")) return "train-outline";
    if (raw.includes("flight") || raw.includes("volo")) return "airplane-outline";
    return "pricetag-outline";
  }, [category]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY }] }}>
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
        <ImageBackground
          source={{ uri: imageUrl }}
          style={styles.image}
          imageStyle={styles.imageRadius}
        >
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.7)"]}
            style={styles.gradient}
          />

          {/* Categoria */}
          <View style={[styles.badge, { backgroundColor: categoryColor }]}>
            <Ionicons name={categoryIcon} size={14} color="#fff" />
            <Text style={styles.badgeText}>{translatedCategory}</Text>
          </View>

          {/* Pulsante AI Matching */}
          <TouchableOpacity
            style={styles.matchBtn}
            onPress={onMatchPress}
            accessibilityLabel={t("offers.matchAi", "AI Matching")}
          >
            <Ionicons name="sparkles-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </ImageBackground>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.dates}>{dates}</Text>
          <Text style={styles.price}>{price}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
    overflow: "hidden"
  },
  image: {
    height: 180,
    justifyContent: "space-between"
  },
  imageRadius: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },
  gradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "60%"
  },
  badge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    marginLeft: 4,
    fontWeight: "600"
  },
  matchBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 8,
    borderRadius: 20
  },
  info: {
    padding: 12
  },
  title: {
    fontSize: 16,
    fontWeight: "600"
  },
  dates: {
    fontSize: 14,
    color: "#666",
    marginVertical: 2
  },
  price: {
    fontSize: 16,
    fontWeight: "700",
    color: "#007AFF"
  },
  pubDate: {
    marginTop: 2,
    color: "#6B7280",
    fontSize: 11,
  },
});
