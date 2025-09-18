import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Image, TextInput, Pressable, Animated, Easing, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { theme } from "../lib/theme";

WebBrowser.maybeCompleteAuthSession();

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
    });
    return () => {
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (showOnboarding) {
    return <OnboardingScreen onFinish={() => setShowOnboarding(false)} />;
  }

  return session ? <Home onSignOut={async () => await supabase.auth.signOut()} /> : <Login />;
}

/* ---------- ONBOARDING ---------- */
function OnboardingScreen({ onFinish }) {
  const rotateAnim = useState(new Animated.Value(0))[0];
  const scaleAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.2, duration: 750, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ]),
    ]).start(() => {
      setTimeout(onFinish, 500);
    });
  }, []);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.center}>
      <Animated.Image
        source={{ uri: "https://i.ibb.co/7z1s7Wc/logo.png" }} // Sostituisci con il tuo logo hostato
        style={{ width: 120, height: 120, transform: [{ rotate: spin }, { scale: scaleAnim }] }}
        resizeMode="contain"
      />
      <Text style={{ fontSize: 24, fontWeight: "bold", marginTop: 20 }}>Travel Swap AI</Text>
    </View>
  );
}

/* ---------- LOGIN ---------- */
function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  async function signInEmail() {
    if (!email || !pw) return alert("Inserisci email e password");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) alert(error.message);
  }

  async function signUpEmail() {
    if (!email || !pw) return alert("Inserisci email e password");
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) alert(error.message);
    else alert("Registrato! Controlla la tua email per confermare.");
  }

  async function signInWithGoogle() {
    try {
      const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUri },
      });
      if (error) alert(error.message);
    } catch (e) {
      alert(String(e?.message ?? e));
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accedi a Travel Swap AI</Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        style={styles.input}
        value={pw}
        onChangeText={setPw}
      />

      <Pressable style={[styles.btn, { backgroundColor: "#147ddc" }]} onPress={signInEmail} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "Attendi…" : "Login"}</Text>
      </Pressable>

      <Pressable style={[styles.btn, styles.btnOutline]} onPress={signUpEmail} disabled={busy}>
        <Text style={[styles.btnText, { color: "#147ddc" }]}>Registrati</Text>
      </Pressable>

      <Pressable style={[styles.btn, { backgroundColor: "#de5246", marginTop: 20 }]} onPress={signInWithGoogle}>
        <Text style={styles.btnText}>Accedi con Google</Text>
      </Pressable>
    </View>
  );
}

/* ---------- HOME MOCK ---------- */
function Home({ onSignOut }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sei dentro 🎉</Text>
      <Pressable style={[styles.btn, { backgroundColor: "#333" }]} onPress={onSignOut}>
        <Text style={styles.btnText}>Esci</Text>
      </Pressable>
    </View>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  container: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 16, color: "#121c30" },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 12, borderRadius: 10, marginBottom: 10 },
  btn: { paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  btnOutline: { borderWidth: 1, borderColor: "#147ddc", backgroundColor: "#fff" },
});
