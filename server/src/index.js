// server/src/index.js
import express from 'express';
import cors from 'cors';
import { recomputeMatches, listMatches } from './models/matches.js';

const app = express();
app.use(cors());
app.use(express.json());

// health
app.get('/api/health', (_, res) => res.json({ ok: true }));

// recompute
app.post('/api/matches/recompute', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await recomputeMatches(userId);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// list latest
app.get('/api/matches', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await listMatches(userId);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const BASE = parseInt(process.env.PORT || '8080', 10);
function choosePort(port, tries = 5) {
  return new Promise((resolve) => {
    const srv = app.listen(port, '0.0.0.0', () => {
      console.log(`✅ API listening on http://0.0.0.0:${port}`);
      resolve(port);
    });
    srv.on('error', () => {
      if (tries > 0) {
        console.warn(`⚠️ Porta ${port} occupata, provo con ${port+1}...`);
        resolve(choosePort(port+1, tries-1));
      } else {
        console.error('❌ Nessuna porta libera.');
        process.exit(1);
      }
    });
  });
}
choosePort(BASE);
