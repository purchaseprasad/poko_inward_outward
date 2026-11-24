import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDT } from '../api.js';
import { useLists } from '../ctx.js';
import { ErrorBox, Field, Modal, Notice, PageHead, Table, useToast } from '../ui.jsx';

const ROLES = ['Admin', 'Staff', 'Finance', 'Quality'];

/* ---------------- users ---------------- */
function Users() {
  const toast = useToast();
  const [rows, setRows] = useState(null), [err, setErr] = useState(null), [edit, setEdit] = useState(null);
  const load = useCallback(() => api('/admin/users').then(setRows).catch(setErr), []);
  useEffect(() => { load(); }, [load]);
  async function save() {
    try {
      if (edit.id) await api('/admin/users/' + edit.id, { method: 'PUT', body: edit });
      else await api('/admin/users', { method: 'POST', body: edit });
      toast('User saved.'); setEdit(null); load();
    } catch (e) { setEdit({ ...edit, err: e.message }); }
  }
  return (
    <>
      <div className="card">
        <div className="item-h"><h2 style={{ margin: 0 }}>Users &amp; login</h2><button className="btn primary" onClick={() => setEdit({ name: '', email: '', role: 'Staff', password: '', active: true })}>➕ Add user</button></div>
        <p className="muted">Quality and Finance users get the e-mail notifications at the e-mail address saved here. Addresses ending in <b>@pokonut.local</b> are placeholders and never receive mail.</p>
        <ErrorBox error={err} />
        {rows && <Table heads={['Name', 'Email', 'Role', 'Active', '']} rows={rows.map((u) => [<b>{u.name}</b>, u.email, <span className="pill">{u.role}</span>, u.active ? '✔ Yes' : '✖ Off',
          <button className="btn sm" onClick={() => setEdit({ ...u, password: '' })}>Edit</button>])} />}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit user' : 'Add user'} onClose={() => setEdit(null)}>
          {edit.err && <Notice type="err">{edit.err}</Notice>}
          <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
            <Field label="Name" req><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email" req><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Role" req><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label={edit.id ? 'New password (leave empty to keep the old one)' : 'Password (min 6 characters)'} req={!edit.id}><input type="text" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            {edit.id && <Field label="Account"><select value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Switched off</option></select></Field>}
          </div>
          <div className="actions"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- master lists ---------------- */
const MASTERS = {
  products: { label: 'Products', cols: [['name', 'Product name', 1], ['sku', 'SKU']] },
  vendors: { label: 'Suppliers / vendors', cols: [['name', 'Name', 1]] },
  transporters: { label: 'Transporters', cols: [['name', 'Name', 1]] },
  outward_types: { label: 'Outward types', cols: [['name', 'Name', 1], ['kind', 'Behaviour']] },
  employees: { label: 'Employees', cols: [['emp_no', 'Employee number', 1], ['name', 'Name', 1], ['dept', 'Department']] },
  warehouses: { label: 'Warehouses', cols: [['name', 'Name', 1], ['code', 'Code (3 letters)', 1]] },
};
const KINDS = { sale: 'Sale / platform (needs Sales Invoice)', transfer: 'Warehouse transfer', damaged: 'Damaged stock disposal', employee: 'Employee issue', other: 'Other (no invoice needed)' };

function Masters() {
  const toast = useToast(), { reload } = useLists();
  const [m, setM] = useState('products'), [rows, setRows] = useState(null), [err, setErr] = useState(null), [edit, setEdit] = useState(null), [q, setQ] = useState('');
  const spec = MASTERS[m];
  const load = useCallback(() => { setRows(null); api('/admin/masters/' + m).then(setRows).catch(setErr); }, [m]);
  useEffect(() => { load(); }, [load]);
  async function save() {
    try {
      const body = { ...edit };
      if (edit.id) await api(`/admin/masters/${m}/${edit.id}`, { method: 'PUT', body });
      else await api('/lists/' + m, { method: 'POST', body });
      toast('Saved.'); setEdit(null); load(); reload();
    } catch (e) { setEdit({ ...edit, err: e.message }); }
  }
  const shown = (rows || []).filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card">
      <div className="item-h"><h2 style={{ margin: 0 }}>Add &amp; edit lists</h2>
        <button className="btn primary" onClick={() => setEdit(Object.fromEntries(spec.cols.map(([k]) => [k, k === 'kind' ? 'sale' : ''])))}>➕ Add new</button></div>
      <p className="muted">These lists feed the drop-downs in the Inward, Outward and Employees forms. Switching an item off hides it from the drop-downs (old entries keep it).</p>
      <div className="filters">
        <select value={m} onChange={(e) => { setM(e.target.value); setQ(''); }}>{Object.entries(MASTERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <input placeholder="Search in this list…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={err} />
      {rows && <Table heads={[...spec.cols.map((c) => c[1]), 'Active', '']} empty="Nothing here yet."
        rows={shown.map((r) => [...spec.cols.map(([k]) => (k === 'kind' ? KINDS[r.kind] : k === 'name' ? <b>{r[k]}</b> : r[k] || '—')), r.active ? '✔' : '✖ Off',
          <div className="btn-row"><button className="btn sm" onClick={() => setEdit({ ...r })}>Edit</button>
            <button className="btn sm" onClick={async () => { await api(`/admin/masters/${m}/${r.id}`, { method: 'PUT', body: { ...r, active: !r.active } }); load(); reload(); }}>{r.active ? 'Switch off' : 'Switch on'}</button></div>])} />}
      {edit && (
        <Modal title={(edit.id ? 'Edit ' : 'Add ') + spec.label.toLowerCase()} onClose={() => setEdit(null)}>
          {edit.err && <Notice type="err">{edit.err}</Notice>}
          <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
            {spec.cols.map(([k, l, req]) => (
              <Field key={k} label={l} req={!!req}>
                {k === 'kind' ? <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KINDS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  : <input value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
              </Field>
            ))}
          </div>
          <div className="actions"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- bulk upload ---------------- */
function Bulk() {
  const toast = useToast();
  const [kind, setKind] = useState('inward'), [file, setFile] = useState(null), [auto, setAuto] = useState(false);
  const [res, setRes] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const ref = useRef();
  const run = async (commit) => {
    if (!file) return setErr(new Error('Choose the Excel file first.'));
    setBusy(true); setErr(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api(`/bulk/${kind}?${commit ? 'commit=1&' : ''}${auto && kind === 'inward' ? 'autoApprove=1' : ''}`, { method: 'POST', form: fd });
      setRes(r);
      if (r.committed) { toast(`${r.entries} ${kind} entries saved.`); setFile(null); if (ref.current) ref.current.value = ''; }
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <div className="card">
      <h2>Bulk upload</h2>
      <p className="muted">Download the template, fill it in Excel, upload it, check the result, then save. If any row has a mistake <b>nothing is saved</b> until you fix the file.</p>
      <div className="tabs">
        {['inward', 'outward'].map((k) => <button key={k} className={'btn' + (kind === k ? ' on' : '')} onClick={() => { setKind(k); setRes(null); setErr(null); }}>{k === 'inward' ? '📥 Inward bulk upload' : '📤 Outward bulk upload'}</button>)}
      </div>
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <a className="btn" href={`/api/bulk/template/${kind}`}>⬇ Download {kind} template (.xlsx)</a>
      </div>
      <div className="grid">
        <Field label="Filled Excel file"><input ref={ref} type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files[0] || null); setRes(null); }} /></Field>
        {kind === 'inward' && (
          <Field label="After saving">
            <select value={auto ? '1' : '0'} onChange={(e) => { setAuto(e.target.value === '1'); setRes(null); }}>
              <option value="0">Send to Quality (QC) → Finance for approval (normal)</option>
              <option value="1">Add stock straight away (opening stock, no approval)</option>
            </select>
          </Field>
        )}
      </div>
      <div className="actions">
        <button className="btn lg" disabled={busy || !file} onClick={() => run(false)}>🔍 Check file</button>
        <button className="btn primary lg" disabled={busy || !file || !res || res.errorCount > 0 || res.committed} onClick={() => run(true)}>💾 Save all</button>
      </div>
      <ErrorBox error={err} />
      {res && (
        <>
          <Notice type={res.errorCount ? 'err' : 'ok'}>
            {res.committed ? `Saved: ${res.entries} entries from ${res.totalRows} rows.` : res.errorCount ? `${res.errorCount} of ${res.entries} entries have mistakes – nothing was saved. Fix the file and check again.` : `${res.totalRows} rows → ${res.entries} entries look fine. Press “Save all”.`}
          </Notice>
          {res.results.map((g, i) => (
            <div key={i} className={'item ' + (g.ok ? 'res-ok' : 'res-bad')}>
              <b>{g.ok ? '✔' : '✖'} {g.label}</b> <small>(Excel rows {g.rows.join(', ')})</small>
              {g.ok ? <div className="mini">{res.committed ? 'Saved as ' : 'Will be saved as '}<b>{g.no}</b></div> : <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{g.errors.map((e, j) => <li key={j} style={{ color: 'var(--danger)' }}>{e}</li>)}</ul>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- e-mail log ---------------- */
function Emails() {
  const [rows, setRows] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { api('/admin/emails').then(setRows).catch(setErr); }, []);
  return (
    <div className="card">
      <h2>E-mail log</h2>
      <p className="muted">Mails sent to Finance and Quality through Gmail. “skipped” means Gmail is not set up in <b>server/.env</b> (or the user only has a @pokonut.local placeholder address).</p>
      <ErrorBox error={err} />
      {rows && <Table heads={['When', 'To', 'Subject', 'Status']} empty="No e-mails yet." rows={rows.map((r) => [fmtDT(r.ts), r.to_list, r.subject,
        <><span className={'tag ' + (r.status === 'sent' ? 'tag-ok' : r.status === 'failed' ? 'tag-err' : 'tag-warn')}>{r.status}</span>{r.error && <><br /><small>{r.error}</small></>}</>])} />}
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('bulk');
  const T = [['bulk', '📦 Bulk upload'], ['masters', '🗂 Lists & new items'], ['users', '👥 Users'], ['emails', '✉️ E-mail log']];
  return (
    <>
      <PageHead title="Admin Panel" sub="Users, drop-down lists, bulk upload" />
      <div className="tabs">{T.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'bulk' && <Bulk />}{tab === 'masters' && <Masters />}{tab === 'users' && <Users />}{tab === 'emails' && <Emails />}
    </>
  );
}
