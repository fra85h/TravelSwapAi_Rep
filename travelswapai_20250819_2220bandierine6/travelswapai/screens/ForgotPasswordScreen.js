// screens/ForgotPasswordScreen.js
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { theme } from "../lib/theme";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  // Supabase richiede un redirectTo per il reset; usa lo stesso schema dell’app
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'travelswapai' });

  const onReset = async () => {
    if (!email.trim()) {
      Alert.alert('Attenzione', 'Inserisci la tua email.');
      return;
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo, // la pagina/apertura app dove l’utente imposterà la nuova password
      });
      if (error) throw error;
      Alert.alert('Controlla la posta', 'Ti abbiamo inviato un link per reimpostare la password.');
    } catch (e) {
      Alert.alert('Errore', e.message ?? 'Non è stato possibile inviare l’email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recupera password</Text>
      <Text style={styles.subtitle}>Inserisci la tua email per ricevere il link di reset.</Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        placeholderTextColor="#9CA3AF"
      />

      <TouchableOpacity disabled={busy} onPress={onReset} style={[styles.primaryBtn, busy && { opacity: 0.7 }]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Invia link</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '900', color: '#111827' },
  subtitle: { color: '#6B7280', marginTop: 4, marginBottom: 18 },
  label: { fontWeight: '700', color: '#111827', marginTop: 10, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12, color: '#111827', backgroundColor: '#fff',
  },
  primaryBtn: { backgroundColor: '#111827', paddingVertical: 14, borderRadius: 12, marginTop: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '900' },
});
