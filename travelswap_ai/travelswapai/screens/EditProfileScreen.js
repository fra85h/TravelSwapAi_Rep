// screens/EditProfileScreen.js
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { supabase } from "../lib/supabase";
import { useNavigation } from "@react-navigation/native";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
export default function EditProfileScreen() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);

  // campi del profilo (adatta ai tuoi nomi colonna)
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
const navigation = useNavigation();
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // user corrente
      const { data: { user }, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      if (!user) throw new Error(t("editProfileScreen.notAuthenticated", "Non autenticato"));
      setUserId(user.id);

      // profilo
      const { data, error: perr } = await supabase
        .from("profiles")
        .select("full_name, username, bio, phone")
        .eq("id", user.id)
        .single();

      if (perr) {
        // se non esiste la riga, inizializza vuoto (opzionale)
        if (perr.code === "PGRST116") {
          setFullName(""); setUsername(""); setBio(""); setPhone("");
        } else {
          throw perr;
        }
      } else {
        setFullName(data?.full_name ?? "");
        setUsername(data?.username ?? "");
        setBio(data?.bio ?? "");
        setPhone(data?.phone ?? "");
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSave = useCallback(async () => {
    if (!userId) return;
    // validazioni minime
    if (username && !/^[a-z0-9_\.]{3,20}$/i.test(username)) {
      Alert.alert(t("editProfileScreen.usernameInvalidTitle", "Username non valido"), t("editProfileScreen.usernameInvalidMsg", "Usa 3–20 caratteri alfanumerici (underscore e punto permessi)."));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id: userId,               // importante per upsert su pk = auth.users.id
        full_name: fullName?.trim() || null,
        username: username?.trim() || null,
        bio: bio?.trim() || null,
        phone: phone?.trim() || null,
        updated_at: new Date().toISOString(),
      };

      // upsert: crea o aggiorna la riga del profilo
      const { error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" }); // id è FK verso auth.users

      if (error) throw error;
      Alert.alert(t("editProfileScreen.savedTitle", "Salvato"), t("editProfileScreen.savedMsg", "Profilo aggiornato con successo."));
      navigation.goBack();  // torna al tab Profilo
    } catch (e) {
      Alert.alert(t("common.error", "Errore"), e.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [userId, fullName, username, bio, phone]);

  if (loading) {
    return <View style={s.center}><ActivityIndicator /></View>;
  }
  if (error) {
    return (
      <View style={s.center}>
        <Text style={{ color: "#B91C1C", marginBottom: 8 }}>{error}</Text>
        <TouchableOpacity style={s.btn} onPress={load}><Text style={s.btnTxt}>{t("common.retry", "Riprova")}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
        <Text style={s.title}>{t("profile.editProfile", "Modifica profilo")}</Text>

        <View style={s.field}>
          <Text style={s.label}>{t("editProfileScreen.fullNameLabel", "Nome e cognome")}</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder={t("editProfileScreen.fullNamePlaceholder", "Il tuo nome")}
            style={s.input}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>{t("editProfileScreen.usernameLabel", "Username")}</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("editProfileScreen.usernamePlaceholder", "es. mario_rossi")}
            style={s.input}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>{t("editProfileScreen.bioLabel", "Bio")}</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder={t("editProfileScreen.bioPlaceholder", "Racconta qualcosa di te")}
            style={[s.input, { height: 100, textAlignVertical: "top" }]}
            multiline
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>{t("editProfileScreen.phoneLabel", "Telefono")}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+39 ..."
            style={s.input}
          />
        </View>

        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          style={[s.btn, saving && s.btnDisabled]}
        >
          <Text style={s.btnTxt}>{saving ? t("editProfileScreen.saving", "Salvataggio...") : t("common.save", "Salva")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  field: { marginBottom: 12 },
  label: { fontWeight: "700", marginBottom: 6, color: "#374151" },
  input: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 10, backgroundColor: "#fff" },
  btn: { backgroundColor: theme.colors.primary, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginTop: 8 },
  btnTxt: { color: theme.colors.boardingText, fontWeight: "800" },
  btnDisabled: { opacity: 0.6 },
});
