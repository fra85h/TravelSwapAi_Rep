// components/DateField.js
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from "react-native";
import { useI18n } from "../lib/i18n";
import { theme } from "../lib/theme";

const pad2 = (n) => String(n).padStart(2, "0");
const toISODate = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};
const parseISODate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
};

export default function DateField({ label, value, onChange, required, error, disabled }) {
  const { t } = useI18n();
  const [showPicker, setShowPicker] = useState(false);
  const [hasPickerLib, setHasPickerLib] = useState(null);

  const DateTimePicker = useMemo(() => {
    try {
      const mod = require("@react-native-community/datetimepicker");
      setHasPickerLib(true);
      return mod?.default || mod;
    } catch {
      setHasPickerLib(false);
      return null;
    }
  }, []);

  const baseDate = value && parseISODate(value) ? parseISODate(value) : new Date();

  if (hasPickerLib === false) {
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>
          {label} {required ? "*" : ""}
        </Text>
        <TextInput editable={!disabled}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, error && styles.inputError]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.label}>
        {label} {required ? "*" : ""}
      </Text>

      <TouchableOpacity onPress={!disabled ? () => setShowPicker(true) : undefined} activeOpacity={0.8}>
        <View style={[styles.input, styles.inputRow, error && styles.inputError]}>
          <Text style={{ color: value ? theme.colors.text : theme.colors.textMuted }}>{value || "YYYY-MM-DD"}</Text>
          <Text style={{ color: theme.colors.textMuted }}>📅</Text>
        </View>
      </TouchableOpacity>
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {hasPickerLib && showPicker && DateTimePicker && (
        <>
          <DateTimePicker
            value={baseDate || new Date()}
            mode="date"
            display={Platform.select({ ios: "inline", android: "calendar" })}
            onChange={(event) => {
              if (Platform.OS === "android") {
                if (event.type === "set" && event.nativeEvent?.timestamp) {
                  onChange(toISODate(event.nativeEvent.timestamp));
                }
                setShowPicker(false);
              } else {
                const ts = event?.nativeEvent?.timestamp;
                if (ts) onChange(toISODate(ts));
              }
            }}
            style={{ alignSelf: "stretch" }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              onPress={() => setShowPicker(false)}
              style={[styles.smallBtn, { alignSelf: "flex-end", marginTop: 8 }]}
            >
              <Text style={styles.smallBtnText}>{t("common.ok", "OK")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: "700", color: theme.colors.text, marginTop: 8, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.colors.text,
  },
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inputError: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  errorText: { color: theme.colors.danger, marginTop: 4 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.text },
  smallBtnText: { color: "#fff", fontWeight: "800" },
  inputDisabled: { backgroundColor: theme.colors.surfaceMuted, color: theme.colors.textMuted },
});
