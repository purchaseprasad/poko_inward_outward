import jwt from 'jsonwebtoken';
import { q, HttpError, ah } from './db.js';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) { console.error('JWT_SECRET must be set in production.'); process.exit(1); }
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
export const signToken = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' });
export const setCookie = (res, token) =>
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 * 1000 });

export const requireAuth = ah(async (req, res, next) => {
  const t = req.cookies?.token;
  if (!t) throw new HttpError(401, 'Please log in.');
  let id;
  try { id = jwt.verify(t, SECRET).id; } catch { throw new HttpError(401, 'Session expired. Please log in again.'); }
  const u = (await q('select id,name,email,role,active from users where id=$1', [id])).rows[0];
  if (!u || !u.active) throw new HttpError(401, 'This account is not active.');
  req.user = u;
  next();
});

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, `Only ${roles.join(' / ')} can do this.`));
