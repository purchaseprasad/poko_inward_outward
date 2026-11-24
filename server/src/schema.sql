create table if not exists users(
  id serial primary key, name text not null, email text not null unique, password_hash text not null,
  role text not null check(role in('Admin','Staff','Finance','Quality')), active boolean not null default true,
  created_at timestamptz not null default now());

create table if not exists warehouses(id serial primary key, name text not null unique, code text not null unique, active boolean not null default true);
create table if not exists products(id serial primary key, name text not null, sku text not null default '', active boolean not null default true);
create unique index if not exists products_name_u on products(lower(name));
create unique index if not exists products_sku_u on products(upper(sku)) where sku<>'';
create table if not exists vendors(id serial primary key, name text not null, active boolean not null default true);
create unique index if not exists vendors_name_u on vendors(lower(name));
create table if not exists transporters(id serial primary key, name text not null, active boolean not null default true);
create unique index if not exists transporters_name_u on transporters(lower(name));
create table if not exists outward_types(id serial primary key, name text not null, kind text not null default 'sale' check(kind in('sale','transfer','damaged','employee','other')), active boolean not null default true);
create unique index if not exists outward_types_name_u on outward_types(lower(name));
create table if not exists employees(id serial primary key, emp_no text not null, name text not null, dept text not null default '', active boolean not null default true);
create unique index if not exists employees_no_u on employees(lower(emp_no));

create table if not exists seq(prefix text primary key, n int not null default 0);

create table if not exists inward(
  id serial primary key, no text not null unique, warehouse_id int not null references warehouses(id),
  supplier text not null, po text not null default '', invoice_no text not null, invoice_date date, received_date date not null,
  challan text not null default '', transporter text not null default '', vehicle text not null default '', lr text not null default '', remarks text not null default '',
  status text not null, reject_reason text, rejected_by text, via_bulk boolean not null default false,
  created_by int not null references users(id), created_at timestamptz not null default now());
create unique index if not exists inward_inv_u on inward(lower(supplier),lower(invoice_no)) where status<>'Rejected';
create table if not exists inward_items(
  id serial primary key, inward_id int not null references inward(id) on delete cascade,
  product text not null, sku text not null, batch text not null, expiry date,
  expected int not null default 0, received int not null check(received>=0), accepted int not null check(accepted>=0), damaged int not null check(damaged>=0),
  short int not null default 0, excess int not null default 0, check(accepted+damaged<=received));

create table if not exists outward(
  id serial primary key, no text not null unique, warehouse_id int not null references warehouses(id),
  type text not null, kind text not null, out_date date not null, dest_warehouse_id int references warehouses(id),
  party text not null default '', transporter text not null default '', vehicle text not null default '', lr text not null default '',
  eway text not null default '', gate text not null default '', remarks text not null default '',
  emp_no text not null default '', emp_name text not null default '', dept text not null default '', purpose text not null default '',
  status text not null, reject_reason text, rejected_by text, via_bulk boolean not null default false,
  created_by int not null references users(id), created_at timestamptz not null default now());
create table if not exists outward_items(
  id serial primary key, outward_id int not null references outward(id) on delete cascade,
  sku text not null, product text not null, batch text not null, expiry date, qty int not null check(qty>0));

create table if not exists inventory(
  id serial primary key, warehouse_id int not null references warehouses(id), sku text not null, product text not null, batch text not null, expiry date,
  avail int not null default 0 check(avail>=0), damaged int not null default 0 check(damaged>=0), transit int not null default 0 check(transit>=0),
  unique(warehouse_id,sku,batch));
create table if not exists ledger(
  id bigserial primary key, ts timestamptz not null default now(), warehouse_id int not null references warehouses(id),
  sku text not null, product text not null, batch text not null, bucket text not null, qty int not null, balance int not null,
  type text not null, ref text not null, user_name text not null default '');

create table if not exists documents(
  id serial primary key, kind text not null check(kind in('inward','outward')), tx_id int not null, doc_type text not null, version int not null default 1,
  file_name text not null, mime text not null, size int not null, path text not null, uploaded_by text not null default '',
  deleted boolean not null default false, created_at timestamptz not null default now());
create index if not exists documents_tx on documents(kind,tx_id);

create table if not exists activity(
  id bigserial primary key, kind text not null, tx_id int not null, ts timestamptz not null default now(),
  user_name text not null default '', role text not null default '', action text not null, note text not null default '');
create index if not exists activity_tx on activity(kind,tx_id);

create table if not exists email_log(
  id serial primary key, ts timestamptz not null default now(), to_list text not null, subject text not null, status text not null, error text);

-- ===== QC form, send-back for correction, damage cause (added later – safe to run again) =====
alter table inward_items add column if not exists damage_cause text not null default '';
alter table inward_items add column if not exists qc_received int;
alter table inward_items add column if not exists qc_accepted int;
alter table inward_items add column if not exists qc_damaged int;
alter table inward add column if not exists qc_by text;
alter table inward add column if not exists qc_at timestamptz;
alter table inward add column if not exists qc_packaging text;
alter table inward add column if not exists qc_batch_ok boolean;
alter table inward add column if not exists qc_remarks text;
alter table inward add column if not exists return_to text;
alter table inward add column if not exists return_by text;
alter table inward add column if not exists return_reason text;
alter table inward add column if not exists return_corrections text;
alter table inward add column if not exists resume_stage text;

-- ===== documents are stored inside the database (hosting disks are not permanent) =====
alter table documents add column if not exists data bytea;
alter table documents alter column path drop not null;
