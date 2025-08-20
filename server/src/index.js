import "dotenv/config"
import express from "express";
import cors from "cors";
import { scoreWithAI } from "./services/ai.js";

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Endpoint di matching
app.post("/api/match", async (req, res) => {
  const { user, listings } = req.body;
  try {
    const scored = await scoreWithAI(user, listings);
    res.json(scored || []);
  } catch (err) {
    console.error("Errore matching:", err);
    res.status(500).json({ error: "AI scoring failed" });
  }
});

// --- Funzione che cerca una porta libera ---
function startServer(port) {
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`✅ API listening on http://0.0.0.0:${port}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`⚠️ Porta ${port} occupata, provo con ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error("❌ Errore server:", err);
    }
  });
}

// Avvio su 8080 con fallback
startServer(process.env.PORT ? parseInt(process.env.PORT, 10) : 8080);
