
import React, { useState } from "react";
import { View, Text, Alert } from "react-native";
import * as Linking from "expo-linking";
import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { supabase } from "../lib/supabase";

const makeRedirectUrl = () => {
  return Linking.createURL("/auth/reset", { scheme: "travelswap" });
};

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const sendReset = async () => {
    if (!email) {
      Alert.alert("Email richiesta", "Inserisci la tua email.");
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: makeRedirectUrl(),
      });
      if (error) throw error;
      Alert.alert(
        "Controlla la tua email",
        "Ti abbiamo inviato un link per reimpostare la password."
      );
      navigation.goBack();
    } catch (err) {
      Alert.alert("Errore", err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: theme.colors.background }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: theme.colors.text, marginBottom: 16 }}>
        Password dimenticata
      </Text>
      <Input
        label="Email"
        placeholder="nome@dominio.it"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <Button title="Invia link di reset" onPress={sendReset} loading={loading} />
    </View>
  );
}
