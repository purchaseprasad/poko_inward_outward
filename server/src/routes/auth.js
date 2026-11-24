import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, ah, HttpError } from '../db.js';
import { signToken, setCookie, requireAuth } from '../auth.js';

const r = Router();

r.post('/login', ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  const u = (await q('select * from users where lower(email)=$1', [email])).rows[0];
  if (!u || !(await bcrypt.compare(pw, u.password_hash))) throw new HttpError(401, 'Wrong email or password.');
  if (!u.active) throw new HttpError(403, 'This account has been switched off. Please contact the Admin.');
  setCookie(res, signToken(u));
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
}));

r.post('/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
r.get('/me', requireAuth, (req, res) => res.json(req.user));

r.post('/password', requireAuth, ah(async (req, res) => {
  const { current, next } = req.body;
  const u = (await q('select * from users where id=$1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw new HttpError(400, 'Current password is wrong.');
  if (String(next || '').length < 6) throw new HttpError(400, 'New password must be at least 6 characters.');
  await q('update users set password_hash=$1 where id=$2', [await bcrypt.hash(next, 10), u.id]);
  res.json({ ok: true });
}));

export default r;
