import pg from 'pg';
import 'dotenv/config';

pg.types.setTypeParser(1082, (v) => v); // keep DATE columns as plain 'YYYY-MM-DD' text (no timezone shifts)

/* hosting (Render): one DATABASE_URL.  Local PC: the separate PG* values from .env */
const url = process.env.DATABASE_URL;
export const cfg = url
  ? { connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } }
  : {
      host: process.env.PGHOST || 'localhost',
      port: +(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'pokonut_wms',
    };
export const pool = new pg.Pool(cfg);
export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
