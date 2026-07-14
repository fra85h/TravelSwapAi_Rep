// lib/avatar.js — foto profilo utente (Storage + profiles.avatar_url)
import { decode } from "base64-arraybuffer";
import { supabase } from "./supabase";

const BUCKET = "avatars";

/**
 * Carica la foto profilo su Storage e aggiorna profiles.avatar_url.
 * Un solo file per utente: ogni upload sovrascrive il precedente
 * (stesso percorso), niente file orfani da ripulire.
 * @param {{ base64:string, mimeType?:string, fileName?:string }} asset  (da expo-image-picker con base64:true)
 */
export async function uploadAvatar(asset) {
  if (!asset?.base64) throw new Error("Immagine senza dati (attiva base64 nel picker)");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");

  const ext = (asset.fileName?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const contentType = asset.mimeType || "image/jpeg";
  const path = `${user.id}/avatar.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(asset.base64), { contentType, upsert: true });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // cache-busting: senza query param, un vecchio URL identico resterebbe
  // in cache nel browser/app anche dopo aver sostituito la foto
  const url = `${pub?.publicUrl}?v=${Date.now()}`;

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;

  return url;
}
