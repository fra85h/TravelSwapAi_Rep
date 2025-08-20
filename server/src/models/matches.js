// server/src/models/matches.js
import { supabase } from "../db.js";

import { isUUID } from "../util/uuid.js";

export async function upsertMatches(userId, rows) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  const payload = (rows || [])
    .filter(r => isUUID(r.id))
    .map(r => ({
      user_id: userId,
      listing_id: r.id,
      score: Math.max(0, Math.min(100, Number(r.score) || 0)),
      bidirectional: !!r.bidirectional,
      updated_at: new Date().toISOString(),
    }));

  if (payload.length === 0) return;

  const { error } = await supabase.from("matches").upsert(payload, { onConflict: "user_id,listing_id" });
  if (error) throw error;
}

export async function listMatchesForUser(userId, { minScore = 0 } = {}) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  const { data, error } = await supabase
    .from("matches")
    .select("listing_id, score, bidirectional")
    .eq("user_id", userId)
    .gte("score", minScore)
    .order("score", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}
