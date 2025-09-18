import React, { useState, useEffect } from "react";
import { View, Text, KeyboardAvoidingView, Platform } from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import { theme } from "../lib/theme";

export default function LoginScreen() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function onLogin() {
    try {
      setLoading(true);
      setErr(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e) {
      setErr(e.message || "Errore di accesso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ flex:1, padding: 20, justifyContent: "center" }}>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 20, borderWidth: 1, borderColor: theme.colors.border }, theme.shadow.md]}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: theme.colors.text, marginBottom: 12 }}>Accedi</Text>
          {err ? <Text style={{ color: theme.colors.danger, marginBottom: 8 }}>{err}</Text> : null}
          <Input placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
          <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
          <Button title="Entra" onPress={onLogin} loading={loading} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
