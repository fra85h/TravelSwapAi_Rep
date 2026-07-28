// components/ChainPulseIcon.js — icona del tab Attività quando c'è uno
// swap a 3 in attesa di conferma: sostituisce la campanella con l'icona a
// 3 nodi già usata altrove per lo scambio a 3 (badge in
// ChainProposalsScreen, kicker in AttivitaScreen), con un respiro leggero.
//
// Mai a opacità 0: un lampeggio netto si legge come "icona rotta", non
// come richiamo. Si ferma da sé per chi ha "riduci il movimento" attivo
// nelle impostazioni di accessibilità del telefono.
import React, { useEffect, useRef, useState } from "react";
import { Animated, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ChainPulseIcon({ color, size, focused }) {
  const anim = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (mounted) setReduceMotion(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v) => setReduceMotion(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.62, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, anim]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ scale: anim.interpolate({ inputRange: [0.62, 1], outputRange: [1.07, 1] }) }],
      }}
    >
      <Ionicons name={focused ? "git-network" : "git-network-outline"} color={color} size={size} />
    </Animated.View>
  );
}
