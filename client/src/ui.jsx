import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((msg, type = '') => {
    const id = Math.random();
    setList((l) => [...l, { id, msg, type }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), type === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div id="toasts" aria-live="polite">{list.map((t) => <div key={t.id} className={'toast ' + t.type}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- small pieces ---------- */
const BADGE = { 'Needs Correction': 'b-corr', 'Pending Finance': 'b-fin', 'Pending Quality': 'b-qc', Approved: 'b-ok', Rejected: 'b-rej', 'In Transit': 'b-tr', Received: 'b-rec' };
export const Badge = ({ status }) => <span className={'badge ' + (BADGE[status] || 'b-pend')}>{status}</span>;

export const PageHead = ({ title, sub, children }) => (
  <div className="page-h" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    <div className="btn-row">{children}</div>
  </div>
);

export const Field = ({ label, req, full, children }) => (
  <div className={'fld' + (full ? ' full' : '')}>
    <label>{label}{req && <> <em className="req">*</em></>}</label>
    {children}
  </div>
);

export const Notice = ({ type = '', children }) => <div className={'notice ' + type}>{children}</div>;
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function ErrorBox({ error }) {
  if (!error) return null;
  const d = error.details;
  return (
    <Notice type="err">
      {d?.length ? <><b>{error.message}</b><ul>{d.map((x, i) => <li key={i}>{x}</li>)}</ul></> : error.message}
    </Notice>
  );
}

export function Table({ heads, rows, empty = 'Nothing to show.' }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="tbl-wrap">
      <table className="stack">
        <thead><tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={heads[j]}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal">
      <div className="mback" onClick={onClose} />
      <div className={'mbox' + (wide ? ' wide' : '')} role="dialog">
        <button className="icon-btn mclose" onClick={onClose} aria-label="Close">✕</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* confirm box, optionally asking for a reason */
export function Confirm({ title, body, okText = 'OK', danger, askReason, onOk, onClose }) {
  const [reason, setReason] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function go() {
    if (askReason && !reason.trim()) return setErr('Please type the reason.');
    setBusy(true);
    try { await onOk(reason.trim()); onClose(); } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {body}
      {askReason && <Field label="Reason" req><textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} autoFocus /></Field>}
      {err && <Notice type="err">{err}</Notice>}
      <div className="actions">
        <button className={'btn lg ' + (danger ? 'danger solid' : 'primary')} onClick={go} disabled={busy}>{okText}</button>
        <button className="btn lg" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/* ---------- drop-down list with "Add new" ---------- */
export function Combo({ value, onChange, options, placeholder, onAdd, addWord, invalid, readOnly }) {
  const [open, setOpen] = useState(false), [idx, setIdx] = useState(-1);
  const q = (value || '').trim().toLowerCase();
  const exact = options.some((o) => o.value.toLowerCase() === q);
  const list = q && !exact ? options.filter((o) => (o.value + ' ' + (o.sub || '')).toLowerCase().includes(q)) : options;
  const canAdd = !!onAdd && !!q && !exact;
  const total = list.length + (canAdd ? 1 : 0);
  const pick = (o) => { onChange(o.value, o); setOpen(false); };
  const add = async () => { try { await onAdd(value.trim()); } finally { setOpen(false); } };
  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx((i) => (i + 1) % Math.max(total, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i <= 0 ? total - 1 : i - 1)); }
    else if (e.key === 'Enter' && open && idx >= 0) { e.preventDefault(); idx < list.length ? pick(list[idx]) : add(); }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
  }
  return (
    <div className="cbx">
      <input className={invalid ? 'invalid' : ''} value={value || ''} placeholder={placeholder} readOnly={readOnly} autoComplete="off"
        onChange={(e) => { onChange(e.target.value, null); setOpen(true); setIdx(-1); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={key} />
      {open && (list.length > 0 || canAdd) && (
        <div className="cbx-list" onMouseDown={(e) => e.preventDefault()}>
          {list.map((o, i) => (
            <div key={o.value} className={'cbx-it' + (i === idx ? ' on' : '')} onMouseDown={() => pick(o)}>
              <span>{o.value}</span>{o.sub && <small>{o.sub}</small>}
            </div>
          ))}
          {canAdd && <div className={'cbx-it cbx-add' + (idx === list.length ? ' on' : '')} onMouseDown={add}>➕ Add new {addWord}: <b>&nbsp;{value.trim()}</b></div>}
        </div>
      )}
    </div>
  );
}

/* ---------- files ---------- */
const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx'];
export async function prepFile(f) {
  const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!ALLOWED.includes(ext)) throw new Error(`"${f.name}": file type not allowed. Use PDF, JPG, JPEG, PNG or XLSX.`);
  if (ext === '.pdf' || ext === '.xlsx') {
    if (f.size > 1.5 * 1024 * 1024) throw new Error(`"${f.name}": PDF / XLSX files must be 1.5 MB or smaller.`);
    return f;
  }
  const bmp = await createImageBitmap(f);
  const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.72));
  return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export function DocUploader({ types, onFile }) {
  const [type, setType] = useState(types[0]), [msg, setMsg] = useState(''), [over, setOver] = useState(false);
  const fileRef = useRef(), camRef = useRef();
  async function handle(files) {
    setMsg('');
    for (const f of Array.from(files)) {
      try { await onFile(type, await prepFile(f)); } catch (e) { setMsg(e.message); }
    }
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
  }
  return (
    <div>
      <Field label="Document type"><select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></Field>
      <div className={'drop' + (over ? ' over' : '')} onClick={() => fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}>
        📁 Drag &amp; drop files here, or click to choose<small>PDF, JPG, JPEG, PNG, XLSX · photos are compressed automatically · PDF / XLSX up to 1.5 MB</small>
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => fileRef.current.click()}>📄 Choose files</button>
        <button type="button" className="btn" onClick={() => camRef.current.click()}>📷 Take photo</button>
      </div>
      <input ref={fileRef} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx" onChange={(e) => handle(e.target.files)} />
      <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => handle(e.target.files)} />
      {msg && <div style={{ marginTop: 8 }}><Notice type="err">{msg}</Notice></div>}
    </div>
  );
}
