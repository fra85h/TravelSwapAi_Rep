// components/ImageCarousel.js — carosello foto (sola lettura) per il dettaglio annuncio
import React, { useState } from "react";
import { View, Image, ScrollView, StyleSheet, Dimensions } from "react-native";
import { theme } from "../lib/theme";

const { width } = Dimensions.get("window");

/**
 * @param {string[]} images  lista di URL
 * @param {number} [height=220]
 */
export default function ImageCarousel({ images = [], height = 220 }) {
  const [index, setIndex] = useState(0);
  const list = Array.isArray(images) ? images.filter(Boolean) : [];

  if (list.length === 0) return null;

  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    setIndex(Math.round(x / width));
  };

  return (
    <View style={{ height }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
      >
        {list.map((url, i) => (
          <Image
            key={`${url}-${i}`}
            source={{ uri: url }}
            style={{ width, height }}
            resizeMode="cover"
          />
        ))}
      </ScrollView>

      {list.length > 1 && (
        <View style={styles.dots}>
          {list.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index ? styles.dotActive : null]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    position: "absolute",
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  dotActive: {
    backgroundColor: theme.colors.primary || "#fff",
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
