import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtD, fmtDT, todayKey } from '../api.js';
import { useAuth } from '../ctx.js';
import { PageHead, Table, Notice, ErrorBox } from '../ui.jsx';

const Tile = ({ n, l, note, c }) => <div className={'tile tile-' + c}><div className="tile-label">{l}</div><div className="tile-value">{n}</div><div className="tile-note">{note}</div></div>;

export default function Dashboard() {
  const user = useAuth();
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { api('/dashboard').then(setD).catch(setErr); }, []);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  return (
    <>
      <PageHead title="Dashboard" sub={`Hello ${user.name} · Today is ${fmtD(todayKey())}`} />
      {d.awaitingMe > 0 && (
        <Notice type="warn">
          <b>{d.awaitingMe}</b> item(s) are waiting for you. <Link className="lnk" to="/approvals">Open Approvals →</Link>
        </Notice>
      )}
      <div className="tiles">
        <Tile c={1} l="Inward entries today" n={d.inwardToday} note="received today" />
        <Tile c={2} l="Outward entries today" n={d.outwardToday} note="dispatched today" />
        <Tile c={3} l="Waiting for Quality (QC / outward)" n={d.pendingQualityIn + d.pendingQualityOut} note="needs QC / approval" />
        <Tile c={3} l="Sent back for correction" n={d.needsCorrection} note="waiting for Staff" />
        <Tile c={4} l="Waiting for Finance (final)" n={d.pendingFinance} note="invoice & qty check" />
      </div>
      <div className="tiles">
        <Tile c={2} l="Available stock" n={d.avail} note="units ready to dispatch" />
        <Tile c={1} l="Damaged stock" n={d.damaged} note="units" />
        <Tile c={4} l="In transit" n={d.transit} note={d.inTransit + ' transfer(s) on the way'} />
      </div>
      <div className="two">
        <div className="card">
          <h2>Stock by warehouse</h2>
          <Table heads={['Warehouse', 'Available', 'Damaged', 'In transit']}
            rows={d.byWarehouse.map((w) => [<b>{w.name}</b>, <span className="num">{w.avail}</span>, <span className="num">{w.damaged}</span>, <span className="num">{w.transit}</span>])} />
        </div>
        <div className="card">
          <h2>Recent activity</h2>
          <Table heads={['When', 'Entry', 'What']}
            rows={d.recent.map((a) => [fmtDT(a.ts), <b>{a.tx_no}</b>, <>{a.action}<br /><small>{a.user_name} ({a.role})</small></>])}
            empty="No activity yet." />
        </div>
      </div>
    </>
  );
}
