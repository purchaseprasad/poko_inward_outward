import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtD, fmtDT, fmtSize, nextAction } from '../api.js';
import { useAuth } from '../ctx.js';
import { Badge, Confirm, DocUploader, ErrorBox, Field, Modal, Notice, Table, useToast } from '../ui.jsx';
import QcForm from './QcForm.jsx';

const IN_DOCS = ['Purchase Invoice', 'Delivery Challan', 'Transport LR', 'E-way Bill', 'MSDS', 'COA (Certificate of Analysis)', 'Packing List', 'Material Photos', 'Damaged Box Photo', 'Quality Inspection Report'];
const OUT_DOCS = ['Sales Invoice', 'Delivery Challan (DC)', 'Packing List', 'E-way Bill', 'LR Copy', 'Gate Pass', 'POD', 'Dispatch Photos'];

/* Finance: send back for correction (to Staff or to Quality) */
function SendBackDialog({ row, onClose, onDone }) {
  const toast = useToast();
  const [to, setTo] = useState('Staff'), [reason, setReason] = useState(''), [corrections, setCorrections] = useState(''), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(null);
    try { await api(`/inward/${row.id}/send-back`, { method: 'POST', body: { to, reason, corrections } }); toast('Sent back to ' + to + '.'); onClose(); onDone && onDone(); }
    catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <Modal title="Send back for correction" onClose={onClose}>
      <p><b>{row.no}</b> – {row.title}</p>
      <ErrorBox error={err} />
      <Field label="Who should correct it?" req>
        <label className="chk"><input type="radio" checked={to === 'Staff'} onChange={() => setTo('Staff')} /> Staff – invoice / entry details are wrong</label>
        <label className="chk" style={{ marginTop: 8 }}><input type="radio" checked={to === 'Quality'} onChange={() => setTo('Quality')} /> Quality – quantity doubt, please check again</label>
      </Field>
      <div className="sp" />
      <Field label="Reason" req><textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      <div className="sp" />
      <Field label="What must be corrected?" req><textarea value={corrections} onChange={(e) => setCorrections(e.target.value)} /></Field>
      <div className="actions"><button className="btn primary lg" onClick={go} disabled={busy}>↩ Send back</button><button className="btn lg" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

/* the buttons that fit the person and the stage – used in lists and in the detail window */
export function ActionButtons({ row, onDone, small = true }) {
  const user = useAuth(), toast = useToast();
  const [dlg, setDlg] = useState(null);
  const act = nextAction(user, row);
  if (!act) return null;
  const sz = small ? ' sm' : '';
  const done = (msg) => { toast(msg); onDone && onDone(); };
  const base = `/${row.kind}/${row.id}`;

  if (act === 'edit') return <Link className={'btn primary' + sz} to={`/inward/${row.id}/edit`}>✏ Correct &amp; resubmit</Link>;
  if (act === 'qc') {
    return (
      <>
        <button className={'btn primary' + sz} onClick={() => setDlg('qc')}>📋 Open QC form</button>
        {dlg === 'qc' && <QcForm id={row.id} onClose={() => setDlg(null)} onDone={onDone} />}
      </>
    );
  }
  const reject = dlg === 'reject' && (
    <Confirm title="Reject this entry for good?" okText="Reject" danger askReason body={<p><b>{row.no}</b> – please give the reason. The people involved will be told.</p>}
      onClose={() => setDlg(null)} onOk={async (reason) => { await api(`${base}/reject`, { method: 'POST', body: { reason } }); done('Rejected.'); }} />
  );
  if (act === 'finance') {
    return (
      <>
        <button className={'btn primary' + sz} onClick={() => setDlg('ok')}>✔ Finance: final approve</button>
        <button className={'btn' + sz} onClick={() => setDlg('back')}>↩ Send back</button>
        <button className={'btn danger' + sz} onClick={() => setDlg('reject')}>✖ Reject</button>
        {dlg === 'ok' && (
          <Confirm title="Give the final approval?" okText="Yes, approve" onClose={() => setDlg(null)}
            body={<p><b>{row.no}</b> – {row.title}<br />You confirm the invoice and the quantity are correct. Stock will be updated with the quantities Quality counted.</p>}
            onOk={async () => { await api(`${base}/approve`, { method: 'POST', body: {} }); done('Approved – stock updated.'); }} />
        )}
        {dlg === 'back' && <SendBackDialog row={row} onClose={() => setDlg(null)} onDone={onDone} />}
        {reject}
      </>
    );
  }
  const label = act === 'receive' ? '📥 Confirm received' : '✔ Quality: final approve';
  return (
    <>
      <button className={'btn primary' + sz} onClick={() => setDlg('ok')}>{label}</button>
      {act === 'approve' && <button className={'btn danger' + sz} onClick={() => setDlg('reject')}>✖ Reject</button>}
      {dlg === 'ok' && (
        <Confirm title={act === 'receive' ? 'Confirm receipt?' : 'Approve this entry?'} okText={act === 'receive' ? 'Yes, received' : 'Yes, approve'} onClose={() => setDlg(null)}
          body={<p><b>{row.no}</b>{row.title ? ' – ' + row.title : ''}<br />{act === 'receive' ? 'The stock will be added to the destination warehouse.' : 'This is the final approval. Stock will be updated.'}</p>}
          onOk={async () => { await api(`${base}/${act === 'receive' ? 'receive' : 'approve'}`, { method: 'POST', body: {} }); done(act === 'receive' ? 'Marked as received.' : 'Approved.'); }} />
      )}
      {reject}
    </>
  );
}

const kv = (l, v) => <div key={l}><span>{l}</span>{v === '' || v == null ? '—' : v}</div>;

export default function TxDetail({ kind, id, onClose, onChanged }) {
  const user = useAuth(), toast = useToast();
  const [d, setD] = useState(null), [err, setErr] = useState(null), [del, setDel] = useState(null);
  const load = useCallback(() => api(`/${kind}/${id}`).then(setD).catch(setErr), [kind, id]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged && onChanged(); };
  if (err) return <Modal title="Entry" onClose={onClose}><ErrorBox error={err} /></Modal>;
  if (!d) return <Modal title="Loading…" onClose={onClose}><p>Please wait…</p></Modal>;
  const t = d.tx, inward = kind === 'inward';
  const required = inward ? 'Purchase Invoice' : t.kind === 'sale' ? 'Sales Invoice' : null;
  const missing = required && !d.docs.some((x) => x.doc_type === required);
  const row = { kind, id: t.id, no: t.no, status: t.status, title: inward ? t.supplier : t.type };
  const hasQc = inward && d.items.some((i) => i.qc_received != null);
  const diff = (a, b) => (b == null ? a : String(a) === String(b) ? a : <span className="diff">{a} (staff {b})</span>);
  return (
    <Modal wide onClose={onClose} title={<>{t.no} <Badge status={t.status} /></>}>
      <div className="kv">
        {kv('Warehouse', t.warehouse)}
        {inward ? <>
          {kv('Supplier', t.supplier)}{kv('PO number', t.po)}{kv('Invoice number', t.invoice_no)}{kv('Invoice date', fmtD(t.invoice_date))}{kv('Received date', fmtD(t.received_date))}
          {kv('Delivery challan', t.challan)}{kv('Transporter', t.transporter)}{kv('Vehicle', t.vehicle)}{kv('LR number', t.lr)}
        </> : <>
          {kv('Outward type', t.type)}{kv('Date', fmtD(t.out_date))}{t.dest_warehouse && kv('Destination', t.dest_warehouse)}
          {t.kind === 'employee' ? <>{kv('Employee number', t.emp_no)}{kv('Employee name', t.emp_name)}{kv('Department', t.dept)}{kv('Purpose', t.purpose)}</> : <>
            {kv('Customer / order details', t.party)}{kv('Transporter', t.transporter)}{kv('Vehicle', t.vehicle)}{kv('LR number', t.lr)}{kv('E-way bill', t.eway)}{kv('Gate pass', t.gate)}</>}
        </>}
        {kv('Created by', <b>{t.created_by_name}{t.via_bulk ? ' (bulk upload)' : ''}</b>)}{kv('Created', fmtDT(t.created_at))}{kv('Remarks', t.remarks)}
      </div>
      {t.status === 'Rejected' && <Notice type="err">Rejected by {t.rejected_by}. Reason: {t.reject_reason}</Notice>}
      {inward && t.return_reason && (
        <div className="return-box">
          <b>↩ {t.status === 'Needs Correction' ? 'Sent back to Staff' : 'Sent back to ' + (t.return_to || 'Quality')} by {t.return_by}</b><br />
          <b>Reason:</b> {t.return_reason}<br /><b>Please correct:</b> {t.return_corrections}
        </div>
      )}
      {inward && t.status === 'Pending Quality' && !['Quality', 'Admin'].includes(user.role) && (
        <Notice type="warn">⏳ Waiting for the <b>Quality team</b> to check the goods and fill the QC form. Only a Quality user (logged in under their own name) sees the QC form button. You are logged in as <b>{user.name} ({user.role})</b>.</Notice>
      )}
      {missing && <Notice type="warn">The <b>{required}</b> is not uploaded yet. It must be uploaded before the final approval.</Notice>}
      {hasQc && (
        <div className="notice ok" style={{ background: 'var(--g-bg)' }}>
          ✔ <b>Quality (QC) check</b> by {t.qc_by}{t.qc_at ? ' on ' + fmtDT(t.qc_at) : ''} · Packaging: <b>{t.qc_packaging}</b> · Batch &amp; expiry match: <b>{t.qc_batch_ok ? 'Yes' : 'NO'}</b>{t.qc_remarks ? <> · Remarks: {t.qc_remarks}</> : null}
        </div>
      )}
      {inward && t.status === 'Pending Finance' && !hasQc && <Notice type="warn">This entry reached Finance before the QC form existed, so there are no Quality counts. Staff's numbers will be used.</Notice>}

      <h3>Items</h3>
      {inward
        ? <Table heads={hasQc ? ['Product', 'Batch', 'Expiry', 'Expected', 'Received', 'Accepted', 'Damaged', 'Damage cause', 'Short / Excess'] : ['Product', 'Batch', 'Expiry', 'Expected', 'Received', 'Accepted', 'Damaged', 'Damage cause', 'Short / Excess']}
            rows={d.items.map((i) => [<><b>{i.product}</b><br /><small>{i.sku}</small></>, i.batch, fmtD(i.expiry), i.expected || '—',
              <b>{hasQc ? diff(i.qc_received, i.received) : i.received}</b>, hasQc ? diff(i.qc_accepted, i.accepted) : i.accepted, hasQc ? diff(i.qc_damaged, i.damaged) : i.damaged,
              i.damaged > 0 ? i.damage_cause || '—' : '—', i.short ? 'Short ' + i.short : i.excess ? 'Excess ' + i.excess : '—'])} />
        : <Table heads={['Product', 'SKU', 'Batch', 'Expiry', 'Quantity']} rows={d.items.map((i) => [i.product, i.sku, i.batch, fmtD(i.expiry), <b>{i.qty}</b>])} />}
      {hasQc && <p className="mini">Red numbers: Quality's count differs from what Staff entered. Quality's counts are the ones used for stock.</p>}

      <h3>Documents</h3>
      <Table heads={['Type', 'File', 'Version', 'Size', 'By', 'Actions']} empty="No documents uploaded yet."
        rows={d.docs.map((x) => [<b>{x.doc_type}</b>, x.file_name, 'v' + x.version, fmtSize(x.size), <>{x.uploaded_by}<br /><small>{fmtDT(x.created_at)}</small></>,
          <div className="btn-row">
            <a className="btn sm" href={`/api/documents/${x.id}/file`} target="_blank" rel="noreferrer">👁 View</a>
            <a className="btn sm" href={`/api/documents/${x.id}/file?download=1`}>⬇ Download</a>
            {user.role === 'Admin' && <button className="btn sm danger" onClick={() => setDel(x)}>Delete</button>}
          </div>])} />
      <div style={{ marginTop: 12 }}>
        <b>Add a document</b>
        <DocUploader types={inward ? IN_DOCS : OUT_DOCS} onFile={async (type, file) => {
          const f = new FormData(); f.append('docType', type); f.append('file', file, file.name);
          await api(`/documents/${kind}/${id}`, { method: 'POST', form: f }); toast(type + ' uploaded.'); changed();
        }} />
      </div>

      <h3>Activity</h3>
      <ul className="timeline">{d.activity.map((a) => <li key={a.id}><b>{a.action}</b>{a.note && <> — {a.note}</>}<small>{a.user_name} ({a.role}) · {fmtDT(a.ts)}</small></li>)}</ul>

      <div className="actions"><ActionButtons row={row} small={false} onDone={() => { changed(); }} /><button className="btn lg" onClick={onClose}>Close</button></div>
      {del && <Confirm title="Delete this document?" okText="Delete" danger body={<p>{del.doc_type} – {del.file_name}<br />This is logged in the activity history.</p>}
        onClose={() => setDel(null)} onOk={async () => { await api('/documents/' + del.id, { method: 'DELETE' }); toast('Document deleted.'); changed(); }} />}
    </Modal>
  );
}
