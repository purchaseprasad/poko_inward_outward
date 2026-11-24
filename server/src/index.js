import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { migrate } from './migrate.js';
import { HttpError } from './db.js';
import authRoutes from './routes/auth.js';
import { lists, admin } from './routes/masters.js';
import inward from './routes/inward.js';
import outward from './routes/outward.js';
import docs from './routes/docs.js';
import reports from './routes/reports.js';
import bulk from './routes/bulk.js';
import mailaction from './routes/mailaction.js';

const app = express();
app.set('trust proxy', 1); // behind Render / Netlify
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/lists', lists);
app.use('/api/admin', admin);
app.use('/api/inward', inward);
app.use('/api/outward', outward);
app.use('/api/documents', docs);
app.use('/api/bulk', bulk);
app.use('/api/mail', mailaction);
app.use('/api', reports);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* when the React app has been built, serve it from here too (used at deployment time) */
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large.' });
  if (err.code === '23505') return res.status(409).json({ error: 'This already exists (duplicate).' });
  if (err.code === '23514') return res.status(400).json({ error: 'A quantity rule was broken (check the numbers).' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = +(process.env.PORT || 3001);
migrate()
  .then(() => app.listen(PORT, () => console.log(`Pokonut WMS API running on http://localhost:${PORT}`)))
  .catch((e) => { console.error('\nCould not start: ' + e.message + '\nCheck PGHOST / PGUSER / PGPASSWORD in server/.env and that PostgreSQL is running.'); process.exit(1); });
