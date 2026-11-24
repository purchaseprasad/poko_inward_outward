import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtD, waitingFor } from '../api.js';
import { useAuth, useLists } from '../ctx.js';
import { Badge, ErrorBox, PageHead, Table } from '../ui.jsx';
import TxDetail, { ActionButtons } from './TxDetail.jsx';
import QcForm from './QcForm.jsx';

const STATUSES = {
  inward: ['Pending Quality', 'Pending Finance', 'Needs Correction', 'Approved', 'Rejected'],
  outward: ['Pending Quality', 'Approved', 'In Transit', 'Received', 'Rejected'],
};
const TITLES = {
  inward: ['Inward Entry', 'Material received from suppliers'],
  outward: ['Outward Entry', 'Dispatches to Blinkit, BigBasket, Amazon, Flipkart, transfers and disposals'],
  employee: ['Employees', 'Products taken by employees'],
  approvals: ['Approvals', 'Everything that is waiting for you'],
};

export default function TxList({ kind, onChanged }) {
  const user = useAuth(), { lists } = useLists();
  const [rows, setRows] = useState(null), [err, setErr] = useState(null), [open, setOpen] = useState(null);
  const [f, setF] = useState({ q: '', status: '', warehouse_id: '', by: '', from: '', to: '' });
  const isAppr = kind === 'approvals';
  const [sp, setSp] = useSearchParams();
  useEffect(() => { const o = sp.get('open'); if (o) { const [k, i] = o.split('-'); if (['inward', 'outward'].includes(k) && +i) setOpen({ kind: k, id: +i }); } }, [sp]);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    let url;
    if (isAppr) url = '/approvals';
    else if (kind === 'inward') url = '/inward?' + p;
    else { if (kind === 'employee') p.set('scope', 'employee'); url = '/outward?' + p; }
    api(url).then(setRows).catch(setErr);
  }, [kind, f, isAppr]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);
  useEffect(() => { setRows(null); setF({ q: '', status: '', warehouse_id: '', by: '', from: '', to: '' }); }, [kind]);

  const changed = () => { load(); onChanged && onChanged(); };
  const [title, sub] = TITLES[kind];
  const canCreate = ['Staff', 'Admin'].includes(user.role) && !isAppr;
  const sset = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const statusList = kind === 'inward' ? STATUSES.inward : STATUSES.outward;

  const heads = ['Number / date', 'Warehouse', kind === 'inward' ? 'Supplier / invoice' : kind === 'employee' ? 'Employee / products' : 'Type / party', 'Units', 'Created by', 'Status', 'Documents', 'Actions'];
  const tr = (r) => {
    const req = r.kind === 'inward' ? 'Purchase Invoice' : r.okind === 'sale' ? 'Sales Invoice' : null;
    const missing = req && !(r.docs || []).includes(req);
    return [
      <><b>{r.no}</b><br /><small>{fmtD(r.date)}</small></>,
      r.warehouse,
      r.kind === 'inward' ? <>{r.title}<br /><small>{r.party}</small></>
        : r.okind === 'employee' ? <>{r.emp_no} – {r.emp_name}{r.dept ? ' · ' + r.dept : ''}<br /><small>{r.products}</small></>
        : <>{r.title}<br /><small>{r.party}</small></>,
      <><span className="num">{r.units}</span>{r.kind === 'inward' && <><br /><small>Acc {r.accepted} · Dam {r.damaged}</small></>}</>,
      <>{r.created_by_name}{r.via_bulk && <> <span className="pill">bulk</span></>}<br /><small>{r.created_at && new Date(r.created_at).toLocaleDateString('en-IN')}</small></>,
      <><Badge status={r.status} />{waitingFor(r) && <><br /><small>Waiting: {waitingFor(r)}</small></>}{r.status === 'Needs Correction' && r.return_reason && <><br /><small>Reason: {r.return_reason}</small></>}</>,
      req ? (missing ? <span className="chip miss">✖ {req}</span> : <span className="chip okc">✔ {req}</span>) : <small>{(r.docs || []).length} file type(s)</small>,
      <div className="btn-row"><button className="btn sm" onClick={() => setOpen(r)}>👁 View</button><ActionButtons row={r} onDone={changed} /></div>,
    ];
  };

  return (
    <>
      <PageHead title={title} sub={sub}>
        {canCreate && <Link className="btn primary lg" to={`/${kind}/new`}>➕ New {kind === 'inward' ? 'inward entry' : kind === 'employee' ? 'employee issue' : 'outward entry'}</Link>}
      </PageHead>
      {!isAppr && (
        <div className="card">
          <div className="filters">
            <input placeholder="Search number, supplier, invoice, LR, creator…" value={f.q} onChange={sset('q')} />
            <select value={f.status} onChange={sset('status')}><option value="">All statuses</option>{statusList.map((s) => <option key={s}>{s}</option>)}</select>
            <select value={f.warehouse_id} onChange={sset('warehouse_id')}><option value="">All warehouses</option>{lists.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <select value={f.by} onChange={sset('by')} title="Who created"><option value="">Created by: everyone</option>{lists.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select>
            <input type="date" value={f.from} onChange={sset('from')} title="From date" />
            <input type="date" value={f.to} onChange={sset('to')} title="To date" />
          </div>
        </div>
      )}
      <ErrorBox error={err} />
      <div className="card">
        {rows ? <Table heads={heads} rows={rows.map(tr)} empty={isAppr ? 'Nothing is waiting for you. 🎉' : 'No entries found.'} /> : <p>Loading…</p>}
      </div>
      {open && sp.get('form') === 'qc' && open.kind === 'inward' && ['Quality', 'Admin'].includes(user.role)
        ? <QcForm id={open.id} onClose={() => { setOpen(null); setSp({}); }} onDone={changed} />
        : open && <TxDetail kind={open.kind} id={open.id} onClose={() => { setOpen(null); if (sp.get('open')) setSp({}); }} onChanged={changed} />}
    </>
  );
}
