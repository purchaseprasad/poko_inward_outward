import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, ah, HttpError } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { str, up } from '../common.js';

const M = {
  products: { cols: ['name', 'sku'], req: ['name'], order: 'lower(name)' },
  vendors: { cols: ['name'], req: ['name'], order: 'lower(name)' },
  transporters: { cols: ['name'], req: ['name'], order: 'lower(name)' },
  outward_types: { cols: ['name', 'kind'], req: ['name'], order: 'id' },
  employees: { cols: ['emp_no', 'name', 'dept'], req: ['emp_no', 'name'], order: 'lower(emp_no)' },
  warehouses: { cols: ['name', 'code'], req: ['name', 'code'], order: 'id' },
};
const STAFF_CAN_ADD = ['products', 'vendors', 'transporters', 'outward_types', 'employees'];

function clean(m, body) {
  const d = {};
  for (const c of M[m].cols) d[c] = c === 'sku' || c === 'code' ? up(body[c]) : str(body[c]);
  for (const c of M[m].req) if (!d[c]) throw new HttpError(400, `${c.replace('_', ' ')} is required.`);
  if (m === 'outward_types') d.kind = ['sale', 'transfer', 'damaged', 'employee', 'other'].includes(body.kind) ? body.kind : 'sale';
  return d;
}
async function insert(m, d) {
  const cols = Object.keys(d);
  try {
    const r = await q(`insert into ${m}(${cols.join(',')}) values(${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((c) => d[c]));
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') {
      // already there: return the existing row instead of an error for a simple "add new"
      const key = m === 'employees' ? 'emp_no' : 'name';
      const ex = (await q(`select * from ${m} where lower(${key})=lower($1)`, [d[key]])).rows[0];
      if (ex && !ex.active) { await q(`update ${m} set active=true where id=$1`, [ex.id]); return { ...ex, active: true }; }
      if (ex && (m !== 'products' || !d.sku || ex.sku === d.sku)) return ex;
      throw new HttpError(409, m === 'products' ? 'This product name or SKU already exists.' : 'Already exists.');
    }
    throw e;
  }
}

/* ---- everything the forms need for dropdowns ---- */
export const lists = Router();
lists.use(requireAuth);
lists.get('/', ah(async (req, res) => {
  const out = {};
  for (const m of Object.keys(M)) out[m] = (await q(`select * from ${m} where active order by ${M[m].order}`)).rows;
  out.users = (await q('select id,name,role from users order by name')).rows;
  res.json(out);
}));
lists.post('/:m', ah(async (req, res) => {
  const m = req.params.m;
  if (!M[m]) throw new HttpError(404, 'Unknown list.');
  if (req.user.role !== 'Admin' && !(req.user.role === 'Staff' && STAFF_CAN_ADD.includes(m))) throw new HttpError(403, 'Only Admin can add to this list.');
  const d = clean(m, req.body);
  if (req.user.role !== 'Admin' && m === 'outward_types') d.kind = 'sale';
  res.json(await insert(m, d));
}));

/* ---- Admin: manage every list + users ---- */
export const admin = Router();
admin.use(requireAuth, requireRole('Admin'));

admin.get('/masters/:m', ah(async (req, res) => {
  const m = req.params.m;
  if (!M[m]) throw new HttpError(404, 'Unknown list.');
  res.json((await q(`select * from ${m} order by active desc, ${M[m].order}`)).rows);
}));
admin.put('/masters/:m/:id', ah(async (req, res) => {
  const { m, id } = req.params;
  if (!M[m]) throw new HttpError(404, 'Unknown list.');
  const d = clean(m, req.body);
  if ('active' in req.body) d.active = !!req.body.active;
  const cols = Object.keys(d);
  try {
    const r = await q(`update ${m} set ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} where id=$${cols.length + 1} returning *`, [...cols.map((c) => d[c]), id]);
    res.json(r.rows[0]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'Another item already has this name / code / SKU.'); throw e; }
}));
admin.delete('/masters/:m/:id', ah(async (req, res) => {
  const { m, id } = req.params;
  if (!M[m]) throw new HttpError(404, 'Unknown list.');
  await q(`update ${m} set active=false where id=$1`, [id]);
  res.json({ ok: true });
}));

admin.get('/users', ah(async (req, res) => res.json((await q('select id,name,email,role,active,created_at from users order by id')).rows)));
admin.post('/users', ah(async (req, res) => {
  const { name, email, role, password } = req.body;
  if (!str(name) || !str(email)) throw new HttpError(400, 'Name and email are required.');
  if (!['Admin', 'Staff', 'Finance', 'Quality'].includes(role)) throw new HttpError(400, 'Choose a role.');
  if (String(password || '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
  try {
    const r = await q('insert into users(name,email,password_hash,role) values($1,$2,$3,$4) returning id,name,email,role,active',
      [str(name), str(email).toLowerCase(), await bcrypt.hash(password, 10), role]);
    res.json(r.rows[0]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'A user with this email already exists.'); throw e; }
}));
admin.put('/users/:id', ah(async (req, res) => {
  const { name, email, role, active, password } = req.body;
  const id = +req.params.id;
  if (id === req.user.id && (active === false || (role && role !== 'Admin'))) throw new HttpError(400, 'You cannot switch off or demote your own Admin account.');
  const cur = (await q('select * from users where id=$1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'User not found.');
  if (password && String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
  try {
    const r = await q('update users set name=$1,email=$2,role=$3,active=$4,password_hash=$5 where id=$6 returning id,name,email,role,active', [
      str(name) || cur.name, str(email).toLowerCase() || cur.email, role || cur.role, active ?? cur.active,
      password ? await bcrypt.hash(password, 10) : cur.password_hash, id]);
    res.json(r.rows[0]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'A user with this email already exists.'); throw e; }
}));
admin.get('/emails', ah(async (req, res) => res.json((await q('select * from email_log order by id desc limit 100')).rows)));
