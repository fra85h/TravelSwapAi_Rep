
import React, { useState } from "react";
import { View, Text, Alert } from "react-native";
import { theme } from "../lib/theme";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { supabase } from "../lib/supabase";
import { makeAuthRedirectUrl } from "../lib/authLinks";
import { useI18n } from "../lib/i18n";

// Sul web NON si può usare Linking.createURL: produce "https:///auth/reset",
// senza host, che Supabase scarta ripiegando sul Site URL. Vedi authLinks.js.
const makeRedirectUrl = () => makeAuthRedirectUrl("/auth/reset");

export default function ForgotPasswordScreen({ navigation }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const sendReset = async () => {
    if (!email) {
      Alert.alert(t("auth.needEmail", "Email richiesta"), t("auth.enterEmailForReset", "Inserisci la tua email."));
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: makeRedirectUrl(),
      });
      if (error) throw error;
      Alert.alert(t("auth.emailSent", "Controlla la tua email"), t("auth.checkResetLink", "Ti abbiamo inviato un link per reimpostare la password."));
      navigation.goBack();
    } catch (err) {
      Alert.alert(t("auth.resetError", "Errore"), err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: theme.colors.background }}>
      <Text style={{ fontFamily: theme.fonts.headingExtraBold, fontSize: 22, color: theme.colors.text, marginBottom: 16 }}>
        {t("auth.forgot", "Password dimenticata")}
      </Text>
      <Input
        label={t("auth.email", "Email")}
        placeholder={t("auth.emailPlaceholder", "nome@dominio.it")}
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <Button title={t("auth.sendResetLink", "Invia link di reset")} onPress={sendReset} loading={loading} />
    </View>
  );
}
