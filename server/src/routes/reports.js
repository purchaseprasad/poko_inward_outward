import { Router } from 'express';
import { q, ah, HttpError } from '../db.js';
import { requireAuth } from '../auth.js';
import { listInward, STAGE_ROLE } from './inward.js';
import { listOutward } from './outward.js';
import { todayKey } from '../common.js';

const r = Router();
r.use(requireAuth);

r.get('/inventory', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.warehouse_id) { p.push(req.query.warehouse_id); w.push(`i.warehouse_id=$${p.length}`); }
  if (req.query.q) { p.push('%' + String(req.query.q).toLowerCase() + '%'); w.push(`lower(i.sku||' '||i.product||' '||i.batch) like $${p.length}`); }
  res.json((await q(`select i.*, w.name warehouse from inventory i join warehouses w on w.id=i.warehouse_id
    ${w.length ? 'where ' + w.join(' and ') : ''} order by w.name, i.product, i.batch`, p)).rows);
}));

r.get('/ledger', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.warehouse_id) { p.push(req.query.warehouse_id); w.push(`l.warehouse_id=$${p.length}`); }
  if (req.query.type) { p.push(req.query.type); w.push(`l.type=$${p.length}`); }
  if (req.query.q) { p.push('%' + String(req.query.q).toLowerCase() + '%'); w.push(`lower(l.sku||' '||l.product||' '||l.batch||' '||l.ref) like $${p.length}`); }
  res.json((await q(`select l.*, w.name warehouse from ledger l join warehouses w on w.id=l.warehouse_id
    ${w.length ? 'where ' + w.join(' and ') : ''} order by l.id desc limit 500`, p)).rows);
}));

r.get('/history', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.kind) { p.push(req.query.kind); w.push(`a.kind=$${p.length}`); }
  if (req.query.q) { p.push('%' + String(req.query.q).toLowerCase() + '%'); w.push(`lower(coalesce(i.no,o.no,'')||' '||a.user_name||' '||a.action||' '||a.note) like $${p.length}`); }
  res.json((await q(`select a.*, coalesce(i.no,o.no) tx_no from activity a left join inward i on a.kind='inward' and i.id=a.tx_id left join outward o on a.kind='outward' and o.id=a.tx_id
    ${w.length ? 'where ' + w.join(' and ') : ''} order by a.id desc limit 500`, p)).rows);
}));

/* everything that is waiting for the logged-in person */
r.get('/approvals', ah(async (req, res) => {
  const role = req.user.role, admin = role === 'Admin';
  const inStatuses = Object.entries(STAGE_ROLE).filter(([, rl]) => admin || rl === role).map(([s]) => s);
  if (admin || role === 'Staff') inStatuses.push('Needs Correction');
  const outStatuses = [];
  if (admin || role === 'Quality') outStatuses.push('Pending Quality');
  if (admin || role === 'Staff') outStatuses.push('In Transit');
  const a = inStatuses.length ? await listInward({ statuses: inStatuses }) : [];
  const b = outStatuses.length ? await listOutward({ statuses: outStatuses, scope: 'all' }) : [];
  res.json([...a, ...b].sort((x, y) => new Date(y.created_at) - new Date(x.created_at)));
}));

r.get('/dashboard', ah(async (req, res) => {
  const one = async (sql, p = []) => (await q(sql, p)).rows[0];
  const t = todayKey();
  const d = {};
  d.inwardToday = (await one('select count(*)::int n from inward where received_date=$1', [t])).n;
  d.outwardToday = (await one("select count(*)::int n from outward where out_date=$1 and kind<>'employee'", [t])).n;
  d.pendingFinance = (await one("select count(*)::int n from inward where status='Pending Finance'")).n;
  d.pendingQualityIn = (await one("select count(*)::int n from inward where status='Pending Quality'")).n;
  d.pendingQualityOut = (await one("select count(*)::int n from outward where status='Pending Quality'")).n;
  d.needsCorrection = (await one("select count(*)::int n from inward where status='Needs Correction'")).n;
  d.inTransit = (await one("select count(*)::int n from outward where status='In Transit'")).n;
  const s = await one('select coalesce(sum(avail),0)::int avail, coalesce(sum(damaged),0)::int damaged, coalesce(sum(transit),0)::int transit from inventory');
  Object.assign(d, s);
  d.byWarehouse = (await q(`select w.name, coalesce(sum(i.avail),0)::int avail, coalesce(sum(i.damaged),0)::int damaged, coalesce(sum(i.transit),0)::int transit
    from warehouses w left join inventory i on i.warehouse_id=w.id where w.active group by w.id order by w.name`)).rows;
  const role = req.user.role;
  const mine = role === 'Finance' ? d.pendingFinance : role === 'Quality' ? d.pendingQualityIn + d.pendingQualityOut : role === 'Admin' ? d.pendingFinance + d.pendingQualityIn + d.pendingQualityOut : 0;
  d.awaitingMe = mine + (role === 'Staff' || role === 'Admin' ? d.inTransit + d.needsCorrection : 0);
  d.recent = (await q(`select a.*, coalesce(i.no,o.no) tx_no from activity a left join inward i on a.kind='inward' and i.id=a.tx_id left join outward o on a.kind='outward' and o.id=a.tx_id order by a.id desc limit 8`)).rows;
  res.json(d);
}));

r.get('/pending-count', ah(async (req, res) => {
  const role = req.user.role, admin = role === 'Admin';
  let n = 0;
  if (admin || role === 'Finance') n += (await q("select count(*)::int n from inward where status='Pending Finance'")).rows[0].n;
  if (admin || role === 'Quality') {
    n += (await q("select count(*)::int n from inward where status='Pending Quality'")).rows[0].n;
    n += (await q("select count(*)::int n from outward where status='Pending Quality'")).rows[0].n;
  }
  if (admin || role === 'Staff') {
    n += (await q("select count(*)::int n from outward where status='In Transit'")).rows[0].n;
    n += (await q("select count(*)::int n from inward where status='Needs Correction'")).rows[0].n;
  }
  res.json({ n });
}));

/* damaged goods caused in transport – for claims on the transporter */
r.get('/claims', ah(async (req, res) => {
  const p = [], w = ["it.damage_cause='Transport damage'", 'it.damaged>0', "i.status<>'Rejected'"];
  if (req.query.transporter) { p.push(req.query.transporter); w.push(`lower(i.transporter)=lower($${p.length})`); }
  if (req.query.q) { p.push('%' + String(req.query.q).toLowerCase() + '%'); w.push(`lower(i.no||' '||i.supplier||' '||i.transporter||' '||i.lr||' '||it.product||' '||it.sku) like $${p.length}`); }
  res.json((await q(`select i.id inward_id, i.no, i.received_date date, i.supplier, i.transporter, i.lr, i.vehicle, i.status, w.name warehouse,
      it.product, it.sku, it.batch, it.damaged staff_damaged, coalesce(it.qc_damaged, it.damaged) damaged,
      (select count(*)::int from documents d where d.kind='inward' and d.tx_id=i.id and d.doc_type='Damaged Box Photo' and not d.deleted) photos
    from inward_items it join inward i on i.id=it.inward_id join warehouses w on w.id=i.warehouse_id
    where ${w.join(' and ')} order by i.received_date desc, i.id desc limit 500`, p)).rows);
}));

export default r;
