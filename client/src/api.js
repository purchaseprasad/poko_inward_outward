export async function api(path, { method = 'GET', body, form } = {}) {
  const o = { method, credentials: 'include', headers: {} };
  if (form) o.body = form;
  else if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api' + path, o); } catch { throw new Error('Cannot reach the server. Is the backend running?'); }
  let d = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) { try { d = await r.json(); } catch { /* ignore */ } }
  if (!r.ok) {
    const e = new Error(d?.error || `Request failed (${r.status})`);
    e.status = r.status; e.details = d?.details;
    throw e;
  }
  return d;
}

export const todayKey = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const fmtD = (s) => {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDT = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/* who can do the next step */
export function nextAction(user, row) {
  const r = user.role, a = r === 'Admin';
  if (row.kind === 'inward') {
    if (row.status === 'Pending Quality' && (a || r === 'Quality')) return 'qc';
    if (row.status === 'Pending Finance' && (a || r === 'Finance')) return 'finance';
    if (row.status === 'Needs Correction' && (a || r === 'Staff')) return 'edit';
  } else {
    if (row.status === 'Pending Quality' && (a || r === 'Quality')) return 'approve';
    if (row.status === 'In Transit' && (a || r === 'Staff')) return 'receive';
  }
  return null;
}
export const waitingFor = (row) => ({ 'Pending Finance': 'Finance', 'Pending Quality': 'Quality', 'Needs Correction': 'Staff (to correct)', 'In Transit': 'Destination warehouse' }[row.status] || '');
export const CAUSES = ['Transport damage', 'Supplier packing', 'Handling at warehouse', 'Other'];
export const requiredDoc = (row) => (row.kind === 'inward' ? 'Purchase Invoice' : row.okind === 'sale' || row.kind_ === 'sale' ? 'Sales Invoice' : null);
