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

  // contentType e estensione arrivano dal client e finivano nello Storage
  // senza controlli: un mimeType arbitrario (text/html, image/svg+xml) su un
  // bucket pubblico significa un file servito dal nostro dominio con un tipo
  // scelto da chi carica. Whitelist di formati raster, con l'estensione
  // derivata dal tipo accettato invece che dal nome file.
  const ALLOWED = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const declared = String(asset.mimeType || "image/jpeg").toLowerCase().split(";")[0].trim();
  const contentType = ALLOWED[declared] ? declared : "image/jpeg";
  const ext = ALLOWED[declared] || "jpg";

  // Tetto di dimensione: il base64 è ~4/3 del binario. Senza limite, una
  // singola foto può occupare storage e banda a piacere.
  const approxBytes = Math.floor((asset.base64.length * 3) / 4);
  const MAX_BYTES = 8 * 1024 * 1024;
  if (approxBytes > MAX_BYTES) {
    throw new Error("Immagine troppo grande (max 8MB)");
  }
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${user.id}/${listingId}/${Date.now()}-${rand}.${ext}`;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;

  // PRIMA la riga, POI il file. L'ordine era inverso, e il bucket è
  // pubblico: quando l'insert veniva rifiutato — succede davvero, il
  // trigger a DB non ne accetta più di due per annuncio — il file restava
  // caricato e raggiungibile per URL senza appartenere a nessun annuncio.
  // Una foto di biglietto che nessuna schermata mostra più ma che chiunque
  // abbia l'indirizzo può ancora aprire.
  //
  // Così invece il rifiuto arriva prima che un solo byte parta: niente file
  // orfano, e neanche la banda sprecata a caricare una foto che verrà
  // scartata. Se a fallire è il caricamento, resta al più una riga senza
  // file — un'immagine rotta, che si vede e si corregge, non un documento
  // che continua a circolare.
  const { data, error } = await supabase
    .from("listing_images")
    .insert({ listing_id: listingId, url, position })
    .select("id, url, position")
    .single();
  if (error) throw error;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(asset.base64), { contentType, upsert: false });
  if (upErr) {
    const { error: errPulizia } = await supabase.from("listing_images").delete().eq("id", data.id);
    if (errPulizia) console.log("[uploadImage] riga da ripulire:", errPulizia.message);
    throw upErr;
  }

  return data;
}

/**
 * Rimuove una foto: PRIMA il file su Storage, POI la riga.
 *
 * L'ordine era inverso e la rimozione del file era best-effort dentro un
 * try/catch: se falliva, l'utente vedeva la foto sparire dall'annuncio
 * mentre il file restava pubblico e raggiungibile da chiunque avesse
 * l'indirizzo. Su una foto di biglietto — con nome, tratta e a volte il
 * codice di prenotazione sopra — "cancellata" deve voler dire cancellata.
 *
 * Così, se il file non si riesce a togliere, non si toglie neanche la riga:
 * la foto resta visibile nell'annuncio e l'errore arriva a chi ha premuto,
 * che può riprovare. Sgradevole, ma vero — al contrario del silenzio di
 * prima, che diceva "fatto" a cose non fatte.
 */
export async function deleteImage(imageId, url) {
  const marker = `/${BUCKET}/`;
  const idx = typeof url === "string" ? url.indexOf(marker) : -1;
  if (idx >= 0) {
    const objPath = url.slice(idx + marker.length);
    const { error: errFile } = await supabase.storage.from(BUCKET).remove([objPath]);
    if (errFile) throw errFile;
  }
  // Nessun indirizzo riconoscibile: non c'è un file da togliere (o non
  // sappiamo quale). La riga si rimuove comunque, altrimenti resterebbe
  // impossibile liberarsene.
  const { error } = await supabase.from("listing_images").delete().eq("id", imageId);
  if (error) throw error;
}
