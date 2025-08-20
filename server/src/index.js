import express from "express";
import cors from "cors";
import { matchesRouter } from "./routes/match.js";
import "dotenv/config";
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", matchesRouter);

// porta libera automatica
const tryListen = async (start = 8080, attempts = 5) => {
  for (let p = start; p < start + attempts; p++) {
    try {
      await new Promise((resolve, reject) => {
        const srv = app.listen(p, "0.0.0.0", () => resolve(srv));
        srv.on("error", reject);
      }).then(srv => {
        console.log(`✅ API listening on http://0.0.0.0:${srv.address().port}`);
      });
      return;
    } catch {
      console.warn(`⚠️ Porta ${p} occupata, provo con ${p + 1}...`);
    }
  }
  console.error("❌ Nessuna porta libera");
};

tryListen();
