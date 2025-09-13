// server/src/services/trust/store.js
import { supabase } from '../../db.js';

export async function saveTrustAudit({ userId, listingId, payload }) {
  const { error } = await supabase
    .from('trust_audit')
    .insert({
      user_id: userId,
      listing_id: listingId,
      trust_score: payload.trustScore,
      flags: payload.flags,
      suggested_fixes: payload.suggestedFixes,
      sub_scores: payload.subScores,
      raw: payload
    });

  if (error) throw error;
}
