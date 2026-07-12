// lib/listingImages.js — galleria foto degli annunci (Storage + listing_images)
import { decode } from "base64-arraybuffer";
import { supabase } from "./supabase";

const BUCKET = "listing-images";

/** Foto di un annuncio, ordinate per position */
export async function listImages(listingId) {
  if (!listingId) return [];
  const { data, error } = await supabase
    .from("listing_images")
    .select("id, url, position")
    .eq("listing_id", listingId)
    .order("position", { ascending: true });
  if (error) { console.log("[listImages]", error.message); return []; }
  return data || [];
}

/**
 * Carica una foto su Storage e registra la riga in listing_images.
 * @param {string} listingId
 * @param {{ base64:string, mimeType?:string, fileName?:string }} asset  (da expo-image-picker con base64:true)
 * @param {number} position
 */
export async function uploadImage(listingId, asset, position = 0) {
  if (!listingId) throw new Error("Annuncio mancante");
  if (!asset?.base64) throw new Error("Immagine senza dati (attiva base64 nel picker)");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");

  const ext = (asset.fileName?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const contentType = asset.mimeType || "image/jpeg";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${user.id}/${listingId}/${Date.now()}-${rand}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(asset.base64), { contentType, upsert: false });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;

  const { data, error } = await supabase
    .from("listing_images")
    .insert({ listing_id: listingId, url, position })
    .select("id, url, position")
    .single();
  if (error) throw error;
  return data;
}

/** Rimuove una foto: riga in DB + file su Storage (best-effort) */
export async function deleteImage(imageId, url) {
  const { error } = await supabase.from("listing_images").delete().eq("id", imageId);
  if (error) throw error;
  try {
    const marker = `/${BUCKET}/`;
    const idx = typeof url === "string" ? url.indexOf(marker) : -1;
    if (idx >= 0) {
      const objPath = url.slice(idx + marker.length);
      await supabase.storage.from(BUCKET).remove([objPath]);
    }
  } catch (e) {
    console.log("[deleteImage] storage cleanup skip:", e?.message || e);
  }
}
