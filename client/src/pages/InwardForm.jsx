import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, todayKey, fmtSize, CAUSES } from '../api.js';
import { useAuth, useLists } from '../ctx.js';
import { PageHead, Field, Combo, Notice, ErrorBox, DocUploader, useToast } from '../ui.jsx';

const newBatch = () => ({ batch: '', expiry: '', expected: '', received: '', accepted: '', damaged: '', damage_cause: '' });
const newProduct = () => ({ product: '', sku: '', batches: [newBatch()] });
const IN_DOCS = ['Purchase Invoice', 'Delivery Challan', 'Transport LR', 'E-way Bill', 'MSDS', 'COA (Certificate of Analysis)', 'Packing List', 'Material Photos', 'Damaged Box Photo', 'Quality Inspection Report'];
const day = (s) => (s ? String(s).slice(0, 10) : '');

/* New inward entry – and, when opened from "Correct & resubmit", the same form filled with the entry that was sent back */
export default function InwardForm() {
  const user = useAuth(), { lists, reload } = useLists(), toast = useToast(), nav = useNavigate();
  const { id: editId } = useParams();
  const [h, setH] = useState({ warehouse_id: lists.warehouses[0]?.id, supplier: '', invoice_no: '', invoice_date: todayKey(), received_date: todayKey(), po: '', challan: '', transporter: '', vehicle: '', lr: '', remarks: '' });
  const [prods, setProds] = useState([newProduct()]);
  const [docs, setDocs] = useState([]);
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const [ret, setRet] = useState(null), [ready, setReady] = useState(!editId);

  useEffect(() => {
    if (!editId) return;
    api('/inward/' + editId).then((r) => {
      const t = r.tx;
      if (t.status !== 'Needs Correction') { setErr(new Error(`This entry is “${t.status}” – only entries that were sent back can be corrected.`)); setReady(true); return; }
      setRet(t);
      setH({ warehouse_id: t.warehouse_id, supplier: t.supplier, invoice_no: t.invoice_no, invoice_date: day(t.invoice_date), received_date: day(t.received_date), po: t.po, challan: t.challan, transporter: t.transporter, vehicle: t.vehicle, lr: t.lr, remarks: t.remarks });
      const g = new Map();
      for (const i of r.items) {
        const k = i.product + '|' + i.sku;
        if (!g.has(k)) g.set(k, { product: i.product, sku: i.sku, known: true, skuLocked: !!lists.products.find((p) => p.name.toLowerCase() === i.product.toLowerCase() && p.sku), batches: [] });
        g.get(k).batches.push({ batch: i.batch, expiry: day(i.expiry), expected: i.expected || '', received: String(i.received), accepted: String(i.accepted), damaged: String(i.damaged), damage_cause: i.damage_cause });
      }
      setProds([...g.values()]);
      setReady(true);
    }).catch((e) => { setErr(e); setReady(true); });
  }, [editId]); // eslint-disable-line

  if (!['Staff', 'Admin'].includes(user.role)) return <><PageHead title="New inward entry" /><Notice>Only Staff (or Admin) can create inward entries.</Notice></>;
  if (!ready) return <p>Loading…</p>;

  const set = (k) => (e) => setH({ ...h, [k]: e.target.value });
  const addMaster = (m) => async (name) => { await api('/lists/' + m, { method: 'POST', body: { name } }); await reload(); };
  const upd = (pi, patch) => setProds(prods.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
  const updB = (pi, bi, patch) => upd(pi, { batches: prods[pi].batches.map((b, j) => (j === bi ? { ...b, ...patch } : b)) });
  const prodOpts = lists.products.map((p) => ({ value: p.name, sub: p.sku || 'no SKU yet' }));

  function pickProduct(pi, name) {
    const m = lists.products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (m) upd(pi, { product: m.name, sku: m.sku, known: true, skuLocked: !!m.sku });
    else upd(pi, { product: name, known: false, skuLocked: false, sku: prods[pi].skuLocked ? '' : prods[pi].sku });
  }
  const calc = (b) => {
    const e = +b.expected || 0, r = +b.received || 0, a = +b.accepted || 0, d = +b.damaged || 0, t = [];
    if (b.expected !== '' && b.received !== '') {
      if (r < e) t.push(<span key="s" className="tag tag-warn">Short: {e - r}</span>);
      else if (r > e) t.push(<span key="x" className="tag tag-info">Excess: {r - e}</span>);
      else t.push(<span key="m" className="tag tag-ok">Matches expected</span>);
    }
    if (a + d > r && b.received !== '') t.push(<span key="e" className="tag tag-err">Accepted + Damaged ({a + d}) is more than Received ({r})</span>);
    if (d > 0 && b.damage_cause === 'Transport damage') t.push(<span key="p" className="tag tag-warn">📷 Upload a “Damaged Box Photo” – needed for the transporter claim</span>);
    return t;
  };

  async function save() {
    setErr(null);
    const items = [];
    prods.forEach((p) => p.batches.forEach((b) => items.push({ product: p.product, sku: p.sku, ...b })));
    if (editId) {
      setBusy(true);
      try {
        const r = await api('/inward/' + editId, { method: 'PUT', body: { ...h, items } });
        toast(`${r.no} corrected – back with ${r.status === 'Pending Quality' ? 'Quality' : 'Finance'}.`);
        nav('/inward');
      } catch (e) { setErr(e); window.scrollTo(0, 0); setBusy(false); }
      return;
    }
    if (!docs.some((d) => d.type === 'Purchase Invoice')) return setErr(new Error('Purchase Invoice is compulsory – choose "Purchase Invoice" in the Documents box and upload the supplier invoice.'));
    const fd = new FormData();
    fd.append('data', JSON.stringify({ ...h, items }));
    fd.append('types', JSON.stringify(docs.map((d) => d.type)));
    docs.forEach((d) => fd.append('files', d.file, d.file.name));
    setBusy(true);
    try {
      const r = await api('/inward', { method: 'POST', form: fd });
      toast(`Inward entry ${r.no} saved – sent to Quality for the physical check.`);
      nav('/inward');
    } catch (e) { setErr(e); window.scrollTo(0, 0); setBusy(false); }
  }

  return (
    <>
      <PageHead title={editId ? `Correct inward entry ${ret?.no || ''}` : 'New inward entry'}
        sub={editId ? 'Fix what was asked, then resubmit' : 'Record material received from a supplier — the GRN number is given automatically when you save'} />
      {ret && (
        <div className="return-box">
          <b>↩ Sent back by {ret.return_by}</b><br /><b>Reason:</b> {ret.return_reason}<br /><b>Please correct:</b> {ret.return_corrections}
        </div>
      )}
      <div className="card">
        <ErrorBox error={err} />
        <div className="grid">
          <Field label="Warehouse" req><select value={h.warehouse_id} disabled={!!editId} onChange={set('warehouse_id')}>{lists.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Supplier" req><Combo value={h.supplier} onChange={(v) => setH({ ...h, supplier: v })} options={lists.vendors.map((v) => ({ value: v.name }))} placeholder="Click and choose, or type a name" onAdd={addMaster('vendors')} addWord="supplier" /></Field>
          <Field label="PO number"><input value={h.po} onChange={set('po')} /></Field>
          <Field label="Invoice number" req><input value={h.invoice_no} onChange={set('invoice_no')} /></Field>
          <Field label="Invoice date"><input type="date" value={h.invoice_date} onChange={set('invoice_date')} /></Field>
          <Field label="Received date" req><input type="date" value={h.received_date} max={todayKey()} onChange={set('received_date')} /></Field>
          <Field label="Delivery challan"><input value={h.challan} onChange={set('challan')} /></Field>
          <Field label="Transporter"><Combo value={h.transporter} onChange={(v) => setH({ ...h, transporter: v })} options={lists.transporters.map((t) => ({ value: t.name }))} placeholder="Click and choose, or type a name" onAdd={addMaster('transporters')} addWord="transporter" /></Field>
          <Field label="Vehicle number"><input value={h.vehicle} onChange={set('vehicle')} /></Field>
          <Field label="LR number"><input value={h.lr} onChange={set('lr')} /></Field>
          <Field label="Remarks" full><textarea value={h.remarks} onChange={set('remarks')} /></Field>
        </div>

        <h3>Products received</h3>
        {prods.map((p, pi) => (
          <div className="item" key={pi}>
            <div className="item-h"><b>Product {pi + 1}</b>
              {prods.length > 1 && <button type="button" className="btn sm danger" onClick={() => setProds(prods.filter((_, i) => i !== pi))}>Remove product</button>}</div>
            <div className="grid">
              <Field label={<>Product <small>(pick from list, or type a new product)</small></>} req>
                <Combo value={p.product} onChange={(v) => pickProduct(pi, v)} options={prodOpts} placeholder="Click and choose, or type a name"
                  onAdd={async (n) => pickProduct(pi, n)} addWord="product" />
                <div className="p-status">
                  {p.product && (p.known ? <span className="tag tag-ok">✔ Product from list{p.sku ? ' – SKU filled' : ' – no SKU yet, type it below'}</span> : <span className="tag tag-info">🆕 New product – type its SKU (saved to the list)</span>)}
                </div>
              </Field>
              <Field label="SKU" req><input value={p.sku} readOnly={p.skuLocked} placeholder={p.skuLocked ? '' : 'Type the SKU'} style={{ textTransform: 'uppercase' }} onChange={(e) => upd(pi, { sku: e.target.value })} /></Field>
            </div>
            <h4 style={{ margin: '14px 0 8px' }}>Batches of this product</h4>
            {p.batches.map((b, bi) => (
              <div className="bline" key={bi}>
                <div className="item-h"><b>Batch {bi + 1}</b>
                  {p.batches.length > 1 && <button type="button" className="btn sm danger" onClick={() => upd(pi, { batches: p.batches.filter((_, j) => j !== bi) })}>Remove batch</button>}</div>
                <div className="grid g4">
                  <Field label="Batch number" req><input value={b.batch} style={{ textTransform: 'uppercase' }} onChange={(e) => updB(pi, bi, { batch: e.target.value })} /></Field>
                  <Field label="Expiry (optional)"><input type="date" value={b.expiry} onChange={(e) => updB(pi, bi, { expiry: e.target.value })} /></Field>
                  {[['expected', 'Expected qty'], ['received', 'Received qty'], ['accepted', 'Accepted qty'], ['damaged', 'Damaged qty']].map(([k, l]) => (
                    <Field key={k} label={l}><input type="number" min="0" step="1" inputMode="numeric" value={b[k]} onChange={(e) => updB(pi, bi, { [k]: e.target.value, ...(k === 'damaged' && !(+e.target.value > 0) ? { damage_cause: '' } : {}) })} /></Field>
                  ))}
                  {+b.damaged > 0 && (
                    <Field label="What caused the damage?" req>
                      <select value={b.damage_cause} onChange={(e) => updB(pi, bi, { damage_cause: e.target.value })}>
                        <option value="">— Select —</option>{CAUSES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
                <div className="calc">{calc(b)}</div>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => upd(pi, { batches: [...p.batches, newBatch()] })}>➕ Add another batch of this product</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setProds([...prods, newProduct()])}>➕ Add another product</button>

        {editId ? (
          <Notice>To add or change documents (invoice, damage photos…), open the entry from the list and use <b>Add a document</b>. Then come back and resubmit.</Notice>
        ) : (
          <>
            <h3>Documents <small>(upload all documents of this consignment here)</small></h3>
            <p className="muted" style={{ marginTop: -4 }}><b>Purchase Invoice is compulsory</b> – the entry cannot be saved without it. Also add MSDS, COA, E-way Bill, Delivery Challan etc. If goods were damaged in transport, add a <b>Damaged Box Photo</b>.</p>
            <DocUploader types={IN_DOCS} onFile={(type, file) => setDocs((d) => [...d, { type, file }])} />
            {docs.map((d, i) => (
              <div className="pend-item" key={i}>
                <span>📎 <b>{d.type}</b> – {d.file.name} <small>({fmtSize(d.file.size)})</small></span>
                <button type="button" className="btn sm danger" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </>
        )}
        <div className="actions">
          <button className="btn primary lg" onClick={save} disabled={busy}>{editId ? '✔ Resubmit corrected entry' : '💾 Save Inward Entry'}</button>
          <button className="btn lg" onClick={() => nav('/inward')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
