import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { cfg, pool } from './db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

/* master data from VENDOR_AND_PRODUCT_LIST.xlsx */
const NS = 'Nandini Skin Care Private Limited', VC = 'Vedic Cosmeceuticals Private Limited';
const PRODUCTS = [
  ['Pokonut Stretch Mark Cream', '1001033'], ['Dark Patch Reducer Cream', '1001049'], ['Dark Spot Removal Cream', '1001062'],
  ['Natural Beauty Face Cream', '1001007'], ['Foot Cream', '1001059'], ['Sunscreen Cream', '1001003'], ['Sunscreen Lotion', '1001057'],
  ['Kumkumadi Oil', '1001041-A'], ['Kumkumadi Face Wash', '1001058'], ['Vita-C Face Serum', '1001071'], ['Hair Growth Serum', '1001070'],
  ['Pokonut Stretch Mark Roll On', '1001074'], ['Foot Roll On', ''], ['Underarm Roll On', ''], ['Natural Face Mist', '1001081'],
  ['Lip Balm', '1001082'], ['Slimming Massage Oil', '1001083'], ['Repair Combo', ''], ['Skin Shine Soap-100g', '1001008'],
  ['Charcoal Detox Soap', '1001048'], ['Anti Blemish Soap', '1001010'], ['Golden Glow Soap', '1001018'], ['Anti Acne Soap', '1001013'],
  ['D-Tan Soap', '1001017'], ['Derma Roller', 'ACC-01'], ['Ice Roller', 'ACC-02'], ['Pumice Stone', 'ACC-03'], ['Comb', 'ACC-04'],
  ['Natural Loofah', 'ACC-05'], ['Corrugated Boxes', ''], ['DT Labels', ''], ['Brown Tape Rolls', ''],
];
const VENDORS = [NS, VC, 'Divyanand Packaging', 'Banwari Lal', "Aldo Labe's", 'Pioneer Papers', "K.S Tape's"];
const TRANSPORTERS = ['Delhivery', 'Safe Express', 'Kwikship', 'Amazon', 'Ekart', 'Xpress Bee', 'India Post'];
const OUT_TYPES = [
  ['Blinkit', 'sale'], ['Blinkit FBA', 'sale'], ['BigBasket', 'sale'], ['Amazon', 'sale'], ['Amazon FBA', 'sale'], ['Flipkart', 'sale'],
  ['Warehouse Transfer', 'transfer'], ['Damaged Stock Disposal', 'damaged'], ['Employee Issue', 'employee'],
];

export async function ensureDatabase() {
  if (process.env.DATABASE_URL) return; // hosted database already exists
  const admin = new pg.Client({ ...cfg, database: 'postgres' });
  await admin.connect();
  const r = await admin.query('select 1 from pg_database where datname=$1', [cfg.database]);
  if (!r.rowCount) {
    await admin.query(`create database "${cfg.database.replace(/"/g, '')}"`);
    console.log('Created database', cfg.database);
  }
  await admin.end();
}

export async function migrate() {
  await ensureDatabase();
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  const c = pool;
  await c.query(`insert into warehouses(name,code) values('Bangalore Warehouse','BLR'),('Pinjore Warehouse','PNJ') on conflict do nothing`);
  for (const [n, s] of PRODUCTS) await c.query('insert into products(name,sku) values($1,$2) on conflict do nothing', [n, s]);
  for (const n of VENDORS) await c.query('insert into vendors(name) values($1) on conflict do nothing', [n]);
  for (const n of TRANSPORTERS) await c.query('insert into transporters(name) values($1) on conflict do nothing', [n]);
  for (const [n, k] of OUT_TYPES) await c.query('insert into outward_types(name,kind) values($1,$2) on conflict do nothing', [n, k]);
  if (process.env.NODE_ENV === 'production') {
    /* hosted: only ONE Admin, created the first time. The Admin adds everybody else in Admin Panel > Users. */
    const n = (await c.query('select count(*)::int n from users')).rows[0].n;
    if (!n) {
      const crypto = await import('node:crypto');
      const pass = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
      const email = (process.env.ADMIN_LOGIN_EMAIL || 'admin@pokonut.local').toLowerCase();
      await c.query("insert into users(name,email,password_hash,role) values('Admin',$1,$2,'Admin')", [email, await bcrypt.hash(pass, 10)]);
      console.log(`First Admin created. Login: ${email}` + (process.env.SEED_PASSWORD ? '' : `  Password: ${pass}   (shown only once – log in and change it)`));
    }
  } else {
    const pw = await bcrypt.hash(process.env.SEED_PASSWORD || 'Pokonut@123', 10);
    const users = [
      ['Admin', 'admin@pokonut.local', 'Admin'], ['Staff User', 'staff@pokonut.local', 'Staff'],
      ['Finance User', 'finance@pokonut.local', 'Finance'], ['Quality User', 'quality@pokonut.local', 'Quality'],
    ];
    for (const [n, e, r] of users) await c.query('insert into users(name,email,password_hash,role) values($1,$2,$3,$4) on conflict(email) do nothing', [n, e, pw, r]);
  }
  console.log('Database ready.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
}
