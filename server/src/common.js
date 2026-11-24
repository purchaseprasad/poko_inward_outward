import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './db.js';

export const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* read-only disk – files live in the database anyway */ }
/* every column of a document EXCEPT the file itself (never send the bytes in a list) */
export const DOC_COLS = 'id,kind,tx_id,doc_type,version,file_name,mime,size,uploaded_by,deleted,created_at';

export const IN_DOCS = ['Purchase Invoice', 'Delivery Challan', 'Transport LR', 'E-way Bill', 'MSDS', 'COA (Certificate of Analysis)', 'Packing List', 'Material Photos', 'Damaged Box Photo', 'Quality Inspection Report'];
export const OUT_DOCS = ['Sales Invoice', 'Delivery Challan (DC)', 'Packing List', 'E-way Bill', 'LR Copy', 'Gate Pass', 'POD', 'Dispatch Photos'];

const pad = (n, l = 2) => String(n).padStart(l, '0');
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fyOf = (d) => { d = new Date(d); const s = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${String(s).slice(2)}-${String(s + 1).slice(2)}`; };
export const up = (s) => String(s ?? '').trim().toUpperCase();
export const str = (s) => String(s ?? '').trim();
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
export const isInt = (v) => v !== '' && v != null && Number.isInteger(+v);

/* GRN/BLR/26-27/0001 – counter lives in the database so two people can never get the same number */
export async function nextNo(c, kind, whCode, date) {
  const prefix = `${kind}/${whCode}/${fyOf(date || new Date())}/`;
  const r = await c.query('insert into seq(prefix,n) values($1,1) on conflict(prefix) do update set n=seq.n+1 returning n', [prefix]);
  return prefix + pad(r.rows[0].n, 4);
}

export async function logAct(c, kind, txId, user, action, note = '') {
  await c.query('insert into activity(kind,tx_id,user_name,role,action,note) values($1,$2,$3,$4,$5,$6)', [kind, txId, user.name, user.role, action, note]);
}

/* ===== THE ONE AND ONLY stock-change function (also writes the ledger) ===== */
const BUCKETS = { avail: 'Available', damaged: 'Damaged', transit: 'In Transit' };
export async function stockChange(c, m, user) {
  if (!BUCKETS[m.bucket]) throw new Error('bad bucket');
  const sku = up(m.sku), batch = up(m.batch);
  let r = (await c.query('select * from inventory where warehouse_id=$1 and sku=$2 and batch=$3 for update', [m.wh, sku, batch])).rows[0];
  if (!r) {
    if (m.qty < 0) throw new HttpError(409, `No stock exists for ${sku} / batch ${batch} in this warehouse.`);
    r = (await c.query('insert into inventory(warehouse_id,sku,product,batch,expiry) values($1,$2,$3,$4,$5) returning *', [m.wh, sku, m.product || sku, batch, m.expiry || null])).rows[0];
  }
  const nb = r[m.bucket] + m.qty;
  if (nb < 0) throw new HttpError(409, `Not enough ${BUCKETS[m.bucket].toLowerCase()} stock for ${sku} / batch ${batch} (have ${r[m.bucket]}, need ${-m.qty}).`);
  await c.query(`update inventory set ${m.bucket}=$1 where id=$2`, [nb, r.id]);
  await c.query('insert into ledger(warehouse_id,sku,product,batch,bucket,qty,balance,type,ref,user_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [m.wh, sku, r.product, batch, m.bucket, m.qty, nb, m.type, m.ref, user?.name || '']);
}
/* all moves of one approval are applied inside the caller's transaction: all or nothing */
export async function applyMoves(c, moves, user) { for (const m of moves) await stockChange(c, m, user); }

/* ===== documents ===== */
export const DOC_EXT = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
export function checkFile(f) {
  const ext = path.extname(f.originalname || '').toLowerCase();
  if (!DOC_EXT[ext]) throw new HttpError(400, `"${f.originalname}": file type not allowed. Use PDF, JPG, JPEG, PNG or XLSX.`);
  const isImg = ext === '.jpg' || ext === '.jpeg' || ext === '.png';
  if (!isImg && f.size > 1.5 * 1024 * 1024) throw new HttpError(400, `"${f.originalname}": PDF / XLSX files must be 1.5 MB or smaller.`);
  if (isImg && f.size > 5 * 1024 * 1024) throw new HttpError(400, `"${f.originalname}": image is too large (max 5 MB).`);
  return { ext, mime: DOC_EXT[ext] };
}
export async function saveDoc(c, { kind, txId, docType, file, user }) {
  const { ext, mime } = checkFile(file);
  const allowed = kind === 'inward' ? IN_DOCS : OUT_DOCS;
  if (!allowed.includes(docType)) throw new HttpError(400, `Unknown document type "${docType}".`);
  const v = (await c.query('select count(*)::int n from documents where kind=$1 and tx_id=$2 and doc_type=$3', [kind, txId, docType])).rows[0].n + 1;
  const r = await c.query('insert into documents(kind,tx_id,doc_type,version,file_name,mime,size,data,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
    [kind, txId, docType, v, file.originalname, mime, file.size, file.buffer, user.name]);
  await logAct(c, kind, txId, user, `Uploaded ${docType} v${v}`, file.originalname);
  return r.rows[0].id;
}
export const hasDoc = async (c, kind, txId, type) =>
  (await c.query('select 1 from documents where kind=$1 and tx_id=$2 and doc_type=$3 and not deleted limit 1', [kind, txId, type])).rowCount > 0;
