import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { pool, q, ah, HttpError } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { str } from '../common.js';
import { createInward } from './inward.js';
import { createOutward } from './outward.js';
import { notifyRole, mailHtml, appUrl } from '../mailer.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const r = Router();
r.use(requireAuth, requireRole('Admin'));

const IN_COLS = ['Warehouse', 'Supplier', 'Invoice No', 'Invoice Date', 'Received Date', 'PO No', 'Delivery Challan', 'Transporter', 'Vehicle No', 'LR No', 'Remarks',
  'Product', 'SKU', 'Batch', 'Expiry', 'Expected Qty', 'Received Qty', 'Accepted Qty', 'Damaged Qty', 'Damage Cause'];
const OUT_COLS = ['Warehouse', 'Outward Type', 'Date', 'Destination Warehouse', 'Customer / Order', 'Transporter', 'Vehicle No', 'LR No', 'E-way Bill', 'Gate Pass', 'Remarks',
  'Employee No', 'Employee Name', 'Department', 'Purpose', 'Product', 'SKU', 'Batch', 'Qty'];
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

r.get('/template/:kind', ah(async (req, res) => {
  const kind = req.params.kind;
  if (!['inward', 'outward'].includes(kind)) throw new HttpError(404, 'Unknown template.');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'inward' ? 'Inward' : 'Outward');
  ws.columns = (kind === 'inward' ? IN_COLS : OUT_COLS).map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('How to fill');
  const lines = kind === 'inward'
    ? ['One row = one product batch.', 'Rows with the same Warehouse + Supplier + Invoice No become ONE inward entry (one GRN).',
       'Required: Warehouse, Supplier, Invoice No, Received Date, SKU, Batch, Received Qty.', 'Dates: use YYYY-MM-DD (e.g. 2026-11-23).',
       'Accepted + Damaged cannot be more than Received. Product name is optional if the SKU already exists.',
       'Damage Cause (optional): Transport damage, Supplier packing, Handling at warehouse or Other.',
       'The Purchase Invoice file can be uploaded later from the entry.']
    : ['One row = one item line.', 'Rows with the same header columns (Warehouse, Outward Type, Date, Customer, LR …) become ONE outward entry.',
       'Required: Warehouse, Outward Type, Date, SKU (or Product), Batch, Qty.', 'Warehouse Transfer also needs Destination Warehouse.',
       'Employee issue: use Outward Type "Employee Issue" and fill Employee No and Employee Name.',
       'Quantity must be available in stock (approved inward). Dates: YYYY-MM-DD.'];
  help.getColumn(1).width = 110;
  lines.forEach((l) => help.addRow([l]));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-${kind}-template.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

const cellText = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  if (typeof v === 'object') return str(v.text ?? v.result ?? (v.richText ? v.richText.map((x) => x.text).join('') : ''));
  return String(v).trim();
};

async function readRows(file, cols) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(file.buffer); } catch { throw new HttpError(400, 'Could not read the file. Upload the .xlsx template.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'The file has no sheet.');
  const map = {};
  ws.getRow(1).eachCell((cell, i) => { map[norm(cellText(cell.value))] = i; });
  const missing = cols.filter((c) => !(norm(c) in map) && ['Warehouse', 'SKU', 'Batch'].includes(c));
  if (missing.length) throw new HttpError(400, `Wrong template – missing column(s): ${missing.join(', ')}. Download the template again.`);
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = { _row: n };
    let any = false;
    for (const c of cols) { o[c] = norm(c) in map ? cellText(row.getCell(map[norm(c)]).value) : ''; if (o[c]) any = true; }
    if (any) rows.push(o);
  });
  if (!rows.length) throw new HttpError(400, 'The file has no data rows.');
  if (rows.length > 2000) throw new HttpError(400, 'Too many rows (max 2000 per file).');
  return rows;
}

async function lookups() {
  const wh = (await q('select * from warehouses where active')).rows;
  const prod = (await q('select * from products')).rows;
  const findWh = (v) => wh.find((w) => norm(w.name) === norm(v) || norm(w.code) === norm(v) || norm(w.name).startsWith(norm(v)) && norm(v).length >= 3);
  const skuOf = (sku, product) => str(sku) || prod.find((p) => p.name.toLowerCase() === str(product).toLowerCase())?.sku || '';
  const nameOf = (sku, product) => str(product) || prod.find((p) => p.sku && p.sku.toUpperCase() === str(sku).toUpperCase())?.name || '';
  return { findWh, skuOf, nameOf };
}

function group(rows, keyCols) {
  const m = new Map();
  for (const row of rows) { const k = keyCols.map((c) => norm(row[c])).join('|'); if (!m.has(k)) m.set(k, []); m.get(k).push(row); }
  return [...m.values()];
}

r.post('/:kind', upload.single('file'), ah(async (req, res) => {
  const kind = req.params.kind;
  if (!['inward', 'outward'].includes(kind)) throw new HttpError(404, 'Unknown upload type.');
  if (!req.file) throw new HttpError(400, 'Choose the Excel file first.');
  const commit = req.query.commit === '1', auto = kind === 'inward' && req.query.autoApprove === '1';
  const cols = kind === 'inward' ? IN_COLS : OUT_COLS;
  const rows = await readRows(req.file, cols);
  const L = await lookups();
  const groups = kind === 'inward' ? group(rows, ['Warehouse', 'Supplier', 'Invoice No'])
    : group(rows, ['Warehouse', 'Outward Type', 'Date', 'Destination Warehouse', 'Customer / Order', 'Transporter', 'Vehicle No', 'LR No', 'E-way Bill', 'Gate Pass', 'Employee No', 'Employee Name']);

  const c = await pool.connect();
  const results = [];
  try {
    await c.query('begin');
    for (const g of groups) {
      const h = g[0], rowNos = g.map((x) => x._row);
      const label = kind === 'inward' ? `${h['Supplier'] || '?'} / ${h['Invoice No'] || '?'}` : `${h['Outward Type'] || '?'} / ${h['Customer / Order'] || h['Employee Name'] || h['LR No'] || h['Date']}`;
      const whRow = L.findWh(h['Warehouse']);
      if (!whRow) { results.push({ ok: false, label, rows: rowNos, errors: [`Warehouse "${h['Warehouse']}" not found.`] }); continue; }
      await c.query('savepoint sp');
      try {
        let out;
        if (kind === 'inward') {
          out = await createInward(c, {
            warehouse_id: whRow.id, supplier: h['Supplier'], invoice_no: h['Invoice No'], invoice_date: h['Invoice Date'], received_date: h['Received Date'],
            po: h['PO No'], challan: h['Delivery Challan'], transporter: h['Transporter'], vehicle: h['Vehicle No'], lr: h['LR No'], remarks: h['Remarks'],
            items: g.map((x) => ({ product: L.nameOf(x['SKU'], x['Product']), sku: L.skuOf(x['SKU'], x['Product']), batch: x['Batch'], expiry: x['Expiry'],
              expected: x['Expected Qty'], received: x['Received Qty'], accepted: x['Accepted Qty'], damaged: x['Damaged Qty'], damage_cause: x['Damage Cause'] })),
          }, req.user, { viaBulk: true, autoApprove: auto });
        } else {
          const dest = h['Destination Warehouse'] ? L.findWh(h['Destination Warehouse']) : null;
          if (h['Destination Warehouse'] && !dest) throw new HttpError(400, 'Validation', [`Destination warehouse "${h['Destination Warehouse']}" not found.`]);
          out = await createOutward(c, {
            warehouse_id: whRow.id, type: h['Outward Type'], out_date: h['Date'], dest_warehouse_id: dest?.id, party: h['Customer / Order'],
            transporter: h['Transporter'], vehicle: h['Vehicle No'], lr: h['LR No'], eway: h['E-way Bill'], gate: h['Gate Pass'], remarks: h['Remarks'],
            emp_no: h['Employee No'], emp_name: h['Employee Name'], dept: h['Department'], purpose: h['Purpose'],
            items: g.map((x) => ({ sku: L.skuOf(x['SKU'], x['Product']), batch: x['Batch'], qty: x['Qty'] })),
          }, req.user, { viaBulk: true });
        }
        await c.query('release savepoint sp');
        results.push({ ok: true, label, rows: rowNos, no: out.no });
      } catch (e) {
        await c.query('rollback to savepoint sp');
        if (e instanceof HttpError) results.push({ ok: false, label, rows: rowNos, errors: e.details || [e.message] });
        else if (e.code === '23505') results.push({ ok: false, label, rows: rowNos, errors: ['Duplicate entry (already exists).'] });
        else if (e.code === '22P02' || e.code === '22007' || e.code === '22008') results.push({ ok: false, label, rows: rowNos, errors: ['A value has the wrong format (check dates YYYY-MM-DD and numbers).'] });
        else throw e;
      }
    }
    const errorCount = results.filter((x) => !x.ok).length;
    const doCommit = commit && errorCount === 0;
    await c.query(doCommit ? 'commit' : 'rollback');
    if (doCommit) {
      const n = results.length;
      if (kind === 'inward' && !auto) notifyRole('Quality', `${n} inward entries uploaded in bulk – waiting for Quality (QC)`, mailHtml('Bulk inward upload', [`${n} inward entries were uploaded by ${req.user.name}.`], `${appUrl()}/approvals`, 'Open approvals'));
      if (kind === 'outward') notifyRole('Quality', `${n} outward entries uploaded in bulk – waiting for Quality`, mailHtml('Bulk outward upload', [`${n} outward entries were uploaded by ${req.user.name}.`], `${appUrl()}/approvals`, 'Open approvals'));
    }
    res.json({ committed: doCommit, totalRows: rows.length, entries: results.length, errorCount, results });
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}));

export default r;
