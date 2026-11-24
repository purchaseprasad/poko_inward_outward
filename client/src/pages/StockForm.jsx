import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, todayKey, fmtSize } from '../api.js';
import { useAuth, useLists } from '../ctx.js';
import { PageHead, Field, Combo, Notice, ErrorBox, DocUploader, useToast } from '../ui.jsx';

const OUT_DOCS = ['Sales Invoice', 'Delivery Challan (DC)', 'Packing List', 'E-way Bill', 'LR Copy', 'Gate Pass', 'POD', 'Dispatch Photos'];
const PURPOSES = ['Sample / trial', 'Personal use', 'Gift', 'Marketing / content shoot', 'Testing', 'Other'];
const newItem = () => ({ product: '', key: '', qty: '' });

/* one form for both "Outward Entry" (mode=outward) and "Employees" (mode=employee) */
export default function StockForm({ mode }) {
  const emp = mode === 'employee';
  const user = useAuth(), { lists, reload } = useLists(), toast = useToast(), nav = useNavigate();
  const [h, setH] = useState({ warehouse_id: lists.warehouses[0]?.id, type: '', out_date: todayKey(), dest_warehouse_id: '', party: '', transporter: '', vehicle: '', lr: '', eway: '', gate: '', remarks: '', emp_no: '', emp_name: '', dept: '', purpose: PURPOSES[0] });
  const [items, setItems] = useState([newItem()]);
  const [inv, setInv] = useState([]);
  const [docs, setDocs] = useState([]);
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);

  useEffect(() => { api('/inventory?warehouse_id=' + h.warehouse_id).then(setInv).catch(setErr); }, [h.warehouse_id]);
  if (!['Staff', 'Admin'].includes(user.role)) return <><PageHead title={emp ? 'New employee issue' : 'New outward entry'} /><Notice>Only Staff (or Admin) can create this entry.</Notice></>;

  const typeRow = lists.outward_types.find((t) => t.name.toLowerCase() === h.type.trim().toLowerCase());
  const kind = emp ? 'employee' : typeRow?.kind || 'sale';
  const bucket = kind === 'damaged' ? 'damaged' : 'avail';
  const rows = inv.filter((r) => r[bucket] > 0);
  const set = (k) => (e) => setH({ ...h, [k]: e.target.value });
  const upd = (i, p) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const matches = (name, r) => { const m = lists.products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()); return (m?.sku && r.sku === m.sku.toUpperCase()) || r.product.toLowerCase() === name.trim().toLowerCase(); };
  const stockOf = (name) => rows.filter((r) => matches(name, r)).reduce((a, r) => a + r[bucket], 0);
  const names = [...new Set([...lists.products.map((p) => p.name), ...rows.map((r) => r.product)])];
  const prodOpts = names.map((n) => ({ value: n, n: stockOf(n) })).sort((a, b) => (b.n > 0) - (a.n > 0))
    .map((o) => ({ value: o.value, sub: o.n > 0 ? 'Stock: ' + o.n : 'no stock' }));

  function pickProduct(i, name) {
    const rs = rows.filter((r) => matches(name, r));
    upd(i, { product: name, key: rs.length === 1 ? rs[0].sku + '|' + rs[0].batch : '' });
  }
  const sel = (it) => rows.find((r) => r.sku + '|' + r.batch === it.key);

  async function save() {
    setErr(null);
    const body = { ...h, type: emp ? 'Employee Issue' : h.type, items: items.map((it) => { const r = sel(it); return { sku: r?.sku || '', batch: r?.batch || '', qty: it.qty }; }) };
    const fd = new FormData();
    fd.append('data', JSON.stringify(body));
    fd.append('types', JSON.stringify(docs.map((d) => d.type)));
    docs.forEach((d) => fd.append('files', d.file, d.file.name));
    setBusy(true);
    try {
      const r = await api('/outward', { method: 'POST', form: fd });
      toast(`${emp ? 'Employee issue' : 'Outward entry'} ${r.no} saved – sent to Quality.`);
      nav(emp ? '/employees' : '/outward');
    } catch (e) { setErr(e); window.scrollTo(0, 0); setBusy(false); }
  }

  const addType = async (name) => { await api('/lists/outward_types', { method: 'POST', body: { name } }); await reload(); setH((x) => ({ ...x, type: name })); };
  const empOpts = lists.employees.map((e) => ({ value: e.emp_no, sub: e.name }));

  return (
    <>
      <PageHead title={emp ? 'New employee issue' : 'New outward entry'}
        sub={emp ? 'Record products taken by an employee (sample, own use, shoot, testing …)' : 'Dispatch to Blinkit, BigBasket, Amazon, Flipkart, transfer or dispose stock — the number is given automatically when you save'} />
      <div className="card">
        <ErrorBox error={err} />
        <div className="grid">
          <Field label={emp ? 'Warehouse (stock taken from)' : 'Source warehouse'} req>
            <select value={h.warehouse_id} onChange={(e) => { setH({ ...h, warehouse_id: e.target.value }); setItems([newItem()]); }}>{lists.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </Field>
          <Field label={emp ? 'Date' : 'Outward date'} req><input type="date" value={h.out_date} max={todayKey()} onChange={set('out_date')} /></Field>
          {emp ? (
            <>
              <Field label="Employee number" req>
                <Combo value={h.emp_no} placeholder="Type employee number" options={empOpts}
                  onChange={(v, o) => { const e = o && lists.employees.find((x) => x.emp_no === o.value); setH({ ...h, emp_no: v, ...(e ? { emp_name: e.name, dept: e.dept } : {}) }); }} />
              </Field>
              <Field label="Employee name" req><input value={h.emp_name} onChange={set('emp_name')} /></Field>
              <Field label="Department"><input value={h.dept} onChange={set('dept')} /></Field>
              <Field label="Purpose" req><select value={h.purpose} onChange={set('purpose')}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></Field>
            </>
          ) : (
            <>
              <Field label="Outward type" req>
                <Combo value={h.type} onChange={(v) => { setH({ ...h, type: v }); setItems([newItem()]); }} placeholder="Click and choose, or type a new one"
                  options={lists.outward_types.filter((t) => t.kind !== 'employee').map((t) => ({ value: t.name }))} onAdd={addType} addWord="outward type" />
              </Field>
              {kind === 'transfer' && (
                <Field label="Destination warehouse" req>
                  <select value={h.dest_warehouse_id} onChange={set('dest_warehouse_id')}><option value="">— Select —</option>
                    {lists.warehouses.filter((w) => String(w.id) !== String(h.warehouse_id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                </Field>
              )}
              <Field label="Customer / order details (optional)"><input value={h.party} onChange={set('party')} /></Field>
              <Field label="Transporter"><Combo value={h.transporter} onChange={(v) => setH({ ...h, transporter: v })} options={lists.transporters.map((t) => ({ value: t.name }))} placeholder="Click and choose, or type a name"
                onAdd={async (n) => { await api('/lists/transporters', { method: 'POST', body: { name: n } }); await reload(); }} addWord="transporter" /></Field>
              <Field label="Vehicle number"><input value={h.vehicle} onChange={set('vehicle')} /></Field>
              <Field label="LR number"><input value={h.lr} onChange={set('lr')} /></Field>
              <Field label="E-way bill number"><input value={h.eway} onChange={set('eway')} /></Field>
              <Field label="Gate pass number"><input value={h.gate} onChange={set('gate')} /></Field>
            </>
          )}
          <Field label="Remarks" full><textarea value={h.remarks} onChange={set('remarks')} /></Field>
        </div>

        <h3>{emp ? 'Products taken' : 'Items to send'} <small>– chosen from {kind === 'damaged' ? 'damaged' : 'available'} stock</small></h3>
        {rows.length === 0 && <Notice type="warn">There is no {kind === 'damaged' ? 'damaged' : 'available'} stock in this warehouse yet. Stock appears here after an inward entry is fully approved.</Notice>}
        {items.map((it, i) => {
          const avail = rows.filter((r) => it.product && matches(it.product, r));
          const r = sel(it), qty = +it.qty;
          return (
            <div className="item" key={i}>
              <div className="item-h"><b>{emp ? 'Product' : 'Item'} {i + 1}</b>
                {items.length > 1 && <button type="button" className="btn sm danger" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>}</div>
              <div className="grid">
                <Field label={<>Product <small>(pick from list)</small></>} req>
                  <Combo value={it.product} onChange={(v) => pickProduct(i, v)} options={prodOpts} placeholder="Click and choose a product" />
                </Field>
                <Field label="Batch (available qty)" req>
                  <select value={it.key} onChange={(e) => upd(i, { key: e.target.value })}>
                    <option value="">{!it.product ? '— Pick the product first —' : avail.length ? '— Select batch —' : 'No stock of this product'}</option>
                    {avail.map((x) => <option key={x.id} value={x.sku + '|' + x.batch}>Batch {x.batch}{x.expiry ? ' | Exp ' + x.expiry : ''} | Available: {x[bucket]}</option>)}
                  </select>
                </Field>
                <Field label="Quantity" req><input type="number" min="1" step="1" inputMode="numeric" value={it.qty} onChange={(e) => upd(i, { qty: e.target.value })} /></Field>
              </div>
              <div className="calc">
                {r && <span className="tag tag-info">Available: {r[bucket]}</span>}
                {r && it.qty !== '' && qty > r[bucket] && <span className="tag tag-err">Quantity {qty} is more than available stock ({r[bucket]})</span>}
                {it.product && !avail.length && <span className="tag tag-err">No stock of this product in this warehouse</span>}
              </div>
            </div>
          );
        })}
        <button type="button" className="btn" onClick={() => setItems([...items, newItem()])}>➕ Add another {emp ? 'product' : 'item'}</button>

        {!emp && (
          <>
            <h3>Documents <small>(upload Invoice, DC etc. here)</small></h3>
            <p className="muted" style={{ marginTop: -4 }}>For Blinkit, BigBasket, Amazon, Flipkart and other sales dispatches, a <b>Sales Invoice</b> must be uploaded before the final approval. Choose the document type (Invoice, Delivery Challan (DC), LR Copy …) then the file.</p>
            <DocUploader types={OUT_DOCS} onFile={(type, file) => setDocs((d) => [...d, { type, file }])} />
            {docs.map((d, i) => (
              <div className="pend-item" key={i}>
                <span>📎 <b>{d.type}</b> – {d.file.name} <small>({fmtSize(d.file.size)})</small></span>
                <button type="button" className="btn sm danger" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </>
        )}
        <div className="actions">
          <button className="btn primary lg" onClick={save} disabled={busy}>💾 {emp ? 'Save Employee Issue' : 'Save Outward Entry'}</button>
          <button className="btn lg" onClick={() => nav(emp ? '/employees' : '/outward')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
