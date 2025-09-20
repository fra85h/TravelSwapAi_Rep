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
  const pulse = useRef(new Animated.Value(1)).current;   // 1.00 ↔ 1.08
  const tilt  = useRef(new Animated.Value(0)).current;   // -1 ↔ +1 → deg

  // text shimmer overlay (x position)
  const shimmerX = useRef(new Animated.Value(-80)).current;

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
          Animated.timing(pulse, { toValue: 1.08, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.00, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(tilt, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(tilt, { toValue: -1, duration: 3400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(tilt, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ])
    );

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerX, { toValue: 160, duration: 3500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(shimmerX, { toValue: -80, duration: 10, useNativeDriver: true }), // reset istantaneo
        Animated.delay(600),
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

  // mapping tilt to degrees (±6°)
  const rotate = tilt.interpolate({ inputRange: [-1, 1], outputRange: ["-6deg", "6deg"] });

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
          <Text style={{ fontWeight: "800", fontSize: 16, color: theme.colors.boardingText }}>
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
              // fascio sottile con picco centrale brillante
              colors={["transparent", "rgba(255,255,255,0.20)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                width: 80,              // larghezza del fascio
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
