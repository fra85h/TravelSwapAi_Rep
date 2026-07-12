import React from "react";
import { Pressable, Text, ActivityIndicator, View } from "react-native";
import * as Haptics from "expo-haptics";
import { theme } from "../../lib/theme";

export default function Button({
  title,
  onPress,
  variant = "primary", // "primary" | "secondary" | "outline" | "subtle"
  loading = false,
  disabled = false,
  style,
  textStyle,
  leftIcon,
  rightIcon,
  compact = false,
}) {
  const base = {
    paddingVertical: compact ? 10 : 14,
    paddingHorizontal: compact ? 12 : 16,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  };

  const variants = {
    // Accento oro: riservato al CTA principale, coerente con la moneta
    // dell'onboarding e col concetto di scambio di valore dell'app.
    primary: { backgroundColor: theme.colors.accent },
    secondary: { backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border },
    outline: { backgroundColor: "transparent", borderWidth: 1.4, borderColor: theme.colors.accent },
    subtle: { backgroundColor: "transparent" },
  };

  const textVar = {
    // Testo indigo sopra il riempimento oro: l'oro non va mai usato come
    // colore di testo (contrasto insufficiente su sfondo chiaro).
    primary: { color: theme.colors.accentOn, fontWeight: "800" },
    secondary: { color: theme.colors.text, fontWeight: "800" },
    outline: { color: theme.colors.text, fontWeight: "800" },
    subtle: { color: theme.colors.text, fontWeight: "700" },
  };

  // Ombra leggermente dorata sotto il CTA principale: dà "peso" al pulsante
  // più importante della schermata invece di una generica ombra neutra.
  const shadowVar =
    variant === "primary"
      ? { ...theme.shadow.md, shadowColor: theme.colors.accent, shadowOpacity: 0.35 }
      : theme.shadow.sm;

  const handle = () => {
    if (disabled || loading) return;
    try { Haptics.selectionAsync(); } catch {}
    onPress && onPress();
  };

  return (
    <Pressable
      onPress={handle}
      style={({ pressed }) => [
        base,
        variants[variant],
        shadowVar,
        disabled && { opacity: 0.6 },
        pressed && !disabled && !loading && { opacity: 0.88 },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {leftIcon || null}
        {loading ? (
          <ActivityIndicator color={variant === "primary" ? theme.colors.accentOn : theme.colors.text} />
        ) : (
          <Text style={[textVar[variant], textStyle]}>{title}</Text>
        )}
        {rightIcon || null}
      </View>
    </Pressable>
  );
}
