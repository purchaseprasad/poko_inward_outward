import { useCallback, useEffect, useState } from 'react';
import { AuthCtx, ListsCtx } from './ctx.js';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Field, Modal, Notice, useToast } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import InwardForm from './pages/InwardForm.jsx';
import StockForm from './pages/StockForm.jsx';
import TxList from './pages/TxList.jsx';
import { Inventory, Ledger, Documents, History, Claims } from './pages/Reports.jsx';
import Admin from './pages/Admin.jsx';

const FEATURES = ['Inward → Quality (QC) → Finance approval', 'Outward to Blinkit, BigBasket, Amazon, Flipkart & FBA', 'Batch-wise stock, ledger and documents in one place'];

function Login({ onLogin }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { onLogin(await api('/auth/login', { method: 'POST', body: { email, password } })); }
    catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <div className="lg-split">
      <div className="lg-left">
        <img src="/logo-white.png" alt="Pokonut" />
        <div>
          <h1>Every pack in and out, tracked from dock to shelf.</h1>
          <p>Warehouse inward &amp; outward management for Bangalore and Pinjore.</p>
          <ul>{FEATURES.map((f) => <li key={f}><i className="pi pi-check-circle" />{f}</li>)}</ul>
        </div>
        <div className="tag-line">SCIENCE BACKED AYURVEDA</div>
      </div>
      <div className="lg-right">
        <form className="lg-form" onSubmit={submit}>
          <img className="mlogo brown" src="/logo-brown.png" alt="Pokonut" />
          <img className="mlogo white" src="/logo-white.png" alt="Pokonut" />
          <h2>Welcome back</h2>
          <p className="sub">Sign in to the Warehouse Management System.</p>
          {err && <Notice type="err">{err}</Notice>}
          <Field label="Email Address" req><input type="email" placeholder="you@pokonut.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></Field>
          <div className="sp" /><div className="sp" />
          <Field label="Password" req><input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <div className="actions"><button className="btn primary lg" disabled={busy || !email || !password}>{busy ? 'Checking…' : 'Sign In'}</button></div>
          <p className="mini" style={{ textAlign: 'center', marginTop: 24 }}>POKONUT Warehouse © {new Date().getFullYear()}</p>
        </form>
      </div>
    </div>
  );
}

function ChangePassword({ onClose }) {
  const toast = useToast();
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [err, setErr] = useState('');
  async function go() {
    try { await api('/auth/password', { method: 'POST', body: { current, next } }); toast('Password changed.'); onClose(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <Modal title="Change my password" onClose={onClose}>
      {err && <Notice type="err">{err}</Notice>}
      <Field label="Current password"><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <div className="sp" />
      <Field label="New password (min 6 characters)"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <div className="actions"><button className="btn primary" onClick={go}>Save</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

const NAV = [
  ['/', 'Dashboard', 'pi-home'], ['/inward', 'Inward Entry', 'pi-download'], ['/outward', 'Outward Entry', 'pi-upload'], ['/employees', 'Employees', 'pi-users'],
  ['/approvals', 'Approvals', 'pi-check-square'], ['/inventory', 'Inventory', 'pi-box'], ['/ledger', 'Stock Ledger', 'pi-book'], ['/documents', 'Documents', 'pi-file'], ['/claims', 'Transport Claims', 'pi-truck'],
  ['/history', 'History', 'pi-history'], ['/admin', 'Admin Panel', 'pi-cog'],
];

function Shell({ user, onLogout }) {
  const [lists, setLists] = useState(null), [pending, setPending] = useState(0), [pw, setPw] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'light');
  const loc = useLocation();
  const reload = useCallback(() => api('/lists').then(setLists).catch(() => {}), []);
  const refreshPending = useCallback(() => api('/pending-count').then((d) => setPending(d.n)).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { refreshPending(); const t = setInterval(refreshPending, 30000); return () => clearInterval(t); }, [refreshPending, loc.pathname]);
  useEffect(() => { document.body.classList.remove('menu-open'); }, [loc.pathname]);
  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t); document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('pk_theme', t); } catch { /* ignore */ }
  };
  const nav = NAV.filter(([p]) => p !== '/admin' || user.role === 'Admin');
  if (!lists) return <div className="lg-right" style={{ minHeight: '100vh' }}><p>Loading…</p></div>;
  return (
    <ListsCtx.Provider value={{ lists, reload }}>
      <div className="shell">
        <aside className="side">
          <div className="brandbox"><img src="/logo-white.png" alt="Pokonut" /><div className="cap">WAREHOUSE</div></div>
          <nav className="navlist">
            {nav.map(([p, l, i]) => (
              <NavLink key={p} to={p} end={p === '/'} className={({ isActive }) => 'nav-btn' + (isActive ? ' on' : '')}>
                <span className="ni"><i className={'pi ' + i} /></span>{l}{p === '/approvals' && pending > 0 && <span className="cnt">{pending}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="userbox">
            <div className="who">
              <div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div>
              <div className="em"><div>{user.name} · {user.email}</div><div>{user.role}</div></div>
            </div>
            <div className="ubtns">
              <button onClick={() => setPw(true)}><i className="pi pi-key" />Password</button>
              <button onClick={toggleTheme}><i className={'pi ' + (theme === 'dark' ? 'pi-sun' : 'pi-moon')} />{theme === 'dark' ? 'Light' : 'Dark'}</button>
              <button onClick={onLogout}><i className="pi pi-sign-out" />Logout</button>
            </div>
          </div>
        </aside>
        <div className="scrim" onClick={() => document.body.classList.remove('menu-open')} />
        <div className="main-col">
          <div className="mbar">
            <img src="/logo-white.png" alt="Pokonut" />
            <button onClick={() => document.body.classList.toggle('menu-open')} aria-label="Menu"><i className="pi pi-bars" /></button>
          </div>
          <main>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inward" element={<TxList kind="inward" />} />
              <Route path="/inward/new" element={<InwardForm />} />
              <Route path="/inward/:id/edit" element={<InwardForm />} />
              <Route path="/outward" element={<TxList kind="outward" />} />
              <Route path="/outward/new" element={<StockForm mode="outward" />} />
              <Route path="/employees" element={<TxList kind="employee" />} />
              <Route path="/employees/new" element={<StockForm mode="employee" />} />
              <Route path="/approvals" element={<TxList kind="approvals" onChanged={refreshPending} />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/claims" element={<Claims />} />
              <Route path="/history" element={<History />} />
              <Route path="/admin" element={user.role === 'Admin' ? <Admin /> : <Navigate to="/" />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
        </div>
      </div>
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </ListsCtx.Provider>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const nav = useNavigate();
  useEffect(() => { api('/auth/me').then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="lg-right" style={{ minHeight: '100vh' }}><p>Loading…</p></div>;
  if (!user) return <Login onLogin={setUser} />;
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); nav('/'); };
  return <AuthCtx.Provider value={user}><Shell user={user} onLogout={logout} /></AuthCtx.Provider>;
}
