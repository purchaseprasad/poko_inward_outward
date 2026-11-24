import { useEffect, useState } from 'react';
import { api, fmtD } from '../api.js';
import { ErrorBox, Field, Modal, Notice, Table, useToast } from '../ui.jsx';

const PACK = ['Good', 'Slightly damaged', 'Badly damaged'];

/* Quality fills this after checking the goods physically */
export default function QcForm({ id, onClose, onDone }) {
  const toast = useToast();
  const [d, setD] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const [vals, setVals] = useState({}), [packaging, setPackaging] = useState(''), [batchOk, setBatchOk] = useState(null), [remarks, setRemarks] = useState('');
  const [mode, setMode] = useState(null), [reason, setReason] = useState(''), [corrections, setCorrections] = useState('');

  useEffect(() => {
    api('/inward/' + id).then((r) => {
      setD(r);
      setVals(Object.fromEntries(r.items.map((i) => [i.id, { received: i.received, accepted: i.accepted, damaged: i.damaged }])));
    }).catch(setErr);
  }, [id]);

  if (err && !d) return <Modal title="QC form" onClose={onClose}><ErrorBox error={err} /></Modal>;
  if (!d) return <Modal title="QC form" onClose={onClose}><p>Loading…</p></Modal>;
  const t = d.tx;
  const set = (iid, k, v) => setVals({ ...vals, [iid]: { ...vals[iid], [k]: v } });
  if (t.status !== 'Pending Quality') {
    return (
      <Modal title={`QC form – ${t.no}`} onClose={onClose}>
        <Notice type="warn">Nothing to fill: this entry is now <b>“{t.status}”</b>{t.status === 'Needs Correction' ? ' (with Staff for correction)' : t.status === 'Pending Finance' ? ' (QC is already done – it is with Finance)' : ''}.</Notice>
        <div className="actions"><button className="btn lg" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }

  async function submit(result) {
    setBusy(true); setErr(null);
    try {
      const body = { result, reason, corrections };
      if (result === 'approve') Object.assign(body, { items: d.items.map((i) => ({ id: i.id, ...vals[i.id] })), packaging, batch_ok: batchOk === null ? undefined : batchOk, remarks });
      await api(`/inward/${id}/qc`, { method: 'POST', body });
      toast(result === 'approve' ? 'QC approved – sent to Finance.' : result === 'send_back' ? 'Sent back to Staff for correction.' : 'Entry rejected.');
      onClose(); onDone && onDone();
    } catch (e) { setErr(e); setBusy(false); }
  }

  return (
    <Modal wide onClose={onClose} title={<>QC form – {t.no}</>}>
      <div className="kv">
        <div><span>Supplier</span>{t.supplier}</div><div><span>Invoice</span>{t.invoice_no}</div><div><span>Warehouse</span>{t.warehouse}</div>
        <div><span>Transporter</span>{t.transporter || '—'}{t.lr ? ' · LR ' + t.lr : ''}</div><div><span>Entered by</span><b>{t.created_by_name}</b></div>
      </div>
      {t.return_reason && <div className="return-box"><b>↩ Sent back to you by {t.return_by}.</b><br /><b>Reason:</b> {t.return_reason}<br /><b>Please check:</b> {t.return_corrections}</div>}
      {d.docs.length > 0 && (
        <p className="mini">Documents: {d.docs.map((x) => <a key={x.id} className="lnk" style={{ marginRight: 12 }} href={`/api/documents/${x.id}/file`} target="_blank" rel="noreferrer">{x.doc_type}</a>)}</p>
      )}
      <ErrorBox error={err} />

      <div className="qc-wrap">
        <h3>1. Count the goods you checked</h3>
        <p className="muted" style={{ marginTop: -4 }}>Staff's numbers are shown on the left. Enter what <b>you</b> counted. These numbers go to stock after Finance approves.</p>
        <Table heads={['Product / batch', 'Staff entered', 'Damage cause', 'Received (counted)', 'Accepted', 'Damaged']}
          rows={d.items.map((i) => {
            const v = vals[i.id] || {};
            const diff = (k) => String(v[k]) !== String(i[k]);
            return [<><b>{i.product}</b><br /><small>{i.sku} · batch {i.batch}{i.expiry ? ' · exp ' + fmtD(i.expiry) : ''}</small></>,
              <>Rec {i.received} · Acc {i.accepted} · Dam {i.damaged}</>, i.damaged > 0 ? i.damage_cause || '—' : '—',
              ...['received', 'accepted', 'damaged'].map((k) => (
                <input key={k} className={'qc-in' + (diff(k) ? ' invalid' : '')} type="number" min="0" step="1" inputMode="numeric" value={v[k] ?? ''} onChange={(e) => set(i.id, k, e.target.value)} />
              ))];
          })} />
        <h3>2. Physical check</h3>
        <div className="qc-grid">
          <Field label="Packaging condition" req>
            <select value={packaging} onChange={(e) => setPackaging(e.target.value)}><option value="">— Select —</option>{PACK.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label="Batch number & expiry match the documents?" req>
            <select value={batchOk === null ? '' : batchOk ? 'y' : 'n'} onChange={(e) => setBatchOk(e.target.value === '' ? null : e.target.value === 'y')}>
              <option value="">— Select —</option><option value="y">Yes, they match</option><option value="n">No – there is a difference</option>
            </select>
          </Field>
          <Field label="Remarks" full><textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Anything Finance should know (required if the batch / expiry does not match)" /></Field>
        </div>
      </div>

      {mode === 'send_back' && (
        <div className="return-box">
          <Field label="Reason for sending back" req><textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="sp" />
          <Field label="What must Staff correct?" req><textarea value={corrections} onChange={(e) => setCorrections(e.target.value)} /></Field>
          <div className="actions"><button className="btn primary" disabled={busy} onClick={() => submit('send_back')}>↩ Send back to Staff</button><button className="btn" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}
      {mode === 'reject' && (
        <div className="return-box">
          <Field label="Reason for rejecting for good" req><textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="actions"><button className="btn danger solid" disabled={busy} onClick={() => submit('reject')}>✖ Reject permanently</button><button className="btn" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}
      {!mode && (
        <div className="actions">
          <button className="btn primary lg" disabled={busy} onClick={() => submit('approve')}>✔ Approve &amp; send to Finance</button>
          <button className="btn lg" onClick={() => { setMode('send_back'); setErr(null); }}>↩ Send back for correction</button>
          <button className="btn danger lg" onClick={() => { setMode('reject'); setErr(null); }}>✖ Reject</button>
        </div>
      )}
    </Modal>
  );
}
