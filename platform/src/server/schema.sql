-- Arbor OS / Polska Flora - PostgreSQL baseline
-- Mirrors src/types.ts and the handoff operational flow.

create type role as enum ('ADMINISTRATOR','DYREKTOR','ROP','KIEROWNIK','WYCENIAJACY','BRYGADZISTA','PRACOWNIK','KSIEGOWA');
create type order_status as enum ('NOWE','ZAPLANOWANE','W_REALIZACJI','ZAKONCZONE','ANULOWANE');
create type valuation_status as enum ('do_potwierdzenia','zatwierdzona','przydzielona','odrzucona');
create type invoice_status as enum ('szkic','wyslana','oplacona','po_terminie');

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  login text not null unique,
  first_name text not null,
  last_name text not null,
  password_hash text not null,
  role role not null,
  team_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  name text not null,
  phone text not null,
  email text,
  address text,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table crews (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  name text not null,
  leader_id uuid references users(id),
  utilization integer not null default 0
);

alter table users add constraint users_team_fk foreign key (team_id) references crews(id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  client_id uuid not null references clients(id),
  team_id uuid references crews(id),
  estimator_id uuid references users(id),
  address text not null,
  city text not null,
  service_type text not null,
  status order_status not null default 'NOWE',
  priority text not null default 'normalny',
  scheduled_at timestamptz,
  inspection_at timestamptz,
  value_net numeric(12,2) not null default 0,
  margin_percent numeric(5,2) not null default 0,
  checklist jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table valuations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  client_id uuid not null references clients(id),
  estimator_id uuid not null references users(id),
  status valuation_status not null default 'do_potwierdzenia',
  total_net numeric(12,2) not null,
  margin_percent numeric(5,2) not null,
  items jsonb not null default '[]',
  media jsonb not null default '[]',
  notes text,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  client_id uuid not null references clients(id),
  number text not null unique,
  net numeric(12,2) not null,
  status invoice_status not null default 'szkic',
  due_at date not null,
  paid_at timestamptz
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  name text not null,
  type text not null,
  status text not null,
  risk text not null,
  review_due date
);

create table call_recordings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  estimator_id uuid references users(id),
  zadarma_call_id text not null unique,
  encrypted_storage_key text not null,
  retention_until date not null,
  created_at timestamptz not null default now()
);

create table call_analyses (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references call_recordings(id),
  score integer not null check (score between 0 and 100),
  transcript jsonb not null,
  strengths jsonb not null default '[]',
  improve jsonb not null default '[]',
  tips text,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index orders_branch_status_idx on orders(branch_id, status);
create index orders_team_idx on orders(team_id);
create index valuations_status_idx on valuations(status);
create index invoices_status_idx on invoices(status);
create index outbox_pending_idx on outbox(created_at) where delivered_at is null;
