import { Router } from 'express';
import { q, HttpError } from '../db.js';
import { readMailToken, esc } from '../mailer.js';
import { inwardApprove, inwardReject, inwardSendBack } from './inward.js';
import { outwardApprove, outwardReject } from './outward.js';

/* Approve / Reject links that come in the e-mail. No login needed: the signed link IS the permission.
   It opens a confirmation page first (so mail scanners that "click" links cannot approve anything). */
const r = Router();

const page = (title, body, color = '#c4400f') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;background:#fff7ef;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#2b1810;display:grid;place-items:center;min-height:100vh;padding:16px}
.c{background:#fff;border:1px solid #f0dfd0;border-radius:18px;box-shadow:0 10px 30px -18px rgba(0,0,0,.35);padding:28px;max-width:480px;width:100%}
h1{margin:0 0 6px;font-size:1.4rem;color:${color}} table{border-collapse:collapse;margin:14px 0} td{padding:4px 16px 4px 0} td:first-child{color:#8a6f5f}
textarea{width:100%;min-height:90px;padding:10px;border:2px solid #f0dfd0;border-radius:12px;font:inherit;margin:8px 0}
button{border:0;border-radius:12px;color:#fff;font:inherit;font-weight:700;padding:14px 26px;font-size:1.05rem;cursor:pointer;width:100%}
.ok{background:#0d7a45}.bk{background:#c76a06}.no{background:#b42323}.muted{color:#8a6f5f;font-size:.85rem}.msg{padding:12px;border-radius:12px;margin:12px 0}
.good{background:#dff7ea;color:#0d7a45}.bad{background:#ffe1e1;color:#b42323}.warn{background:#fff1cc;color:#946200}
</style></head><body><div class="c">${body}<p class="muted" style="margin-top:20px">Pokonut Warehouse Inward &amp; Outward Management</p></div></body></html>`;

async function load(kind, id) {
  if (kind === 'inward') {
    return (await q(`select i.no, i.status, i.supplier, i.invoice_no, w.name warehouse, u.name by,
      (select coalesce(sum(received),0)::int from inward_items where inward_id=i.id) rec,
      (select coalesce(sum(accepted),0)::int from inward_items where inward_id=i.id) acc,
      (select coalesce(sum(damaged),0)::int from inward_items where inward_id=i.id) dam
      from inward i join warehouses w on w.id=i.warehouse_id join users u on u.id=i.created_by where i.id=$1`, [id])).rows[0];
  }
  return (await q(`select o.no, o.status, o.type, o.party, o.kind, w.name warehouse, u.name by, o.emp_no, o.emp_name,
    (select coalesce(sum(qty),0)::int from outward_items where outward_id=o.id) units,
    (select coalesce(string_agg(product || ' × ' || qty, ', '),'') from outward_items where outward_id=o.id) products
    from outward o join warehouses w on w.id=o.warehouse_id join users u on u.id=o.created_by where o.id=$1`, [id])).rows[0];
}
const rows = (kind, t) => (kind === 'inward'
  ? [['Entry', t.no], ['Supplier', t.supplier], ['Invoice', t.invoice_no], ['Warehouse', t.warehouse], ['Received', t.rec], ['Accepted', t.acc], ['Damaged', t.dam], ['Created by', t.by]]
  : [['Entry', t.no], ['Type', t.type], ['Warehouse', t.warehouse], ...(t.kind === 'employee' ? [['Employee', t.emp_no + ' – ' + t.emp_name]] : t.party ? [['Customer / order', t.party]] : []), ['Products', t.products], ['Units', t.units], ['Created by', t.by]]);
const table = (kind, t) => `<table>${rows(kind, t).map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>`;

function check(raw) {
  let tk;
  try { tk = readMailToken(String(raw || '')); } catch { throw new HttpError(400, 'This link is not valid or has expired (links work for 7 days). Please open the app and use the Approvals page.'); }
  /* inward: only Finance acts from the mail (Quality must fill the QC form in the app); outward: Quality */
  const role = tk.k === 'inward' ? (tk.st === 'Pending Finance' ? 'Finance' : null) : tk.st === 'Pending Quality' ? 'Quality' : null;
  const okActs = tk.k === 'inward' ? ['approve', 'back', 'reject'] : ['approve', 'reject'];
  if (!role || !okActs.includes(tk.a)) throw new HttpError(400, 'This link is not valid. Please open the app and use the Approvals page.');
  return { ...tk, role };
}
async function prepare(raw) {
  const tk = check(raw);
  const t = await load(tk.k, tk.id);
  if (!t) throw new HttpError(404, 'Entry not found.');
  if (t.status !== tk.st) throw new HttpError(409, `Nothing to do – ${t.no} is already “${t.status}”.`);
  return { tk, t };
}
const fail = (res, e, title = 'Cannot continue') => res.status(e.status || 500).send(page(title, `<h1>${esc(title)}</h1><div class="msg warn">${esc(e instanceof HttpError ? e.message : 'Something went wrong. Please try again from the app.')}</div>`));

r.get('/act', async (req, res) => {
  try {
    const { tk, t } = await prepare(req.query.t);
    const ap = tk.a === 'approve', bk = tk.a === 'back';
    const heading = ap ? '✔ Approve this entry?' : bk ? '↩ Send back for correction?' : '✖ Reject this entry?';
    const fields = ap ? '' : bk
      ? '<label class="muted">Who should correct it?</label><div style="margin:6px 0 10px"><label><input type="radio" name="to" value="Staff" checked> Staff (invoice / entry details)</label><br><label><input type="radio" name="to" value="Quality"> Quality (quantity doubt – check again)</label></div><label class="muted">Reason (required)</label><textarea name="reason" required></textarea><label class="muted">What must be corrected (required)</label><textarea name="corrections" required></textarea>'
      : '<label class="muted">Reason for rejecting (required)</label><textarea name="reason" required autofocus></textarea>';
    res.send(page(heading, `<h1>${heading}</h1>
      <div class="muted">${esc(tk.role)} decision for ${esc(t.no)}</div>${table(tk.k, t)}
      <form method="post" action="/api/mail/act"><input type="hidden" name="t" value="${esc(String(req.query.t))}">
      ${fields}
      <button class="${ap ? 'ok' : bk ? 'bk' : 'no'}">${ap ? '✔ Yes, approve' : bk ? '↩ Send back' : '✖ Reject'}</button></form>`, ap ? '#0d7a45' : bk ? '#c76a06' : '#b42323'));
  } catch (e) { fail(res, e); }
});

r.post('/act', async (req, res) => {
  try {
    const { tk, t } = await prepare(req.body.t);
    const actor = { id: null, name: `${tk.role} team (via e-mail)`, role: tk.role };
    let out;
    if (tk.a === 'back') out = await inwardSendBack(actor, tk.id, { to: req.body.to, reason: req.body.reason, corrections: req.body.corrections });
    else {
      const fn = tk.a === 'approve' ? (tk.k === 'inward' ? inwardApprove : outwardApprove) : (tk.k === 'inward' ? inwardReject : outwardReject);
      out = await fn(actor, tk.id, tk.a === 'approve' ? 'via e-mail link' : String(req.body.reason || '').trim());
    }
    res.send(page('Done', `<h1>${tk.a === 'approve' ? '✔ Approved' : tk.a === 'back' ? '↩ Sent back' : '✖ Rejected'}</h1>
      <div class="msg ${tk.a === 'approve' ? 'good' : 'bad'}"><b>${esc(t.no)}</b> – status is now <b>${esc(out.status)}</b>.</div>${table(tk.k, t)}<p class="muted">You can close this window.</p>`, tk.a === 'approve' ? '#0d7a45' : '#b42323'));
  } catch (e) { fail(res, e, 'Could not complete'); }
});

export default r;
