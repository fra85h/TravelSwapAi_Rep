// screens/LoginScreen.js
import React, { useState, useEffect } from "react";
import { View, TextInput, TouchableOpacity, Text, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export default function LoginScreen() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    // niente redirect qui: RootNavigator fa lo switch su MainTabs
    const { data: sub } = supabase.auth.onAuthStateChange(() => {});
    return () => sub.subscription?.unsubscribe?.();
  }, []);

  const onLogin = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // nessun navigation.replace
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  if (session) {
    return (
      <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
        <ActivityIndicator /><Text style={{ marginTop:8 }}>Sto entrando…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, padding:16, gap:12 }}>
      <Text style={{ fontSize:22, fontWeight:"800" }}>Accedi</Text>
      {err ? <Text style={{ color:"#B91C1C" }}>{err}</Text> : null}
      <TextInput placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail}
                 style={{ borderWidth:1, borderColor:"#e5e7eb", padding:12, borderRadius:8 }} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}
                 style={{ borderWidth:1, borderColor:"#e5e7eb", padding:12, borderRadius:8 }} />
      <TouchableOpacity onPress={onLogin} disabled={loading}
                        style={{ backgroundColor:"#111827", padding:14, borderRadius:10, alignItems:"center" }}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color:"#fff", fontWeight:"700" }}>Entra</Text>}
      </TouchableOpacity>
    </View>
  );
}
