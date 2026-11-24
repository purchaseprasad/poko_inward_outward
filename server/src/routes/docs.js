import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { q, tx, ah, HttpError } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { saveDoc, logAct, UPLOAD_DIR, IN_DOCS, OUT_DOCS } from '../common.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });
const r = Router();
r.use(requireAuth);

r.get('/types', (req, res) => res.json({ inward: IN_DOCS, outward: OUT_DOCS }));

/* search all documents: GRN / outward no / invoice / supplier / LR / file name */
r.get('/', ah(async (req, res) => {
  const p = [], w = ['not d.deleted'];
  if (req.query.kind) { p.push(req.query.kind); w.push(`d.kind=$${p.length}`); }
  if (req.query.type) { p.push(req.query.type); w.push(`d.doc_type=$${p.length}`); }
  if (req.query.q) {
    p.push('%' + String(req.query.q).toLowerCase() + '%');
    w.push(`lower(coalesce(i.no,o.no,'')||' '||coalesce(i.supplier,'')||' '||coalesce(i.invoice_no,'')||' '||coalesce(i.lr,o.lr,'')||' '||coalesce(o.type,'')||' '||coalesce(o.party,'')||' '||d.file_name||' '||d.doc_type) like $${p.length}`);
  }
  const rows = (await q(`select d.id, d.kind, d.tx_id, d.doc_type, d.version, d.file_name, d.mime, d.size, d.uploaded_by, d.created_at, coalesce(i.no,o.no) tx_no, i.supplier, i.invoice_no, o.type otype
    from documents d left join inward i on d.kind='inward' and i.id=d.tx_id left join outward o on d.kind='outward' and o.id=d.tx_id
    where ${w.join(' and ')} order by d.id desc limit 500`, p)).rows;
  res.json(rows);
}));

r.post('/:kind/:id', upload.single('file'), ah(async (req, res) => {
  const { kind, id } = req.params;
  if (!['inward', 'outward'].includes(kind)) throw new HttpError(400, 'Bad type.');
  if (!req.file) throw new HttpError(400, 'Choose a file.');
  const t = (await q(`select id from ${kind} where id=$1`, [id])).rows[0];
  if (!t) throw new HttpError(404, 'Entry not found.');
  const docId = await tx((c) => saveDoc(c, { kind, txId: +id, docType: req.body.docType, file: req.file, user: req.user }));
  res.json({ id: docId });
}));

r.get('/:id/file', ah(async (req, res) => {
  const d = (await q('select file_name, mime, data, path from documents where id=$1 and not deleted', [req.params.id])).rows[0];
  if (!d) throw new HttpError(404, 'File not found.');
  const full = d.path ? path.join(UPLOAD_DIR, d.path) : null;
  if (!d.data && !(full && fs.existsSync(full))) throw new HttpError(404, 'File is missing on the server.');
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(d.file_name)}"`);
  if (d.data) res.end(d.data); else fs.createReadStream(full).pipe(res);
}));

/* only Admin can delete – and it is logged */
r.delete('/:id', requireRole('Admin'), ah(async (req, res) => {
  await tx(async (c) => {
    const d = (await c.query('select id, kind, tx_id, doc_type, version, file_name from documents where id=$1 and not deleted for update', [req.params.id])).rows[0];
    if (!d) throw new HttpError(404, 'File not found.');
    await c.query('update documents set deleted=true where id=$1', [d.id]);
    await logAct(c, d.kind, d.tx_id, req.user, `Deleted document ${d.doc_type} v${d.version}`, d.file_name);
  });
  res.json({ ok: true });
}));

export default r;
