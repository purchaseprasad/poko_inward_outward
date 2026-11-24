import { Router } from 'express';
import multer from 'multer';
import { q, tx, ah, HttpError } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { nextNo, logAct, applyMoves, saveDoc, hasDoc, up, str, isDate, isInt, todayKey, DOC_COLS } from '../common.js';
import { openAppMail, approvalMail, infoMail } from '../mailer.js';

/* Flow:  Staff -> Quality (physical check + QC form) -> Finance (invoice & quantity) -> Approved (stock added)
   Quality / Finance can also SEND BACK for correction (entry returns to Staff, or Finance -> Quality) or REJECT for good. */
export const STAGE_ROLE = { 'Pending Quality': 'Quality', 'Pending Finance': 'Finance' };
export const CAUSES = ['Transport damage', 'Supplier packing', 'Handling at warehouse', 'Other'];
export const PACKAGING = ['Good', 'Slightly damaged', 'Badly damaged'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 30 } });

/* make sure the product exists in the master list (new products typed by staff are added here) */
async function ensureProduct(c, name, sku, errs, label) {
  const ex = (await c.query('select * from products where lower(name)=lower($1)', [name])).rows[0];
  if (ex) {
    if (ex.sku && sku && ex.sku !== sku) { errs.push(`${label}: product "${ex.name}" already has SKU ${ex.sku}. Use that SKU.`); return; }
    if (!ex.sku && sku) {
      const clash = (await c.query('select name from products where upper(sku)=$1 and id<>$2', [sku, ex.id])).rows[0];
      if (clash) { errs.push(`${label}: SKU ${sku} already belongs to "${clash.name}".`); return; }
      await c.query('update products set sku=$1 where id=$2', [sku, ex.id]);
    }
    if (!ex.active) await c.query('update products set active=true where id=$1', [ex.id]);
    return;
  }
  const clash = (await c.query('select name from products where upper(sku)=$1', [sku])).rows[0];
  if (clash) { errs.push(`${label}: SKU ${sku} already belongs to "${clash.name}". Pick that product, or use a different SKU.`); return; }
  await c.query('insert into products(name,sku) values($1,$2)', [name, sku]);
}

/* the checks shared by "create" and "correct & resubmit" */
async function prepareInward(c, d, { types = [], viaBulk = false, existingId = null, hasPhoto = false, skipInvoiceRule = false } = {}) {
  const errs = [];
  const wh = (await c.query('select * from warehouses where id=$1 and active', [d.warehouse_id])).rows[0];
  if (!wh) errs.push('Please choose a valid warehouse.');
  const supplier = str(d.supplier), inv = str(d.invoice_no), recv = str(d.received_date);
  if (!supplier) errs.push('Supplier name is required.');
  if (!inv) errs.push('Supplier invoice number is required.');
  if (!isDate(recv)) errs.push('Received date is required.');
  else if (recv > todayKey()) errs.push('Received date cannot be in the future.');
  if (d.invoice_date && !isDate(d.invoice_date)) errs.push('Invoice date is not a valid date.');
  if (supplier && inv) {
    const dup = (await c.query("select no from inward where lower(supplier)=lower($1) and lower(invoice_no)=lower($2) and status<>'Rejected' and ($3::int is null or id<>$3)", [supplier, inv, existingId])).rows[0];
    if (dup) errs.push(`Duplicate invoice: invoice "${inv}" from "${supplier}" is already entered as ${dup.no}.`);
  }
  if (!viaBulk && !skipInvoiceRule && !types.includes('Purchase Invoice')) errs.push('Purchase Invoice is compulsory – upload the supplier invoice in the Documents box.');
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) errs.push('Add at least one product.');
  const seen = new Set(), clean = [];
  items.forEach((it, i) => {
    const n = `Line ${i + 1}: `, product = str(it.product), sku = up(it.sku), batch = up(it.batch);
    if (!product) return errs.push(n + 'product is required.');
    if (!sku) return errs.push(n + `SKU is required for "${product}".`);
    if (!batch) return errs.push(n + 'batch number is required.');
    const k = sku + '|' + batch;
    if (seen.has(k)) return errs.push(n + `batch ${batch} of ${sku} is listed twice – combine the quantities.`);
    seen.add(k);
    const exp = it.expected === '' || it.expected == null ? 0 : +it.expected;
    for (const [f, label] of [['received', 'Received'], ['accepted', 'Accepted'], ['damaged', 'Damaged']]) {
      const v = it[f] === '' || it[f] == null ? (f === 'received' ? '' : 0) : it[f];
      if (!isInt(v) || +v < 0) return errs.push(n + `${label} quantity must be a whole number (0 or more).`);
    }
    const rec = +it.received, acc = +(it.accepted || 0), dam = +(it.damaged || 0);
    if (!Number.isInteger(exp) || exp < 0) return errs.push(n + 'Expected quantity must be a whole number.');
    if (acc + dam > rec) return errs.push(n + `Accepted (${acc}) + Damaged (${dam}) cannot be more than Received (${rec}).`);
    if (it.expiry && !isDate(it.expiry)) return errs.push(n + 'Expiry date is not valid.');
    let cause = str(it.damage_cause);
    if (cause) { const m = CAUSES.find((x) => x.toLowerCase() === cause.toLowerCase()); if (!m) return errs.push(n + `damage cause must be one of: ${CAUSES.join(', ')}.`); cause = m; }
    if (dam > 0 && !cause && !viaBulk) return errs.push(n + `${dam} damaged – please choose what caused the damage (e.g. Transport damage).`);
    if (dam === 0) cause = '';
    clean.push({ product, sku, batch, expiry: it.expiry || null, expected: exp, received: rec, accepted: acc, damaged: dam, damage_cause: cause,
      short: exp ? Math.max(exp - rec, 0) : 0, excess: exp ? Math.max(rec - exp, 0) : 0, label: n.slice(0, -2) });
  });
  if (!viaBulk && clean.some((i) => i.damaged > 0 && i.damage_cause === 'Transport damage') && !hasPhoto && !types.includes('Damaged Box Photo'))
    errs.push('Transport damage needs proof – upload at least one "Damaged Box Photo" in the Documents box (it is used for the transporter claim).');
  if (!errs.length) {
    const done = new Set();
    for (const it of clean) {
      const k = it.product.toLowerCase() + '|' + it.sku;
      if (done.has(k)) continue;
      done.add(k);
      await ensureProduct(c, it.product, it.sku, errs, it.label);
    }
  }
  if (errs.length) throw new HttpError(400, 'Please fix the following:', errs);
  return { wh, supplier, inv, recv, clean };
}

const insertItem = (c, id, it) => c.query(
  'insert into inward_items(inward_id,product,sku,batch,expiry,expected,received,accepted,damaged,damage_cause,short,excess) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
  [id, it.product, it.sku, it.batch, it.expiry, it.expected, it.received, it.accepted, it.damaged, it.damage_cause, it.short, it.excess]);

/* Creates one inward entry inside the caller's transaction. Used by the form AND the bulk upload. */
export async function createInward(c, d, user, { files = [], types = [], viaBulk = false, autoApprove = false } = {}) {
  const { wh, supplier, inv, recv, clean } = await prepareInward(c, d, { types, viaBulk });
  const no = await nextNo(c, 'GRN', wh.code, recv);
  const status = autoApprove ? 'Approved' : 'Pending Quality';
  const r = (await c.query(
    `insert into inward(no,warehouse_id,supplier,po,invoice_no,invoice_date,received_date,challan,transporter,vehicle,lr,remarks,status,via_bulk,created_by)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [no, wh.id, supplier, str(d.po), inv, d.invoice_date || null, recv, str(d.challan), str(d.transporter), str(d.vehicle), str(d.lr), str(d.remarks), status, viaBulk, user.id])).rows[0];
  for (const it of clean) await insertItem(c, r.id, it);
  await c.query('insert into vendors(name) values($1) on conflict do nothing', [supplier]);
  if (str(d.transporter)) await c.query('insert into transporters(name) values($1) on conflict do nothing', [str(d.transporter)]);
  for (let i = 0; i < files.length; i++) await saveDoc(c, { kind: 'inward', txId: r.id, docType: types[i], file: files[i], user });
  if (autoApprove) {
    await applyMoves(c, inwardMoves(wh.id, no, clean), user);
    await logAct(c, 'inward', r.id, user, 'Created via bulk upload – approved directly (opening stock)');
  } else {
    await logAct(c, 'inward', r.id, user, viaBulk ? 'Created via bulk upload – sent to Quality for QC' : 'Created – sent to Quality for QC');
  }
  return { id: r.id, no, supplier, invoice_no: inv, status };
}

export function inwardMoves(wh, no, items) {
  const mv = [];
  for (const i of items) {
    const b = { wh, sku: i.sku, product: i.product, batch: i.batch, expiry: i.expiry, ref: no };
    if (i.accepted > 0) mv.push({ ...b, bucket: 'avail', qty: i.accepted, type: 'Inward GRN' });
    if (i.damaged > 0) mv.push({ ...b, bucket: 'damaged', qty: i.damaged, type: 'Inward Damaged' });
  }
  return mv;
}

const r = Router();
r.use(requireAuth);

const LIST_SQL = `select 'inward' kind, i.id, i.no, i.received_date date, w.name warehouse, i.supplier title, 'Invoice ' || i.invoice_no party, i.invoice_no, i.lr,
  (select coalesce(sum(received),0)::int from inward_items where inward_id=i.id) units,
  (select coalesce(sum(accepted),0)::int from inward_items where inward_id=i.id) accepted,
  (select coalesce(sum(damaged),0)::int from inward_items where inward_id=i.id) damaged,
  u.name created_by_name, i.created_by, i.created_at, i.status, i.via_bulk, i.reject_reason, i.return_reason, i.return_corrections, i.return_by,
  (select coalesce(array_agg(distinct doc_type),'{}') from documents d where d.kind='inward' and d.tx_id=i.id and not d.deleted) docs
  from inward i join warehouses w on w.id=i.warehouse_id join users u on u.id=i.created_by`;

export async function listInward(f = {}) {
  const p = [], w = [];
  if (f.status) { p.push(f.status); w.push(`i.status=$${p.length}`); }
  if (f.warehouse_id) { p.push(f.warehouse_id); w.push(`i.warehouse_id=$${p.length}`); }
  if (f.by) { p.push(f.by); w.push(`i.created_by=$${p.length}`); }
  if (f.from) { p.push(f.from); w.push(`i.received_date>=$${p.length}`); }
  if (f.to) { p.push(f.to); w.push(`i.received_date<=$${p.length}`); }
  if (f.q) { p.push('%' + String(f.q).toLowerCase() + '%'); w.push(`lower(i.no||' '||i.supplier||' '||i.invoice_no||' '||i.lr||' '||u.name) like $${p.length}`); }
  if (f.statuses) { p.push(f.statuses); w.push(`i.status = any($${p.length})`); }
  return (await q(`${LIST_SQL} ${w.length ? 'where ' + w.join(' and ') : ''} order by i.created_at desc limit 500`, p)).rows;
}

r.get('/', ah(async (req, res) => res.json(await listInward(req.query))));

r.get('/:id', ah(async (req, res) => {
  const t = (await q(`select i.*, w.name warehouse, u.name created_by_name from inward i join warehouses w on w.id=i.warehouse_id join users u on u.id=i.created_by where i.id=$1`, [req.params.id])).rows[0];
  if (!t) throw new HttpError(404, 'Entry not found.');
  const items = (await q('select * from inward_items where inward_id=$1 order by id', [t.id])).rows;
  const docs = (await q("select id,kind,tx_id,doc_type,version,file_name,mime,size,uploaded_by,deleted,created_at from documents where kind='inward' and tx_id=$1 and not deleted order by id", [t.id])).rows;
  const activity = (await q("select * from activity where kind='inward' and tx_id=$1 order by id", [t.id])).rows;
  res.json({ kind: 'inward', tx: t, items, docs, activity });
}));

/* ---------- e-mail helpers ---------- */
async function mailInfo(id) {
  const t = (await q(`select i.*, w.name warehouse, u.name by from inward i join warehouses w on w.id=i.warehouse_id join users u on u.id=i.created_by where i.id=$1`, [id])).rows[0];
  const items = (await q('select * from inward_items where inward_id=$1 order by id', [id])).rows;
  const sum = (k) => items.reduce((a, x) => a + (x[k] ?? 0), 0);
  const lines = [['Entry', t.no], ['Supplier', t.supplier], ['Invoice', t.invoice_no], ['Warehouse', t.warehouse]];
  if (t.transporter) lines.push(['Transporter', t.transporter + (t.lr ? ' · LR ' + t.lr : '')]);
  lines.push(['Staff entered', `received ${sum('received')} · accepted ${sum('accepted')} · damaged ${sum('damaged')}`]);
  const causes = [...new Set(items.filter((x) => x.damaged > 0 && x.damage_cause).map((x) => x.damage_cause))];
  if (causes.length) lines.push(['Damage cause', causes.join(', ')]);
  const hasQc = items.some((x) => x.qc_received != null);
  let diffNote = '';
  if (hasQc) {
    lines.push(['Quality counted', `received ${sum('qc_received')} · accepted ${sum('qc_accepted')} · damaged ${sum('qc_damaged')}`]);
    const diffs = items.filter((x) => x.qc_received !== x.received || x.qc_accepted !== x.accepted || x.qc_damaged !== x.damaged);
    if (diffs.length) diffNote = '⚠ Quality counts differ from the staff entry: ' + diffs.map((x) => `${x.product} / ${x.batch}: staff ${x.received}-${x.accepted}-${x.damaged}, Quality ${x.qc_received}-${x.qc_accepted}-${x.qc_damaged}`).join('; ');
    lines.push(['Packaging', t.qc_packaging || '—'], ['Batch & expiry match', t.qc_batch_ok ? 'Yes' : 'NO'], ['Checked by', (t.qc_by || '—')]);
    if (t.qc_remarks) lines.push(['Quality remarks', t.qc_remarks]);
  }
  lines.push(['Created by', t.by]);
  return { t, lines, diffNote };
}
const mailQuality = async (id, note = '') => { const m = await mailInfo(id); openAppMail('Quality', `Quality (QC) check needed: inward ${m.t.no}`, { title: 'Inward entry – physical check & QC form', lines: m.lines, kind: 'inward', id, note, buttonText: 'Open the QC form' }); };
const mailFinance = async (id, note = '') => { const m = await mailInfo(id); approvalMail('Finance', `Approval needed: inward ${m.t.no} (invoice & quantity)`, { title: 'Inward entry – Finance approval (QC is done)', lines: m.lines, kind: 'inward', id, status: 'Pending Finance', actions: ['approve', 'back', 'reject'], note: note || m.diffNote }); };
const safe = (p) => p.catch((e) => console.error('[mail]', e.message));

/* ---------- create ---------- */
r.post('/', requireRole('Staff', 'Admin'), upload.array('files', 30), ah(async (req, res) => {
  let d, types;
  try { d = JSON.parse(req.body.data || '{}'); types = JSON.parse(req.body.types || '[]'); } catch { throw new HttpError(400, 'Bad form data.'); }
  const files = req.files || [];
  if (files.length !== types.length) throw new HttpError(400, 'Every file needs a document type.');
  const out = await tx((c) => createInward(c, d, req.user, { files, types }));
  safe(mailQuality(out.id));
  res.json(out);
}));

async function lockInward(c, id) {
  const t = (await c.query('select i.*, w.code wh_code from inward i join warehouses w on w.id=i.warehouse_id where i.id=$1 for update of i', [id])).rows[0];
  if (!t) throw new HttpError(404, 'Entry not found.');
  return t;
}
const canAct = (user, status) => STAGE_ROLE[status] && (user.role === 'Admin' || user.role === STAGE_ROLE[status]);

/* ---------- Staff corrects an entry that was sent back, and resubmits ---------- */
export async function inwardResubmit(user, id, d) {
  if (!['Staff', 'Admin'].includes(user.role)) throw new HttpError(403, 'Only Staff can correct an entry.');
  const out = await tx(async (c) => {
    const t = await lockInward(c, id);
    if (t.status !== 'Needs Correction') throw new HttpError(409, `This entry is “${t.status}” – only entries that were sent back can be corrected.`);
    if (!(await hasDoc(c, 'inward', id, 'Purchase Invoice'))) throw new HttpError(400, 'Please fix the following:', ['Upload the Purchase Invoice first (open the entry → Documents).']);
    const hasPhoto = await hasDoc(c, 'inward', id, 'Damaged Box Photo');
    const p = await prepareInward(c, { ...d, warehouse_id: t.warehouse_id }, { existingId: id, hasPhoto, skipInvoiceRule: true });
    const old = (await c.query('select product,sku,batch,expiry,expected,received,accepted,damaged,damage_cause from inward_items where inward_id=$1', [id])).rows;
    const sig = (a) => JSON.stringify(a.map((x) => [x.product, up(x.sku), up(x.batch), x.expiry ? String(x.expiry).slice(0, 10) : null, +x.expected, +x.received, +x.accepted, +x.damaged, x.damage_cause || '']).sort());
    const changed = sig(old) !== sig(p.clean);
    const status = changed || !t.resume_stage ? 'Pending Quality' : t.resume_stage;
    await c.query(`update inward set supplier=$1,po=$2,invoice_no=$3,invoice_date=$4,received_date=$5,challan=$6,transporter=$7,vehicle=$8,lr=$9,remarks=$10,status=$11,
      return_to=null,return_by=null,return_reason=null,return_corrections=null,resume_stage=null where id=$12`,
      [p.supplier, str(d.po), p.inv, d.invoice_date || null, p.recv, str(d.challan), str(d.transporter), str(d.vehicle), str(d.lr), str(d.remarks), status, id]);
    if (changed) {
      await c.query('delete from inward_items where inward_id=$1', [id]);
      for (const it of p.clean) await insertItem(c, id, it);
      await c.query('update inward set qc_by=null,qc_at=null,qc_packaging=null,qc_batch_ok=null,qc_remarks=null where id=$1', [id]);
    }
    if (str(d.transporter)) await c.query('insert into transporters(name) values($1) on conflict do nothing', [str(d.transporter)]);
    await logAct(c, 'inward', id, user, `Corrected and resubmitted – back to ${status === 'Pending Quality' ? 'Quality' : 'Finance'}`, changed ? 'Quantities / items were changed' : 'Details corrected');
    return { id, no: t.no, status };
  });
  safe(out.status === 'Pending Quality' ? mailQuality(id, '✏ Corrected by Staff and resubmitted.') : mailFinance(id, '✏ Corrected by Staff and resubmitted.'));
  return out;
}
r.put('/:id', requireRole('Staff', 'Admin'), ah(async (req, res) => res.json({ ok: true, ...(await inwardResubmit(req.user, req.params.id, req.body)) })));

/* ---------- Quality: the QC form ---------- */
export async function inwardQc(user, id, b) {
  if (!['Quality', 'Admin'].includes(user.role)) throw new HttpError(403, 'Only Quality can fill the QC form.');
  const result = b.result;
  if (!['approve', 'send_back', 'reject'].includes(result)) throw new HttpError(400, 'Choose Approve, Send back or Reject.');
  const reason = str(b.reason), corrections = str(b.corrections);
  const out = await tx(async (c) => {
    const t = await lockInward(c, id);
    if (t.status !== 'Pending Quality') throw new HttpError(409, `This entry is already “${t.status}”.`);
    if (result === 'reject') {
      if (!reason) throw new HttpError(400, 'A reason is required to reject.');
      await c.query("update inward set status='Rejected', reject_reason=$1, rejected_by=$2 where id=$3", [reason, user.name + ' (Quality)', id]);
      await logAct(c, 'inward', id, user, 'Rejected by Quality', reason);
      return { t, result };
    }
    if (result === 'send_back') {
      if (!reason || !corrections) throw new HttpError(400, 'Please fix the following:', [!reason && 'Write the reason.', !corrections && 'Write what must be corrected.'].filter(Boolean));
      await c.query("update inward set status='Needs Correction', return_to='Staff', return_by=$1, return_reason=$2, return_corrections=$3, resume_stage='Pending Quality' where id=$4", [user.name + ' (Quality)', reason, corrections, id]);
      await logAct(c, 'inward', id, user, 'Quality sent back to Staff for correction', `${reason} — Correct: ${corrections}`);
      return { t, result };
    }
    const items = (await c.query('select * from inward_items where inward_id=$1 order by id', [id])).rows;
    const byId = new Map((Array.isArray(b.items) ? b.items : []).map((x) => [+x.id, x]));
    const errs = [], vals = [];
    for (const it of items) {
      const v = byId.get(it.id), n = `${it.product} / batch ${it.batch}: `;
      if (!v) { errs.push(n + 'enter the quantities you counted.'); continue; }
      const ok = ['received', 'accepted', 'damaged'].every((k) => isInt(v[k]) && +v[k] >= 0);
      if (!ok) { errs.push(n + 'quantities must be whole numbers (0 or more).'); continue; }
      if (+v.accepted + +v.damaged > +v.received) { errs.push(n + `accepted (${v.accepted}) + damaged (${v.damaged}) cannot be more than received (${v.received}).`); continue; }
      vals.push({ id: it.id, rec: +v.received, acc: +v.accepted, dam: +v.damaged });
    }
    if (!PACKAGING.includes(b.packaging)) errs.push('Choose the packaging condition.');
    if (typeof b.batch_ok !== 'boolean') errs.push('Tick whether the batch number and expiry match the documents.');
    if (b.batch_ok === false && !str(b.remarks)) errs.push('Batch / expiry does not match – write the details in Remarks.');
    if (errs.length) throw new HttpError(400, 'Please fix the following:', errs);
    for (const v of vals) await c.query('update inward_items set qc_received=$1,qc_accepted=$2,qc_damaged=$3 where id=$4', [v.rec, v.acc, v.dam, v.id]);
    await c.query("update inward set status='Pending Finance', qc_by=$1, qc_at=now(), qc_packaging=$2, qc_batch_ok=$3, qc_remarks=$4, return_to=null, return_by=null, return_reason=null, return_corrections=null, resume_stage=null where id=$5",
      [user.name, b.packaging, b.batch_ok, str(b.remarks), id]);
    const diffs = items.filter((it) => { const v = vals.find((x) => x.id === it.id); return v.rec !== it.received || v.acc !== it.accepted || v.dam !== it.damaged; });
    await logAct(c, 'inward', id, user, 'Quality (QC) form filled and approved – sent to Finance', diffs.length ? `Counts differ from staff for ${diffs.length} line(s)` : 'Counts match the staff entry');
    return { t, result };
  });
  const m = await mailInfo(id);
  if (out.result === 'approve') {
    safe(mailFinance(id));
    infoMail({ roles: ['Admin'], userIds: [out.t.created_by] }, `Inward ${out.t.no} – Quality (QC) approved, sent to Finance`,
      { title: '✔ Quality (QC) approved', lines: m.lines, note: m.diffNote, color: '#0d7a45' });
  } else {
    const word = out.result === 'reject' ? 'rejected' : 'sent back for correction';
    infoMail({ roles: ['Admin'], userIds: [out.t.created_by] }, `Inward ${out.t.no} – ${word} by Quality`,
      { title: out.result === 'reject' ? '✖ Rejected by Quality' : '↩ Sent back for correction by Quality', lines: m.lines,
        note: `<b>Reason:</b> ${reason.replace(/</g, '&lt;')}${corrections ? `<br><b>Please correct:</b> ${corrections.replace(/</g, '&lt;')}` : ''}${out.result === 'send_back' ? '<br>Open the entry in the app, correct it and resubmit.' : ''}`, color: '#b42323' });
  }
  return { status: out.result === 'approve' ? 'Pending Finance' : out.result === 'reject' ? 'Rejected' : 'Needs Correction' };
}
r.post('/:id/qc', ah(async (req, res) => res.json({ ok: true, ...(await inwardQc(req.user, req.params.id, req.body)) })));

/* ---------- Finance: final approval (also used by the Approve link in the e-mail) ---------- */
export async function inwardApprove(user, id, note) {
  const out = await tx(async (c) => {
    const t = await lockInward(c, id);
    if (t.status === 'Pending Quality') throw new HttpError(409, 'Quality must fill the QC form first.');
    if (t.status !== 'Pending Finance') throw new HttpError(409, `This entry is already “${t.status}”.`);
    if (!canAct(user, t.status)) throw new HttpError(403, 'Only Finance can give this approval.');
    if (!(await hasDoc(c, 'inward', t.id, 'Purchase Invoice'))) throw new HttpError(409, "Cannot approve yet: the Purchase Invoice is not uploaded. Upload it from the entry's Documents.");
    const items = (await c.query('select * from inward_items where inward_id=$1', [t.id])).rows
      .map((i) => ({ ...i, accepted: i.qc_accepted ?? i.accepted, damaged: i.qc_damaged ?? i.damaged }));
    await applyMoves(c, inwardMoves(t.warehouse_id, t.no, items), user);
    await c.query("update inward set status='Approved' where id=$1", [t.id]);
    await logAct(c, 'inward', t.id, user, 'Final approval by Finance (invoice & received quantity verified) – stock updated', str(note));
    return t;
  });
  const m = await mailInfo(id);
  infoMail({ roles: ['Quality', 'Admin'], userIds: [out.created_by] }, `Inward ${out.no} approved – stock updated`, { title: '✔ Final approval by Finance – stock updated', lines: m.lines, color: '#0d7a45' });
  return { status: 'Approved' };
}

/* ---------- Finance: send back for correction ---------- */
export async function inwardSendBack(user, id, b) {
  const to = b.to, reason = str(b.reason), corrections = str(b.corrections);
  if (!['Staff', 'Quality'].includes(to)) throw new HttpError(400, 'Choose who should correct it: Staff or Quality.');
  if (!reason || !corrections) throw new HttpError(400, 'Please fix the following:', [!reason && 'Write the reason.', !corrections && 'Write what must be corrected.'].filter(Boolean));
  const out = await tx(async (c) => {
    const t = await lockInward(c, id);
    if (t.status !== 'Pending Finance') throw new HttpError(409, `This entry is already “${t.status}”.`);
    if (!canAct(user, t.status)) throw new HttpError(403, 'Only Finance can send this back.');
    const who = user.name + ' (' + user.role + ')';
    if (to === 'Staff') await c.query("update inward set status='Needs Correction', return_to='Staff', return_by=$1, return_reason=$2, return_corrections=$3, resume_stage='Pending Finance' where id=$4", [who, reason, corrections, id]);
    else await c.query("update inward set status='Pending Quality', return_to='Quality', return_by=$1, return_reason=$2, return_corrections=$3, resume_stage=null where id=$4", [who, reason, corrections, id]);
    await logAct(c, 'inward', id, user, `Finance sent back to ${to} for correction`, `${reason} — Correct: ${corrections}`);
    return t;
  });
  const m = await mailInfo(id);
  const note = `<b>Reason:</b> ${reason.replace(/</g, '&lt;')}<br><b>Please correct:</b> ${corrections.replace(/</g, '&lt;')}`;
  if (to === 'Quality') {
    safe(mailQuality(id, '↩ Finance sent this back to Quality. ' + note));
    infoMail({ roles: ['Admin'], userIds: [out.created_by] }, `Inward ${out.no} – Finance sent back to Quality`, { title: '↩ Finance sent it back to Quality', lines: m.lines, note, color: '#c76a06' });
  } else {
    infoMail({ roles: ['Admin', 'Quality'], userIds: [out.created_by] }, `Inward ${out.no} – sent back to Staff for correction`, { title: '↩ Finance sent it back to Staff', lines: m.lines, note: note + '<br>Staff: open the entry in the app, correct it and resubmit.', color: '#c76a06' });
  }
  return { status: to === 'Quality' ? 'Pending Quality' : 'Needs Correction' };
}

/* ---------- reject for good (Quality or Finance, at their own stage) ---------- */
export async function inwardReject(user, id, reasonRaw) {
  const reason = str(reasonRaw);
  if (!reason) throw new HttpError(400, 'A reason is required to reject.');
  const out = await tx(async (c) => {
    const t = await lockInward(c, id);
    if (!STAGE_ROLE[t.status]) throw new HttpError(409, `This entry is already “${t.status}”.`);
    if (!canAct(user, t.status)) throw new HttpError(403, `Only ${STAGE_ROLE[t.status]} can reject at this stage.`);
    await c.query("update inward set status='Rejected', reject_reason=$1, rejected_by=$2 where id=$3", [reason, user.name + ' (' + user.role + ')', t.id]);
    await logAct(c, 'inward', t.id, user, 'Rejected', reason);
    return t;
  });
  const m = await mailInfo(id);
  infoMail({ roles: ['Admin', 'Quality', 'Finance'], userIds: [out.created_by] }, `Inward ${out.no} rejected`, { title: '✖ Entry rejected', lines: m.lines, note: `<b>Reason:</b> ${reason.replace(/</g, '&lt;')}`, color: '#b42323' });
  return { status: 'Rejected' };
}

r.post('/:id/approve', ah(async (req, res) => res.json({ ok: true, ...(await inwardApprove(req.user, req.params.id, req.body.note)) })));
r.post('/:id/send-back', ah(async (req, res) => res.json({ ok: true, ...(await inwardSendBack(req.user, req.params.id, req.body)) })));
r.post('/:id/reject', ah(async (req, res) => res.json({ ok: true, ...(await inwardReject(req.user, req.params.id, req.body.reason)) })));

export default r;
