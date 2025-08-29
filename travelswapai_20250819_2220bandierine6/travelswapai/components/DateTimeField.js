// components/DateTimeField.js
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from "react-native";
import { useI18n } from "../lib/i18n";

const pad2 = (n) => String(n).padStart(2, "0");
const toISODate = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};
const toISOTime = (d) => {
  const dt = new Date(d);
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
};
const parseISODateTime = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(String(s))) return null;
  const [date, time] = s.replace("T", " ").split(" ");
  const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
  const [H, M] = time.split(":").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d, H, M, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

export default function DateTimeField({ label, value, onChange, required, error }) {
  const { t } = useI18n();
  const [hasPickerLib, setHasPickerLib] = useState(null);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

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

  const current = value && parseISODateTime(value) ? parseISODateTime(value) : new Date();
  const display = value ? value.replace("T", " ") : "YYYY-MM-DD HH:mm";

  if (hasPickerLib === false) {
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>
          {label} {required ? "*" : ""}
        </Text>
        <TextInput
          value={value ? value.replace("T", " ") : ""}
          onChangeText={(txt) => onChange(txt.replace(" ", "T"))}
          placeholder="YYYY-MM-DD HH:mm"
          placeholderTextColor="#9CA3AF"
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

      <TouchableOpacity onPress={() => setShowDate(true)} activeOpacity={0.8}>
        <View style={[styles.input, styles.inputRow, error && styles.inputError]}>
          <Text style={{ color: value ? "#111827" : "#9CA3AF" }}>{display}</Text>
          <Text style={{ color: "#6B7280" }}>🕒</Text>
        </View>
      </TouchableOpacity>
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {hasPickerLib && showDate && DateTimePicker && (
        <>
          <DateTimePicker
            value={current}
            mode="date"
            display={Platform.select({ ios: "inline", android: "calendar" })}
            onChange={(e) => {
              const ts = e?.nativeEvent?.timestamp;
              if (ts) {
                const d = new Date(ts);
                const dateStr = toISODate(d);
                const timeStr = value && parseISODateTime(value) ? toISOTime(parseISODateTime(value)) : "09:00";
                onChange(`${dateStr}T${timeStr}`);
              }
              if (Platform.OS === "android") {
                if (e.type !== "set") setShowDate(false);
                else {
                  setShowDate(false);
                  setShowTime(true);
                }
              }
            }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              onPress={() => {
                setShowDate(false);
                setShowTime(true);
              }}
              style={[styles.smallBtn, { alignSelf: "flex-end", marginTop: 8 }]}
            >
              <Text style={styles.smallBtnText}>{t("createListing.pickTime", "Scegli ora")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {hasPickerLib && showTime && DateTimePicker && (
        <>
          <DateTimePicker
            value={current}
            mode="time"
            is24Hour
            display={Platform.select({ ios: "spinner", android: "clock" })}
            onChange={(e) => {
              const ts = e?.nativeEvent?.timestamp;
              if (ts) {
                const d = new Date(ts);
                const timeStr = toISOTime(d);
                const dateStr = value && parseISODateTime(value) ? toISODate(parseISODateTime(value)) : toISODate(new Date());
                onChange(`${dateStr}T${timeStr}`);
              }
              if (Platform.OS === "android") setShowTime(false);
            }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              onPress={() => setShowTime(false)}
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
  label: { fontWeight: "700", color: "#111827", marginTop: 8, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#111827",
  },
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inputError: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  errorText: { color: "#B91C1C", marginTop: 4 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#111827" },
  smallBtnText: { color: "#fff", fontWeight: "800" },
});
