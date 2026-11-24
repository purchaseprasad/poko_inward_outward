import { Router } from 'express';
import multer from 'multer';
import { q, tx, ah, HttpError } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { nextNo, logAct, applyMoves, saveDoc, hasDoc, up, str, isDate, isInt, todayKey } from '../common.js';
import { notifyUser, mailHtml, approvalMail } from '../mailer.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 30 } });

/* Creates one outward / transfer / employee-issue entry inside the caller's transaction (form + bulk upload) */
export async function createOutward(c, d, user, { files = [], types = [], viaBulk = false } = {}) {
  const errs = [];
  const wh = (await c.query('select * from warehouses where id=$1 and active', [d.warehouse_id])).rows[0];
  if (!wh) errs.push('Please choose a valid source warehouse.');
  const typeName = str(d.type);
  if (!typeName) errs.push('Please choose the outward type (Blinkit, BigBasket, Amazon, Flipkart …).');
  let type = typeName ? (await c.query('select * from outward_types where lower(name)=lower($1)', [typeName])).rows[0] : null;
  if (typeName && !type) type = (await c.query("insert into outward_types(name,kind) values($1,'sale') returning *", [typeName])).rows[0];
  const date = str(d.out_date);
  if (!isDate(date)) errs.push('Date is required.');
  else if (date > todayKey()) errs.push('Date cannot be in the future.');
  const kind = type?.kind || 'sale';
  let dest = null;
  if (kind === 'transfer') {
    dest = (await c.query('select * from warehouses where id=$1 and active', [d.dest_warehouse_id])).rows[0];
    if (!dest) errs.push('Please choose the destination warehouse.');
    else if (wh && dest.id === wh.id) errs.push('Destination warehouse must be different from the source warehouse.');
  }
  if (kind === 'employee') {
    if (!str(d.emp_no)) errs.push('Employee number is required.');
    if (!str(d.emp_name)) errs.push('Employee name is required.');
  }
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) errs.push('Add at least one item.');
  const bucket = kind === 'damaged' ? 'damaged' : 'avail';
  const used = new Map(), clean = [];
  for (let i = 0; i < items.length && wh; i++) {
    const it = items[i], n = `Item ${i + 1}: `, sku = up(it.sku), batch = up(it.batch);
    if (!sku || !batch) { errs.push(n + 'please pick the product and the batch.'); continue; }
    if (!isInt(it.qty) || +it.qty <= 0) { errs.push(n + 'quantity must be a whole number more than 0.'); continue; }
    const inv = (await c.query('select * from inventory where warehouse_id=$1 and sku=$2 and batch=$3', [wh.id, sku, batch])).rows[0];
    const have = inv ? inv[bucket] : 0;
    if (!inv || have <= 0) { errs.push(n + `no ${bucket === 'damaged' ? 'damaged' : 'available'} stock of ${sku} / batch ${batch} in ${wh.name}.`); continue; }
    const k = sku + '|' + batch, tot = (used.get(k) || 0) + +it.qty;
    used.set(k, tot);
    if (tot > have) { errs.push(n + `quantity ${tot} is more than available stock (${have}) for ${sku} / batch ${batch}. Dispatch blocked.`); continue; }
    clean.push({ sku, product: inv.product, batch, expiry: inv.expiry, qty: +it.qty });
  }
  if (errs.length) throw new HttpError(400, 'Please fix the following:', errs);

  const no = await nextNo(c, kind === 'employee' ? 'EMP' : 'OUT', wh.code, date);
  const empNo = str(d.emp_no), empName = str(d.emp_name);
  const party = kind === 'employee' ? `${empNo} – ${empName}` : str(d.party);
  const r = (await c.query(
    `insert into outward(no,warehouse_id,type,kind,out_date,dest_warehouse_id,party,transporter,vehicle,lr,eway,gate,remarks,emp_no,emp_name,dept,purpose,status,via_bulk,created_by)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Pending Quality',$18,$19) returning id`,
    [no, wh.id, type.name, kind, date, dest?.id || null, party, str(d.transporter), str(d.vehicle), str(d.lr), str(d.eway), str(d.gate), str(d.remarks),
      empNo, empName, str(d.dept), str(d.purpose), viaBulk, user.id])).rows[0];
  for (const it of clean) await c.query('insert into outward_items(outward_id,sku,product,batch,expiry,qty) values($1,$2,$3,$4,$5,$6)', [r.id, it.sku, it.product, it.batch, it.expiry, it.qty]);
  if (str(d.transporter)) await c.query('insert into transporters(name) values($1) on conflict do nothing', [str(d.transporter)]);
  if (kind === 'employee') {
    await c.query('insert into employees(emp_no,name,dept) values($1,$2,$3) on conflict(lower(emp_no)) do update set name=excluded.name, dept=excluded.dept, active=true', [empNo, empName, str(d.dept)]);
  }
  for (let i = 0; i < files.length; i++) await saveDoc(c, { kind: 'outward', txId: r.id, docType: types[i], file: files[i], user });
  await logAct(c, 'outward', r.id, user, viaBulk ? 'Created via bulk upload – sent to Quality' : 'Created – sent to Quality for approval');
  return { id: r.id, no, type: type.name, kind, status: 'Pending Quality', units: clean.reduce((a, x) => a + x.qty, 0) };
}

function outwardMoves(t, items) {
  const mv = [];
  for (const i of items) {
    const b = { wh: t.warehouse_id, sku: i.sku, product: i.product, batch: i.batch, expiry: i.expiry, ref: t.no };
    if (t.kind === 'damaged') mv.push({ ...b, bucket: 'damaged', qty: -i.qty, type: 'Damaged Disposal' });
    else if (t.kind === 'transfer') {
      mv.push({ ...b, bucket: 'avail', qty: -i.qty, type: 'Transfer Out' });
      mv.push({ ...b, bucket: 'transit', qty: i.qty, type: 'Transfer In-Transit' });
    } else mv.push({ ...b, bucket: 'avail', qty: -i.qty, type: t.kind === 'employee' ? 'Employee Issue' : t.type });
  }
  return mv;
}
function receiptMoves(t, items) {
  const mv = [];
  for (const i of items) {
    const b = { sku: i.sku, product: i.product, batch: i.batch, expiry: i.expiry, ref: t.no };
    mv.push({ ...b, wh: t.warehouse_id, bucket: 'transit', qty: -i.qty, type: 'Transfer Received' });
    mv.push({ ...b, wh: t.dest_warehouse_id, bucket: 'avail', qty: i.qty, type: 'Transfer In' });
  }
  return mv;
}

const r = Router();
r.use(requireAuth);

const LIST_SQL = `select 'outward' kind, o.id, o.no, o.out_date date, w.name warehouse, o.type title, o.kind okind,
  case when o.kind='transfer' then 'To: ' || coalesce(dw.name,'') when o.party<>'' then o.party else '—' end party, o.lr,
  (select coalesce(sum(qty),0)::int from outward_items where outward_id=o.id) units,
  u.name created_by_name, o.created_by, o.created_at, o.status, o.via_bulk, o.reject_reason, o.emp_no, o.emp_name, o.dept, o.purpose,
  (select coalesce(array_agg(distinct doc_type),'{}') from documents d where d.kind='outward' and d.tx_id=o.id and not d.deleted) docs,
  (select coalesce(string_agg(product || ' × ' || qty, ', '),'') from outward_items where outward_id=o.id) products
  from outward o join warehouses w on w.id=o.warehouse_id join users u on u.id=o.created_by left join warehouses dw on dw.id=o.dest_warehouse_id`;

export async function listOutward(f = {}) {
  const p = [], w = [];
  if (f.scope === 'employee') w.push("o.kind='employee'");
  else if (f.scope !== 'all') w.push("o.kind<>'employee'");
  if (f.status) { p.push(f.status); w.push(`o.status=$${p.length}`); }
  if (f.statuses) { p.push(f.statuses); w.push(`o.status = any($${p.length})`); }
  if (f.warehouse_id) { p.push(f.warehouse_id); w.push(`o.warehouse_id=$${p.length}`); }
  if (f.by) { p.push(f.by); w.push(`o.created_by=$${p.length}`); }
  if (f.from) { p.push(f.from); w.push(`o.out_date>=$${p.length}`); }
  if (f.to) { p.push(f.to); w.push(`o.out_date<=$${p.length}`); }
  if (f.q) { p.push('%' + String(f.q).toLowerCase() + '%'); w.push(`lower(o.no||' '||o.type||' '||o.party||' '||o.lr||' '||o.emp_no||' '||o.emp_name||' '||u.name) like $${p.length}`); }
  return (await q(`${LIST_SQL} where ${w.join(' and ')} order by o.created_at desc limit 500`, p)).rows;
}

r.get('/', ah(async (req, res) => res.json(await listOutward(req.query))));

r.get('/:id', ah(async (req, res) => {
  const t = (await q(`select o.*, w.name warehouse, dw.name dest_warehouse, u.name created_by_name from outward o join warehouses w on w.id=o.warehouse_id
    left join warehouses dw on dw.id=o.dest_warehouse_id join users u on u.id=o.created_by where o.id=$1`, [req.params.id])).rows[0];
  if (!t) throw new HttpError(404, 'Entry not found.');
  const items = (await q('select * from outward_items where outward_id=$1 order by id', [t.id])).rows;
  const docs = (await q("select id,kind,tx_id,doc_type,version,file_name,mime,size,uploaded_by,deleted,created_at from documents where kind='outward' and tx_id=$1 and not deleted order by id", [t.id])).rows;
  const activity = (await q("select * from activity where kind='outward' and tx_id=$1 order by id", [t.id])).rows;
  res.json({ kind: 'outward', tx: t, items, docs, activity });
}));

r.post('/', requireRole('Staff', 'Admin'), upload.array('files', 30), ah(async (req, res) => {
  let d, types;
  try { d = JSON.parse(req.body.data || '{}'); types = JSON.parse(req.body.types || '[]'); } catch { throw new HttpError(400, 'Bad form data.'); }
  const files = req.files || [];
  if (files.length !== types.length) throw new HttpError(400, 'Every file needs a document type.');
  const out = await tx((c) => createOutward(c, d, req.user, { files, types }));
  outwardMailLines(out.id).then((m) => approvalMail('Quality', `Approval needed: ${out.kind === 'employee' ? 'employee issue' : 'outward'} ${m.no}`, { title: out.kind === 'employee' ? 'Employee issue – Quality approval' : 'Outward entry – Quality approval', lines: m.lines, kind: 'outward', id: out.id, status: 'Pending Quality' })).catch((e) => console.error('[mail]', e.message));
  res.json(out);
}));

async function lockOutward(c, id) {
  const t = (await c.query('select * from outward where id=$1 for update', [id])).rows[0];
  if (!t) throw new HttpError(404, 'Entry not found.');
  return t;
}

export async function outwardApprove(user, id, note) {
  const out = await tx(async (c) => {
    const t = await lockOutward(c, id);
    if (t.status !== 'Pending Quality') throw new HttpError(409, `This entry is already ${t.status}.`);
    if (!['Quality', 'Admin'].includes(user.role)) throw new HttpError(403, 'Only Quality can give the final approval.');
    if (t.kind === 'sale' && !(await hasDoc(c, 'outward', t.id, 'Sales Invoice'))) throw new HttpError(409, 'Cannot approve yet: the Sales Invoice is not uploaded.');
    const items = (await c.query('select * from outward_items where outward_id=$1', [t.id])).rows;
    await applyMoves(c, outwardMoves(t, items), user);
    const status = t.kind === 'transfer' ? 'In Transit' : 'Approved';
    await c.query('update outward set status=$1 where id=$2', [status, t.id]);
    await logAct(c, 'outward', t.id, user, t.kind === 'transfer' ? 'Final approval by Quality – stock moved to In Transit' : 'Final approval by Quality – stock updated', str(note));
    return { ...t, status };
  });
  notifyUser(out.created_by, `Outward ${out.no} approved`, mailHtml('Outward entry approved', [`<b>${out.no}</b> was approved. Status: ${out.status}.`]));
  return { status: out.status };
}

export async function outwardReject(user, id, reasonRaw) {
  const reason = str(reasonRaw);
  if (!reason) throw new HttpError(400, 'A reason is required to reject.');
  const out = await tx(async (c) => {
    const t = await lockOutward(c, id);
    if (t.status !== 'Pending Quality') throw new HttpError(409, `This entry is already ${t.status}.`);
    if (!['Quality', 'Admin'].includes(user.role)) throw new HttpError(403, 'Only Quality can reject at this stage.');
    await c.query("update outward set status='Rejected', reject_reason=$1, rejected_by=$2 where id=$3", [reason, user.name + ' (' + user.role + ')', t.id]);
    await logAct(c, 'outward', t.id, user, 'Rejected', reason);
    return t;
  });
  notifyUser(out.created_by, `Outward ${out.no} rejected`, mailHtml('Outward entry rejected', [`<b>${out.no}</b> was rejected by ${user.name} (${user.role}).`, `Reason: ${reason}`]));
  return { status: 'Rejected' };
}

export async function outwardMailLines(id) {
  const t = (await q(`select o.no, o.type, o.party, o.kind, w.name warehouse, u.name by, o.emp_no, o.emp_name,
    (select coalesce(sum(qty),0)::int from outward_items where outward_id=o.id) units,
    (select coalesce(string_agg(product || ' × ' || qty, ', '),'') from outward_items where outward_id=o.id) products
    from outward o join warehouses w on w.id=o.warehouse_id join users u on u.id=o.created_by where o.id=$1`, [id])).rows[0];
  const lines = [['Entry', t.no], ['Type', t.type], ['Warehouse', t.warehouse]];
  if (t.kind === 'employee') lines.push(['Employee', t.emp_no + ' – ' + t.emp_name]); else if (t.party) lines.push(['Customer / order', t.party]);
  lines.push(['Products', t.products], ['Units', t.units], ['Created by', t.by]);
  return { no: t.no, lines };
}

r.post('/:id/approve', ah(async (req, res) => res.json({ ok: true, ...(await outwardApprove(req.user, req.params.id, req.body.note)) })));

r.post('/:id/receive', requireRole('Staff', 'Admin'), ah(async (req, res) => {
  await tx(async (c) => {
    const t = await lockOutward(c, req.params.id);
    if (t.status !== 'In Transit') throw new HttpError(409, 'Only transfers that are In Transit can be received.');
    const items = (await c.query('select * from outward_items where outward_id=$1', [t.id])).rows;
    await applyMoves(c, receiptMoves(t, items), req.user);
    await c.query("update outward set status='Received' where id=$1", [t.id]);
    await logAct(c, 'outward', t.id, req.user, 'Destination warehouse confirmed receipt – stock added to available');
  });
  res.json({ ok: true });
}));

r.post('/:id/reject', ah(async (req, res) => res.json({ ok: true, ...(await outwardReject(req.user, req.params.id, req.body.reason)) })));

export default r;
