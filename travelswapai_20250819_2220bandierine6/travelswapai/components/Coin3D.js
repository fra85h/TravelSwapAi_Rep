// travelswapai/components/Coin3D.js
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, {
  Defs,
  RadialGradient as SvgRadialGradient,
  LinearGradient as SvgLinearGradient,
  Stop,
  Circle,
  G,
} from "react-native-svg";
import { theme } from "../lib/theme";

// alias per evitare rogne con <Animated.View>
const AView = Animated.View;

export default function Coin3D({
  size = 160,
  baseColor = "#FDBB30",
  shine = true,
  speed = 6000,
}) {
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = () => {
      rot.setValue(0);
      Animated.timing(rot, {
        toValue: 1,
        duration: speed,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => finished && loop());
    };
    loop();
    return () => rot.stopAnimation();
  }, [rot, speed]);

  const rotateY = rot.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const rimWidth = Math.max(4, Math.round(size * 0.06));
  const r = (size - rimWidth) / 2;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <AView
        style={{
          width: size,
          height: size,
          transform: [{ perspective: 800 }, { rotateY }],
        }}
      >
        <Svg width={size} height={size}>
          <Defs>
            <SvgRadialGradient id="gFace" cx="50%" cy="40%" r="65%">
              <Stop offset="0%" stopColor={baseColor} stopOpacity={1} />
              <Stop offset="70%" stopColor={baseColor} stopOpacity={0.85} />
              <Stop offset="100%" stopColor="#B8860B" stopOpacity={0.9} />
            </SvgRadialGradient>

            <SvgLinearGradient id="gRim" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#EED27A" />
              <Stop offset="50%" stopColor="#B88700" />
              <Stop offset="100%" stopColor="#EED27A" />
            </SvgLinearGradient>

            <SvgLinearGradient id="gGloss" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.55} />
              <Stop offset="25%" stopColor="#FFFFFF" stopOpacity={0.25} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
            </SvgLinearGradient>
          </Defs>

          {/* Rim */}
          <Circle cx={size / 2} cy={size / 2} r={r + rimWidth / 2} fill="url(#gRim)" />
          {/* Face */}
          <Circle cx={size / 2} cy={size / 2} r={r} fill="url(#gFace)" />
          {/* Gloss */}
          {shine ? (
            <G>
              <Circle cx={size * 0.35} cy={size * 0.32} r={r * 0.9} fill="url(#gGloss)" />
            </G>
          ) : null}
        </Svg>
      </AView>
    </View>
  );
}
