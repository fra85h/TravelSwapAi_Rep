// screens/ManageImagesScreen.js — aggiungi/rimuovi foto di un proprio annuncio
import React, { useCallback, useState } from "react";
import {
  View, Text, Image, FlatList, TouchableOpacity, ActivityIndicator,
  Alert, StyleSheet,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { listImages, uploadImage, deleteImage } from "../lib/listingImages";
import { theme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export default function ManageImagesScreen() {
  const { t } = useI18n();
  const route = useRoute();
  const navigation = useNavigation();
  const listingId = route.params?.listingId ?? route.params?.id;

  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setImages(await listImages(listingId));
    } catch (e) {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onAdd = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("manageImages.permissionDeniedTitle", "Permesso negato"), t("manageImages.permissionDeniedMsg", "Consenti l'accesso alle foto per aggiungere immagini."));
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.7,
        base64: true,
        selectionLimit: 6,
      });
      if (res.canceled) return;

      setBusy(true);
      const assets = res.assets || [];
      let pos = images.length;
      for (const a of assets) {
        try {
          await uploadImage(listingId, a, pos++);
        } catch (e) {
          if (__DEV__) console.log("[ManageImages] upload error:", e?.message || e);
          Alert.alert(t("manageImages.uploadErrorTitle", "Errore caricamento"), e?.message || t("manageImages.uploadErrorGeneric", "Impossibile caricare una foto."));
        }
      }
      await load();
    } catch (e) {
      Alert.alert(t("manageImages.genericErrorTitle", "Errore"), e?.message || t("manageImages.genericErrorMsg", "Operazione non riuscita."));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (img) => {
    Alert.alert(t("manageImages.removePhotoTitle", "Rimuovi foto"), t("manageImages.removePhotoConfirm", "Vuoi eliminare questa foto?"), [
      { text: t("common.cancel", "Annulla"), style: "cancel" },
      {
        text: t("common.delete", "Elimina"),
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await deleteImage(img.id, img.url);
            await load();
          } catch (e) {
            Alert.alert(t("manageImages.genericErrorTitle", "Errore"), e?.message || t("manageImages.deleteErrorMsg", "Impossibile eliminare."));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (!listingId) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textMuted }}>{t("manageImages.missingListing", "Annuncio non specificato.")}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={images}
        keyExtractor={(it) => String(it.id)}
        numColumns={3}
        contentContainerStyle={{ padding: 12 }}
        ListHeaderComponent={
          <TouchableOpacity style={styles.addBtn} onPress={onAdd} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : (
              <Text style={styles.addText}>{t("manageImages.addPhoto", "＋ Aggiungi foto")}</Text>
            )}
          </TouchableOpacity>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>{t("manageImages.emptyText", "Nessuna foto. Tocca “Aggiungi foto” per caricarne.")}</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <Image source={{ uri: item.url }} style={styles.thumb} />
            <TouchableOpacity style={styles.del} onPress={() => onDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.delText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      {loading ? (
        <View style={styles.overlay}><ActivityIndicator /></View>
      ) : null}
    </View>
  );
}

const GAP = 6;
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
  addBtn: {
    borderWidth: 1.4, borderColor: theme.colors.accent, borderStyle: "dashed", borderRadius: 12,
    paddingVertical: 14, alignItems: "center", marginBottom: 12,
  },
  addText: { color: theme.colors.accentOn, fontWeight: "800" },
  empty: { color: theme.colors.textMuted, textAlign: "center", marginTop: 24 },
  cell: { flex: 1 / 3, aspectRatio: 1, padding: GAP },
  thumb: { flex: 1, borderRadius: 10, backgroundColor: theme.colors.surface },
  del: {
    position: "absolute", top: GAP + 4, right: GAP + 4,
    backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, width: 24, height: 24,
    alignItems: "center", justifyContent: "center",
  },
  delText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
