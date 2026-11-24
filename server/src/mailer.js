import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { q } from './db.js';
import { UPLOAD_DIR } from './common.js';

/* Sender: a Zoho / any SMTP mailbox if SMTP_HOST is set in .env, otherwise Gmail */
let transport = null;
function senderAddress() { return process.env.SMTP_HOST ? process.env.SMTP_FROM || process.env.SMTP_USER : process.env.GMAIL_USER; }
function getTransport() {
  if (transport) return transport;
  if (process.env.SMTP_HOST) {
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASSWORD, port = +(process.env.SMTP_PORT || 465);
    if (!user || !pass) return null;
    transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user, pass } });
    return transport;
  }
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transport;
}

async function record(to, subject, status, error) {
  try { await q('insert into email_log(to_list,subject,status,error) values($1,$2,$3,$4)', [to.join(', '), subject, status, error || null]); } catch { /* ignore */ }
}

export async function sendMail(to, subject, html, attachments = []) {
  if (!to.length) { await record(['(nobody)'], subject, 'skipped', 'No active user with this role has an email.'); return; }
  const t = getTransport();
  if (!t) { console.log(`[mail skipped – sender not configured] ${subject} -> ${to.join(', ')}`); await record(to, subject, 'skipped', 'The sending mailbox (Gmail or SMTP) is not configured in .env'); return; }
  try {
    await t.sendMail({ from: `"Pokonut Warehouse" <${senderAddress()}>`, to: to.join(','), subject, html, attachments });
    await record(to, subject, 'sent', attachments.length ? `with ${attachments.length} attachment(s)` : null);
  } catch (e) {
    console.error('[mail failed]', e.message);
    await record(to, subject, 'failed', e.message);
  }
}

/* ---- who gets the mails: addresses typed in .env (QUALITY_EMAIL / FINANCE_EMAIL, several allowed with commas) ---- */
const ENV_KEY = { Quality: 'QUALITY_EMAIL', Finance: 'FINANCE_EMAIL', Admin: 'ADMIN_EMAIL' };
async function recipients(role) {
  const fromEnv = String(process.env[ENV_KEY[role]] || '').split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes('@'));
  if (fromEnv.length) return fromEnv;
  const r = await q("select email from users where role=$1 and active and email not like '%@pokonut.local'", [role]);
  return r.rows.map((x) => x.email);
}

/* fire-and-forget: never blocks or breaks saving */
export function notifyRole(role, subject, html) {
  (async () => { await sendMail(await recipients(role), subject, html); })().catch((e) => console.error('[notify]', e.message));
}
export function notifyUser(userId, subject, html) {
  (async () => {
    const r = await q("select email from users where id=$1 and active and email not like '%@pokonut.local'", [userId]);
    await sendMail(r.rows.map((x) => x.email), subject, html);
  })().catch((e) => console.error('[notify]', e.message));
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const appUrl = () => process.env.APP_URL || 'http://localhost:5173';
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
export const mailToken = (k, id, st, a) => jwt.sign({ k, id, st, a }, SECRET, { expiresIn: '7d' });
export const readMailToken = (t) => jwt.verify(t, SECRET);

export const mailHtml = (title, lines, link, linkText) =>
  `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b1810"><h2 style="color:#c4400f">${title}</h2>` +
  lines.map((l) => `<p style="margin:4px 0">${l}</p>`).join('') +
  (link ? `<p style="margin-top:16px"><a href="${link}" style="background:#e4531a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${linkText || 'Open'}</a></p>` : '') +
  `<p style="color:#888;font-size:12px;margin-top:20px">Pokonut Warehouse Inward &amp; Outward Management System</p></div>`;

/* every uploaded document of the entry (invoice, MSDS, COA …) goes with the mail – up to 18 MB in total */
const MAX_MAIL_BYTES = 18 * 1024 * 1024;
async function docAttachments(kind, id) {
  const docs = (await q('select id, doc_type, file_name, mime, size, path, data from documents where kind=$1 and tx_id=$2 and not deleted order by id', [kind, id])).rows;
  const files = [], skipped = [], used = new Map();
  let total = 0;
  for (const d of docs) {
    const full = d.path ? path.join(UPLOAD_DIR, d.path) : null;
    if (!d.data && !(full && fs.existsSync(full))) { skipped.push(d.doc_type + ' (file missing)'); continue; }
    if (total + d.size > MAX_MAIL_BYTES) { skipped.push(d.doc_type + ' – ' + d.file_name + ' (mail size limit – open it in the app)'); continue; }
    total += d.size;
    let name = d.doc_type.replace(/[\\/:*?"<>|]/g, '') + ' - ' + d.file_name;
    const n = (used.get(name) || 0) + 1; used.set(name, n);
    if (n > 1) name = name.replace(/(\.[^.]+)?$/, ' (' + n + ')$1');
    files.push(d.data ? { filename: name, content: d.data, contentType: d.mime } : { filename: name, path: full, contentType: d.mime });
  }
  return { files, skipped, docs };
}

/* the mail that only asks: Approve or Reject */
const BTN = {
  approve: ['#0d7a45', '✔ Approve'],
  back: ['#c76a06', '↩ Send back for correction'],
  reject: ['#b42323', '✖ Reject'],
};
const shell = (title, lines, extra) => `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b1810;max-width:560px">
    <h2 style="color:#c4400f;margin-bottom:6px">${title}</h2>
    <table style="border-collapse:collapse;margin:10px 0 14px">${lines.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#8a6f5f;vertical-align:top">${esc(k)}</td><td style="padding:3px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>
    ${extra}</div>`;
const attachedHtml = (att) => (att.files.length
  ? `<p style="margin:0 0 14px;color:#8a6f5f;font-size:13px">📎 Attached: ${att.files.map((x) => esc(x.filename)).join(' · ')}</p>`
  : '<p style="margin:0 0 14px;color:#8a6f5f;font-size:13px">No documents uploaded yet.</p>')
  + (att.skipped.length ? `<p style="margin:0 0 14px;color:#b42323;font-size:13px">Not attached: ${att.skipped.map(esc).join(' · ')}</p>` : '');
const noteHtml = (note) => (note ? `<div style="background:#fff1cc;color:#6b4a00;padding:10px 14px;border-radius:10px;margin:0 0 14px">${note}</div>` : '');

/* mail with buttons that act straight from the mail (Finance on inward, Quality on outward) */
export function approvalMail(role, subject, { title, lines, kind, id, status, actions = ['approve', 'reject'], note = '' }) {
  (async () => {
    const att = await docAttachments(kind, id);
    const url = (a) => `${appUrl()}/api/mail/act?t=${encodeURIComponent(mailToken(kind, id, status, a))}`;
    const btn = (a) => `<a href="${url(a)}" style="display:inline-block;background:${BTN[a][0]};color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px 6px 0">${BTN[a][1]}</a>`;
    const html = shell(title, lines, `${noteHtml(note)}${attachedHtml(att)}${actions.map(btn).join('')}
    <p style="color:#8a6f5f;font-size:12px;margin-top:18px">Each button opens a confirmation page first. The links work for 7 days and only while the entry is still waiting for you.</p>`);
    await sendMail(await recipients(role), subject, html, att.files);
  })().catch((e) => console.error('[approvalMail]', e.message));
}

/* mail that asks someone to open the app (Quality fills the QC form there) */
export function openAppMail(role, subject, { title, lines, kind, id, note = '', buttonText = 'Open in the app' }) {
  (async () => {
    const att = await docAttachments(kind, id);
    const link = `${appUrl()}/approvals?open=${kind}-${id}${kind === 'inward' ? '&form=qc' : ''}`;
    const html = shell(title, lines, `${noteHtml(note)}${attachedHtml(att)}
    <a href="${link}" style="display:inline-block;background:#e4531a;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 0">${esc(buttonText)}</a>
    <p style="color:#8a6f5f;font-size:12px;margin-top:18px">You need to log in to the app. The decision is recorded under your name.</p>`);
    await sendMail(await recipients(role), subject, html, att.files);
  })().catch((e) => console.error('[openAppMail]', e.message));
}

/* information only (no buttons): to the person who created the entry and/or whole roles */
export function infoMail({ roles = [], userIds = [] }, subject, { title, lines, note = '', color = '' }) {
  (async () => {
    const set = new Set();
    for (const r of roles) for (const a of await recipients(r)) set.add(a.toLowerCase());
    for (const id of userIds.filter(Boolean)) {
      const r = await q("select email from users where id=$1 and active and email not like '%@pokonut.local'", [id]);
      r.rows.forEach((x) => set.add(x.email.toLowerCase()));
    }
    const html = shell(title, lines, `${noteHtml(note)}<p style="color:#8a6f5f;font-size:12px;margin-top:10px">For your information – no action needed. Open the app to see the full entry: <a href="${appUrl()}">${appUrl()}</a></p>`).replace('color:#c4400f', color ? 'color:' + color : 'color:#c4400f');
    await sendMail([...set], subject, html);
  })().catch((e) => console.error('[infoMail]', e.message));
}
