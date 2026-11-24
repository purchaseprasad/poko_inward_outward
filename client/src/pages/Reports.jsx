import { useEffect, useState } from 'react';
import { api, fmtD, fmtDT, fmtSize } from '../api.js';
import { useLists } from '../ctx.js';
import { ErrorBox, PageHead, Table } from '../ui.jsx';
import TxDetail from './TxDetail.jsx';

function useData(url) {
  const [rows, setRows] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => api(url).then(setRows).catch(setErr), 200);
    return () => clearTimeout(t);
  }, [url]);
  return [rows, err];
}
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v && p.set(k, v)); return p.toString(); };

export function Inventory() {
  const { lists } = useLists();
  const [f, setF] = useState({ q: '', warehouse_id: '' });
  const [rows, err] = useData('/inventory?' + qs(f));
  const sum = (k) => (rows || []).reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHead title="Inventory" sub="Stock per warehouse, SKU and batch" />
      <div className="card"><div className="filters">
        <input placeholder="Search SKU, product or batch…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}><option value="">All warehouses</option>{lists.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </div>
      {rows && <div className="calc"><span className="tag tag-ok">Available: {sum('avail')}</span><span className="tag tag-err">Damaged: {sum('damaged')}</span><span className="tag tag-info">In transit: {sum('transit')}</span></div>}</div>
      <ErrorBox error={err} />
      <div className="card">{rows ? <Table heads={['Warehouse', 'SKU', 'Product', 'Batch', 'Expiry', 'Available', 'Damaged', 'In transit']} empty="No stock yet. Stock appears after an inward entry gets final approval."
        rows={rows.map((r) => [r.warehouse, <b>{r.sku}</b>, r.product, r.batch, fmtD(r.expiry), <span className="num">{r.avail}</span>, <span className="num">{r.damaged}</span>, <span className="num">{r.transit}</span>])} /> : <p>Loading…</p>}</div>
    </>
  );
}

export function Ledger() {
  const { lists } = useLists();
  const [f, setF] = useState({ q: '', warehouse_id: '' });
  const [rows, err] = useData('/ledger?' + qs(f));
  return (
    <>
      <PageHead title="Stock Ledger" sub="Every stock movement, newest first (cannot be edited)" />
      <div className="card"><div className="filters">
        <input placeholder="Search SKU, product, batch or entry number…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}><option value="">All warehouses</option>{lists.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </div></div>
      <ErrorBox error={err} />
      <div className="card">{rows ? <Table heads={['When', 'Entry', 'Type', 'Warehouse', 'SKU / batch', 'Bucket', 'Change', 'Balance', 'By']} empty="No movements yet."
        rows={rows.map((r) => [fmtDT(r.ts), <b>{r.ref}</b>, r.type, r.warehouse, <>{r.sku}<br /><small>{r.batch}</small></>, { avail: 'Available', damaged: 'Damaged', transit: 'In transit' }[r.bucket],
          <span className={r.qty > 0 ? 'pos' : 'neg'}>{r.qty > 0 ? '+' : ''}{r.qty}</span>, <span className="num">{r.balance}</span>, r.user_name])} /> : <p>Loading…</p>}</div>
    </>
  );
}

export function Documents() {
  const [f, setF] = useState({ q: '', kind: '' });
  const [rows, err] = useData('/documents?' + qs(f));
  const [open, setOpen] = useState(null);
  return (
    <>
      <PageHead title="Documents" sub="Search all uploaded files by GRN, outward number, invoice, supplier, LR or file name" />
      <div className="card"><div className="filters">
        <input placeholder="Search…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Inward &amp; Outward</option><option value="inward">Inward only</option><option value="outward">Outward only</option></select>
      </div></div>
      <ErrorBox error={err} />
      <div className="card">{rows ? <Table heads={['Entry', 'Type', 'File', 'Version', 'Size', 'Uploaded', 'Actions']} empty="No documents found."
        rows={rows.map((d) => [<a className="lnk" onClick={() => setOpen(d)}>{d.tx_no}</a>, <b>{d.doc_type}</b>, d.file_name, 'v' + d.version, fmtSize(d.size), <>{d.uploaded_by}<br /><small>{fmtDT(d.created_at)}</small></>,
          <div className="btn-row"><a className="btn sm" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">👁 View</a><a className="btn sm" href={`/api/documents/${d.id}/file?download=1`}>⬇ Download</a></div>])} /> : <p>Loading…</p>}</div>
      {open && <TxDetail kind={open.kind} id={open.tx_id} onClose={() => setOpen(null)} />}
    </>
  );
}

export function History() {
  const [f, setF] = useState({ q: '', kind: '' });
  const [rows, err] = useData('/history?' + qs(f));
  return (
    <>
      <PageHead title="History" sub="Who did what, and when" />
      <div className="card"><div className="filters">
        <input placeholder="Search entry number, person or action…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Inward &amp; Outward</option><option value="inward">Inward only</option><option value="outward">Outward only</option></select>
      </div></div>
      <ErrorBox error={err} />
      <div className="card">{rows ? <Table heads={['When', 'Entry', 'Action', 'Note', 'By']} empty="No history yet."
        rows={rows.map((a) => [fmtDT(a.ts), <b>{a.tx_no}</b>, a.action, a.note || '—', <>{a.user_name}<br /><small>{a.role}</small></>])} /> : <p>Loading…</p>}</div>
    </>
  );
}

export function Claims() {
  const { lists } = useLists();
  const [f, setF] = useState({ q: '', transporter: '' });
  const [rows, err] = useData('/claims?' + qs(f));
  const [open, setOpen] = useState(null);
  const by = {};
  (rows || []).forEach((r) => { const k = r.transporter || '(no transporter)'; by[k] = by[k] || { units: 0, entries: new Set() }; by[k].units += r.damaged; by[k].entries.add(r.no); });
  return (
    <>
      <PageHead title="Transport Claims" sub="Goods damaged in transport – use this list (with the damage photos and LR number) to claim from the transporter" />
      <div className="card"><div className="filters">
        <input placeholder="Search GRN, supplier, LR, product…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })}><option value="">All transporters</option>{lists.transporters.map((t) => <option key={t.id}>{t.name}</option>)}</select>
      </div>
      {rows && <div className="calc">{Object.entries(by).map(([k, v]) => <span key={k} className="tag tag-err">{k}: {v.units} damaged units · {v.entries.size} entr{v.entries.size === 1 ? 'y' : 'ies'}</span>)}</div>}</div>
      <ErrorBox error={err} />
      <div className="card">{rows ? <Table heads={['Date', 'Entry', 'Transporter', 'LR / vehicle', 'Supplier', 'Product / batch', 'Damaged', 'Photos', 'Status']} empty="No transport damage recorded."
        rows={rows.map((r) => [fmtD(r.date), <a className="lnk" onClick={() => setOpen(r)}>{r.no}</a>, <b>{r.transporter || '—'}</b>, <>{r.lr || '—'}<br /><small>{r.vehicle}</small></>, r.supplier,
          <>{r.product}<br /><small>{r.sku} · batch {r.batch}</small></>,
          <><span className="num">{r.damaged}</span>{r.damaged !== r.staff_damaged && <><br /><small>staff entered {r.staff_damaged}</small></>}</>,
          r.photos ? <span className="chip okc">📷 {r.photos}</span> : <span className="chip miss">no photo</span>, r.status])} /> : <p>Loading…</p>}</div>
      {open && <TxDetail kind="inward" id={open.inward_id} onClose={() => setOpen(null)} />}
    </>
  );
}
