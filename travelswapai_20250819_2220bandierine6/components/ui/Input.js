import React, { useState } from "react";
import { View, TextInput, Text } from "react-native";
import { theme } from "../../lib/theme";

export default function Input({ label, error, style, inputStyle, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      {label ? (
        <Text style={{ fontWeight: "700", color: theme.colors.text, marginBottom: 8 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          {
            borderWidth: 1,
            borderColor: focused ? theme.colors.text : theme.colors.border,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            paddingHorizontal: 12,
            paddingVertical: 10,
          },
          theme.shadow.sm,
          style,
        ]}
      >
        <TextInput
          {...props}
          style={[{ color: theme.colors.text, fontSize: 16 }, inputStyle]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={theme.colors.textMuted}
        />
      </View>
      {error ? (
        <Text style={{ color: theme.colors.danger, marginTop: 6 }}>{error}</Text>
      ) : null}
    </View>
  );
}
