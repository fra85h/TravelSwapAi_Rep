// components/HeaderLogo.js
import React, { useEffect, useRef, useCallback } from "react";
import { Animated, Text, Easing, Pressable, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../lib/theme";

export default function HeaderLogo() {
  // entrance
  const fade = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  // logo loop
  const pulse = useRef(new Animated.Value(1)).current;   // 1.00 ↔ 1.16
  const tilt  = useRef(new Animated.Value(0)).current;   // -1 ↔ +1 → deg

  // text shimmer overlay (x position)
  const shimmerX = useRef(new Animated.Value(-100)).current;

  // press feedback
  const pressScale = useRef(new Animated.Value(1)).current;

  // fade + slide on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,       { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [fade, translateY]);

  // loops: logo (pulse+tilt) + shimmer text (sweep L→R)
  const startLoop = useCallback(() => {
    const logoLoop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.16, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.00, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(tilt, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(tilt, { toValue: -1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(tilt, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ])
    );

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerX, { toValue: 180, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(shimmerX, { toValue: -100, duration: 10, useNativeDriver: true }), // reset istantaneo
        Animated.delay(500),
      ])
    );

    logoLoop.start();
    shimmerLoop.start();

    return () => {
      logoLoop.stop();
      shimmerLoop.stop();
    };
  }, [pulse, tilt, shimmerX]);

  // start/stop loop on focus
  useFocusEffect(
    useCallback(() => {
      const stop = startLoop();
      return () => stop && stop();
    }, [startLoop])
  );

  // press feedback
  const onPressIn  = () => Animated.spring(pressScale, { toValue: 0.96, useNativeDriver: true, friction: 6, tension: 120 }).start();
  const onPressOut = () => Animated.spring(pressScale, { toValue: 1.00, useNativeDriver: true, friction: 6, tension: 120 }).start();

  // mapping tilt to degrees (±11°)
  const rotate = tilt.interpolate({ inputRange: [-1, 1], outputRange: ["-11deg", "11deg"] });

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View
        style={{
          flexDirection: "row",
          alignItems: "center",
          opacity: fade,
          transform: [{ translateY }, { scale: pressScale }],
        }}
      >
        <Animated.Image
          source={require("../assets/logoheader.png")}
          style={{
            width: 40,
            height: 40,
            resizeMode: "contain",
            marginRight: 8,
            transform: [{ scale: pulse }, { rotate }],
          }}
        />

        {/* Testo con shimmer overlay */}
        <View style={{ position: "relative", overflow: "hidden" }}>
          <Text style={{ fontFamily: theme.fonts.headingExtraBold, fontSize: 16, color: theme.colors.boardingText }}>
            TravelSwapAI
          </Text>
          {/* Luccichio diagonale che scorre sopra il testo */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              transform: [{ translateX: shimmerX }],
            }}
          >
            <LinearGradient
              // fascio con picco centrale brillante
              colors={["transparent", "rgba(255,255,255,0.20)", "rgba(255,255,255,0.55)", "rgba(255,255,255,0.20)", "transparent"]}
              locations={[0, 0.35, 0.5, 0.65, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                width: 100,             // larghezza del fascio
                height: "100%",
                transform: [{ skewX: "-20deg" }], // effetto “taglio” diagonale
              }}
            />
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
}
