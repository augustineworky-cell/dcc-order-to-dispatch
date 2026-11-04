-- DCC Order to Dispatch: schema for Okhla + Gurgaon (one project, split by location)

create extension if not exists pg_trgm with schema extensions;

-- ---------- reference data ----------
create table public.locations (
  code text primary key,
  name text not null,
  step_prefix text not null            -- SOO for Okhla, SOG for Gurgaon (old FMS key)
);

create table public.step_defs (
  step_no int primary key check (step_no between 1 and 10),
  name text not null
);

-- who does each step and the TAT rule, per location (replaces the formulas in row 1-5 of the FMS)
create table public.step_config (
  location text not null references public.locations(code),
  step_no int not null references public.step_defs(step_no),
  owner_label text not null,
  tool text,
  tat_kind text not null check (tat_kind in ('hours','workdays','same_day','delivery_days','unknown')),
  tat_value numeric,
  rule text,                           -- plain-words condition, e.g. 'only if invoice value > 50000'
  confirmed boolean not null default false,   -- false = copied from the sheet header, confirm with the team
  primary key (location, step_no)
);

create table public.holidays (
  day date primary key,
  name text
);

-- ---------- people ----------
create table public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  emp_id text unique,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin','staff','viewer')),
  locations text[] not null default '{}',   -- e.g. {okhla} or {okhla,gurgaon}
  steps int[] not null default '{}',        -- steps this person may complete
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- orders ----------
create table public.orders (
  id bigint generated always as identity primary key,
  location text not null references public.locations(code),
  so_no bigint not null,
  received_at timestamptz not null,           -- PO received (the FMS timestamp)
  party_name text not null,
  brand text,
  party_location text,
  po_number text,
  trade_category text,                         -- Modern Trade / General Trade / DCC Transfer / Sample / Distributor
  grn_required boolean not null default false,
  delivery_days numeric(4,1),
  invoice_no text,
  invoice_value numeric(14,2),
  is_d2c boolean not null default false,
  status text not null default 'active' check (status in ('active','done','cancelled')),
  current_step int references public.step_defs(step_no),
  source text not null default 'import',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location, so_no)
);
create index orders_loc_status_idx on public.orders (location, status);
create index orders_received_idx on public.orders (received_at desc);
create index orders_step_idx on public.orders (location, current_step) where status = 'active';
create index orders_invoice_idx on public.orders (invoice_no);
create index orders_party_trgm on public.orders using gin (party_name extensions.gin_trgm_ops);

-- one row per order per step (10 rows per order)
create table public.order_steps (
  order_id bigint not null references public.orders(id) on delete cascade,
  step_no int not null references public.step_defs(step_no),
  required boolean not null default true,
  state text not null default 'pending' check (state in ('pending','done','inferred','not_required')),
  planned_at timestamptz,
  actual_at timestamptz,
  done_by uuid references auth.users(id),
  done_by_name text,
  data jsonb not null default '{}'::jsonb,    -- step details: invoice_no, eway_no, driver, return_text, cn_no, cn_amount, grn_no, handed_to ...
  updated_at timestamptz not null default now(),
  primary key (order_id, step_no)
);
create index order_steps_pending_idx on public.order_steps (step_no, planned_at) where required and state = 'pending';

-- documents live in Google Drive; only the link is stored here
create table public.documents (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  step_no int references public.step_defs(step_no),
  kind text not null,                          -- receiving_copy / invoice_pdf / po / eway_bill
  drive_url text not null,
  drive_file_id text,
  created_at timestamptz not null default now()
);
create index documents_order_idx on public.documents (order_id);

-- who did what (small audit trail)
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  step_no int,
  action text not null,
  by_user uuid references auth.users(id),
  detail jsonb,
  at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, at desc);

-- ---------- helper functions ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
create trigger order_steps_touch before update on public.order_steps
  for each row execute function public.touch_updated_at();

-- keeps orders.current_step / status in step with order_steps
create or replace function public.refresh_order_progress(p_order bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare nxt int;
begin
  select min(step_no) into nxt from public.order_steps
   where order_id = p_order and required and state = 'pending';
  update public.orders o
     set current_step = nxt,
         status = case when o.status = 'cancelled' then 'cancelled'
                       when nxt is null then 'done' else 'active' end
   where o.id = p_order;
end $$;

create or replace function public.order_steps_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.refresh_order_progress(new.order_id); return null; end $$;

create trigger order_steps_progress after insert or update of state, required on public.order_steps
  for each row execute function public.order_steps_after_write();

-- access checks used by the row-level security policies
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users u
                  where u.user_id = (select auth.uid()) and u.active and u.role = 'admin') $$;

create or replace function public.can_see_location(loc text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users u
                  where u.user_id = (select auth.uid()) and u.active
                    and (u.role = 'admin' or loc = any (u.locations))) $$;

create or replace function public.can_do_step(loc text, step int) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users u
                  where u.user_id = (select auth.uid()) and u.active
                    and (u.role = 'admin' or (u.role = 'staff' and loc = any (u.locations) and step = any (u.steps)))) $$;

-- ---------- row-level security ----------
alter table public.locations   enable row level security;
alter table public.step_defs   enable row level security;
alter table public.step_config enable row level security;
alter table public.holidays    enable row level security;
alter table public.app_users   enable row level security;
alter table public.orders      enable row level security;
alter table public.order_steps enable row level security;
alter table public.documents   enable row level security;
alter table public.order_events enable row level security;

create policy ref_read_locations on public.locations   for select to authenticated using (true);
create policy ref_read_step_defs on public.step_defs   for select to authenticated using (true);
create policy ref_read_step_cfg  on public.step_config for select to authenticated using (true);
create policy ref_read_holidays  on public.holidays    for select to authenticated using (true);
create policy cfg_admin_write    on public.step_config for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy hol_admin_write    on public.holidays    for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy users_read_self  on public.app_users for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy users_admin_write on public.app_users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy orders_read on public.orders for select to authenticated
  using (public.can_see_location(location));
create policy orders_insert on public.orders for insert to authenticated
  with check (public.can_do_step(location, 1) or public.is_admin());
create policy orders_update on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy steps_read on public.order_steps for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_see_location(o.location)));
create policy steps_write on public.order_steps for update to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_do_step(o.location, step_no)))
  with check (exists (select 1 from public.orders o where o.id = order_id and public.can_do_step(o.location, step_no)));

create policy docs_read on public.documents for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_see_location(o.location)));
create policy docs_insert on public.documents for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and public.can_see_location(o.location)));

create policy events_read on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_see_location(o.location)));
create policy events_insert on public.order_events for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and public.can_see_location(o.location)));

-- ---------- views for the dashboard (they respect the same row-level security) ----------
create view public.v_pipeline with (security_invoker = true) as
  select location, current_step as step_no, count(*)::int as orders
    from public.orders where status = 'active' group by location, current_step;

create view public.v_tasks with (security_invoker = true) as
  select o.id as order_id, o.location, o.so_no, o.party_name, o.brand, o.trade_category,
         s.step_no, s.planned_at,
         (s.planned_at is not null and s.planned_at < now()) as is_late
    from public.orders o
    join public.order_steps s on s.order_id = o.id and s.step_no = o.current_step
   where o.status = 'active' and s.state = 'pending';
