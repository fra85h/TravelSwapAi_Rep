import { supabase } from "../db.js";

export async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Invalid token" });

    req.user = data.user; // <- { id, email, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Auth failed" });
  }
}
