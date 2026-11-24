# Pokonut Warehouse Inward & Outward Management (PERN)

PostgreSQL + Express + React + Node. Runs on localhost first; deploy later.

## First-time setup
1. `cd server` → copy `.env.example` to `.env` and set `PGPASSWORD` (your local Postgres `postgres` user password).
   Also set `JWT_SECRET` (any long random text). Gmail settings are optional for now.
2. `npm install` in `server` and in `client`.
3. Start both: run `.\start-dev.ps1` (or `npm run dev` in `server`, and `npm run dev` in `client`).
4. Open http://localhost:5173

The database `pokonut_wms`, all tables, the product / vendor / transporter lists and the 4 logins are created automatically on first start.

## Logins (local PC only)
On your own PC the first start creates four starter users: admin@, staff@, finance@ and quality@pokonut.local. Their password is `SEED_PASSWORD` from `server/.env` (a default is used if it is empty – change it after the first login). Add the real people in Admin Panel > Users and switch the starter users off.
On hosting only one Admin is created – see DEPLOY.md.

## Flow
- **Inward:** Staff enters the goods (received / accepted / damaged, and the **damage cause** – Transport damage needs a Damaged Box Photo) -> **Quality** checks physically and fills the **QC form** (counted quantities, packaging, batch & expiry check) -> **Finance** verifies invoice + quantity and gives the final approval -> stock is added using Quality's counts.
- **Send back:** Quality or Finance can *send back for correction* (reason + what to correct). Quality's send-back goes to Staff. Finance can send back to Staff or to Quality. Staff opens the entry, corrects and resubmits. *Reject* is final.
- **Transport Claims** page lists goods damaged in transport per transporter (LR, photos) for claims.
- **Outward / Employee issue:** Staff creates → **Quality** final approval → stock reduced. Sales (Blinkit, BigBasket, Amazon, Flipkart …) need a Sales Invoice first.
- Warehouse transfer: approval moves stock to In Transit; the destination confirms receipt.
- Admin can act at any stage, manages users and lists, and has bulk upload for inward and outward.
- Every inward / outward entry records **who created it** (shown in lists, filterable, and in the entry).

## E-mails (Approve / Reject buttons)
- **GMAIL_USER** and **GMAIL_APP_PASSWORD** in `server/.env` = the Gmail mailbox the mails are sent FROM (App Password: Google Account > Security > 2-Step Verification > App passwords).
- **QUALITY_EMAIL** and **FINANCE_EMAIL** in `server/.env` = who RECEIVES them (one or several addresses separated by commas).
- Each mail shows the entry details and only two buttons: **Approve** and **Reject**. A button opens a confirmation page (Reject asks for a reason). No login is needed; the link works for 7 days and only while the entry is still waiting at that stage. The activity history records it as "Quality team (via e-mail)" / "Finance team (via e-mail)".
- Inward: new entry -> mail to **Quality** (with the documents attached and an "Open the QC form" button – the QC decision is made in the app, under the person's name). Quality approves -> mail to **Finance** (Approve / Send back / Reject buttons) and an information mail to Staff + Admin. Finance approves -> information mail to Staff, Quality, Admin. Send back / reject -> information mail to Staff + Admin with the reason and corrections. Outward / employee issue: new entry -> mail to Quality (Approve / Reject buttons).
- Add `ADMIN_EMAIL` (and `QUALITY_EMAIL`, `FINANCE_EMAIL`) in `server/.env`; if empty, users with a real e-mail address in Admin > Users are used.
- Restart the server after changing `.env`. Admin > E-mail log shows sent / failed / skipped.

## Deploy later
`cd client && npm run build` creates `client/dist`; the Express server serves it automatically, so one Node process serves everything on port 3001. Put it behind HTTPS (e.g. Nginx / a cloud host), set `APP_URL`, a strong `JWT_SECRET`, change all passwords, and back up the Postgres database and `server/uploads`.
