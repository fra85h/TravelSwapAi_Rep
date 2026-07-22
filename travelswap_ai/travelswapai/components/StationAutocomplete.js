// components/StationAutocomplete.js — TextInput libero + suggerimenti da
// lib/trainStations. Resta testo libero (nessun vincolo): l'elenco aiuta a
// scrivere in modo uniforme (città + stazione reale) senza obbligare nulla.
import React, { useState } from "react";
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from "react-native";
import { theme } from "../lib/theme";
import { searchStations } from "../lib/trainStations";

export default function StationAutocomplete({
  value, onChangeText, placeholder, editable = true, style, inputStyle,
}) {
  const [focused, setFocused] = useState(false);
  const suggestions = focused ? searchStations(value) : [];
  // Non proporre il suggerimento già scelto identico al testo corrente.
  const visible = suggestions.filter((s) => s !== value);

  return (
    <View style={[{ position: "relative", zIndex: focused ? 20 : 1, elevation: focused ? 20 : 0 }, style]}>
      <TextInput
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        style={inputStyle}
      />
      {visible.length > 0 ? (
        <View style={styles.dropdown}>
          {visible.map((s) => (
            <TouchableOpacity
              key={s}
              style={styles.item}
              onPress={() => { onChangeText(s); setFocused(false); }}
            >
              <Text style={styles.itemText} numberOfLines={1}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md || 10,
    ...theme.shadow.sm,
  },
  item: { paddingHorizontal: 12, paddingVertical: 9 },
  itemText: { color: theme.colors.text, fontSize: 14 },
});
