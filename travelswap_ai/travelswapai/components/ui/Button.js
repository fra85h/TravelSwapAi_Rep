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
    primary: { backgroundColor: theme.colors.primary },
    secondary: { backgroundColor: theme.colors.surfaceMuted, borderWidth: 1, borderColor: theme.colors.border },
    outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.primary },
    subtle: { backgroundColor: "transparent" },
  };

  const textVar = {
    primary: { color: theme.colors.boardingText, fontWeight: "800" },
    secondary: { color: theme.colors.text, fontWeight: "800" },
    outline: { color: theme.colors.primary, fontWeight: "800" },
    subtle: { color: theme.colors.text, fontWeight: "700" },
  };

  const handle = () => {
    if (disabled || loading) return;
    try { Haptics.selectionAsync(); } catch {}
    onPress && onPress();
  };

  return (
    <Pressable
      onPress={handle}
      style={[base, variants[variant], theme.shadow.sm, disabled && { opacity: 0.6 }, style]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {leftIcon || null}
        {loading ? (
          <ActivityIndicator color={variant === "primary" ? "#fff" : theme.colors.text} />
        ) : (
          <Text style={[textVar[variant], textStyle]}>{title}</Text>
        )}
        {rightIcon || null}
      </View>
    </Pressable>
  );
}
