# Deploying: GitHub → Render (API + database) → Netlify (website)

```
Browser ──► Netlify (React website)
               │  every /api/... call is passed on by Netlify
               ▼
            Render web service (Node / Express API) ──► Render PostgreSQL
                                                         (data AND uploaded documents)
```

Because Netlify passes `/api/...` to Render, the browser only ever talks to your Netlify address.
That keeps login cookies working and makes the Approve / Reject links in the e-mails open correctly.

## 1. Render – database + backend (one step)
1. https://dashboard.render.com → **New → Blueprint** → connect the GitHub repo `poko_inward_outward` → **Apply**.
   `render.yaml` creates **poko-inward-outward-db** (PostgreSQL) and **poko-inward-outward-api** (the backend).
2. Open the **poko-inward-outward-api** service → **Environment** and fill in:

| Name | Value |
|---|---|
| `APP_URL` | your Netlify address, e.g. `https://poko-warehouse.netlify.app` (fill after step 2) |
| `ADMIN_LOGIN_EMAIL` | the e-mail you will log in with as Admin |
| `SEED_PASSWORD` | first Admin password (leave empty and a random one is printed once in the **Logs**) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Gmail sender – **or** the `SMTP_HOST` (`smtp.zoho.in`), `SMTP_PORT` (`465`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` lines for Zoho |
| `QUALITY_EMAIL`, `FINANCE_EMAIL`, `ADMIN_EMAIL` | who receives the mails (commas for several) |

   `DATABASE_URL`, `JWT_SECRET` and `NODE_ENV` are set automatically. Never put passwords in GitHub – only in Render.
3. Wait until the service says **Live**. Check `https://<your-api>.onrender.com/api/health` shows `{"ok":true}`.
   The first start creates all tables, the product / vendor / transporter lists and **one Admin user**.
4. If the API address Render shows is not `https://poko-inward-outward-api.onrender.com`, edit `client/netlify.toml` (the `to =` line) and push.

## 2. Netlify – website
1. https://app.netlify.com → **Add new site → Import an existing project** → GitHub → `poko_inward_outward`.
2. **Base directory:** `client` (build command and publish folder are read from `client/netlify.toml`) → **Deploy**.
3. Copy the Netlify address and put it in Render as `APP_URL`; Render redeploys by itself.

## 3. First login
Open the Netlify address → log in with `ADMIN_LOGIN_EMAIL` and the password.
**Admin Panel → Users:** add Staff, Quality and Finance people (their own names and real e-mail addresses, strong passwords).
Create one test inward entry and look at **Admin Panel → E-mail log** (should say "sent").

## Good to know
- **Free Render plan:** the API goes to sleep when unused – the first page after a quiet period can take ~50 seconds. A paid plan keeps it awake.
- **Free Render PostgreSQL is deleted after 30 days.** Before real use, upgrade the database to a paid plan in the Render dashboard (and keep backups).
- **Documents** are stored inside the database, so they survive restarts and redeploys.
- **Upload size:** Netlify passes requests on with a body limit of roughly 6 MB per request. Photos are compressed and PDFs are limited to 1.5 MB, so one entry with many large files could exceed it – upload the extra files from the entry afterwards.
- **Updating:** push to GitHub → Render and Netlify redeploy automatically.
- **Custom domain / HTTPS:** add it in Netlify; then change `APP_URL` in Render to the same address.
