// server/src/index.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { listingsRouter } from './routes/listings.js';   // assicurati che esista
import { matchesRouter } from './routes/matches.js';     // contiene GET / e POST /recompute

const app = express();
app.use(cors());
app.use(express.json());

// Health first
app.get('/api/health', (_, res) => res.json({ ok: true }));

// Routers
app.use('/api/listings', listingsRouter);
app.use('/api/matches', matchesRouter);

// Porta con fallback
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

export default app;
