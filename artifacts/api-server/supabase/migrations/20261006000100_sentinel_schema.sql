-- SENTINEL schema for Supabase Postgres.
-- Run this file in the Supabase SQL editor before running supabase/seed.sql.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'VIEWER' check (role in ('ADMIN', 'OPERATOR', 'VIEWER')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('FLOOD', 'CYCLONE', 'EARTHQUAKE', 'LANDSLIDE', 'FIRE', 'STORM', 'HEATWAVE', 'DROUGHT', 'INDUSTRIAL', 'OTHER')),
  severity text not null check (severity in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  status text not null check (status in ('ACTIVE', 'MONITORING', 'CONTAINED', 'RESOLVED')),
  priority text not null check (priority in ('P1', 'P2', 'P3')),
  description text not null default '',
  location text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  estimated_population integer not null default 0 check (estimated_population >= 0),
  assigned_team_id uuid,
  source text not null default 'Operator report',
  classification text not null default 'OBSERVED' check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED')),
  risk_factors text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.affected_zones (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.incidents(id) on delete set null,
  name text not null,
  location text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  risk_score integer not null check (risk_score between 0 and 100),
  risk_level text not null check (risk_level in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  estimated_population integer not null default 0 check (estimated_population >= 0),
  risk_factors text[] not null default '{}',
  classification text not null default 'OBSERVED' check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED')),
  updated_at timestamptz not null default now()
);

create table if not exists public.shelters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  capacity integer not null check (capacity >= 0),
  occupancy integer not null default 0 check (occupancy >= 0 and occupancy <= capacity),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'NEAR_CAPACITY', 'FULL', 'CLOSED')),
  contact text not null default '',
  classification text not null default 'OBSERVED' check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED')),
  updated_at timestamptz not null default now()
);

create table if not exists public.shelter_resources (
  id uuid primary key default gen_random_uuid(),
  shelter_id uuid not null references public.shelters(id) on delete cascade,
  item_name text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null,
  updated_at timestamptz not null default now(),
  unique (shelter_id, item_name, unit)
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  consumption_per_hour numeric check (consumption_per_hour is null or consumption_per_hour >= 0),
  hours_remaining numeric check (hours_remaining is null or hours_remaining >= 0),
  minimum_threshold numeric not null default 0 check (minimum_threshold >= 0),
  status text not null default 'GOOD' check (status in ('GOOD', 'LOW', 'CRITICAL', 'OUT')),
  updated_at timestamptz not null default now()
);

create table if not exists public.rescue_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'DEPLOYED', 'ON_SCENE', 'EN_ROUTE', 'OFFLINE')),
  location text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  incident_id uuid references public.incidents(id) on delete set null,
  priority text not null default 'P3' check (priority in ('P1', 'P2', 'P3')),
  vehicle text not null default '',
  notes text not null default '',
  classification text not null default 'OBSERVED' check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED')),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'incidents_assigned_team_id_fkey') then
    alter table public.incidents
      add constraint incidents_assigned_team_id_fkey
      foreign key (assigned_team_id) references public.rescue_teams(id) on delete set null;
  end if;
end $$;

create table if not exists public.rescue_operations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.rescue_teams(id) on delete restrict,
  incident_id uuid not null references public.incidents(id) on delete restrict,
  status text not null default 'DEPLOYED' check (status in ('EN_ROUTE', 'DEPLOYED', 'ON_SCENE', 'COMPLETED')),
  priority text not null default 'P2' check (priority in ('P1', 'P2', 'P3')),
  notes text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('CRITICAL', 'WARNING', 'INFORMATION')),
  title text not null,
  message text not null,
  source text not null,
  created_at timestamptz not null default now(),
  incident_id uuid references public.incidents(id) on delete set null,
  zone_id uuid references public.affected_zones(id) on delete set null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED')),
  classification text not null default 'OBSERVED' check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED'))
);

create table if not exists public.weather_observations (
  id uuid primary key default gen_random_uuid(),
  location text not null,
  lat double precision,
  lng double precision,
  temperature_c numeric not null,
  precipitation_mm numeric not null,
  wind_kph numeric not null,
  humidity_percent integer not null,
  pressure_hpa numeric not null,
  forecast_high_c numeric not null,
  forecast_low_c numeric not null,
  forecast_precipitation_mm numeric not null,
  source text not null,
  source_status text not null check (source_status in ('LIVE', 'STALE', 'ERROR', 'SIMULATED')),
  classification text not null check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED')),
  updated_at timestamptz not null default now()
);

create table if not exists public.flood_observations (
  id uuid primary key default gen_random_uuid(),
  location text not null,
  lat double precision,
  lng double precision,
  river_level_m numeric,
  river_discharge_m3s numeric,
  trend text not null check (trend in ('RISING', 'STEADY', 'FALLING')),
  rainfall_24h_mm numeric not null,
  risk_level text not null check (risk_level in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  source text not null,
  source_status text not null check (source_status in ('LIVE', 'STALE', 'ERROR', 'SIMULATED')),
  classification text not null check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED')),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_sources (
  id text primary key,
  name text not null,
  type text not null,
  status text not null check (status in ('LIVE', 'STALE', 'ERROR', 'SIMULATED', 'DISABLED')),
  last_success_at timestamptz,
  last_error text,
  message text not null default ''
);

create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  category text not null,
  created_at timestamptz not null default now(),
  classification text not null default 'OBSERVED' check (classification in ('OBSERVED', 'SIMULATED', 'FORECAST', 'CALCULATED'))
);

create index if not exists incidents_status_priority_idx on public.incidents(status, priority);
create index if not exists incidents_updated_at_idx on public.incidents(updated_at desc);
create index if not exists affected_zones_risk_score_idx on public.affected_zones(risk_score desc);
create index if not exists shelters_status_idx on public.shelters(status);
create index if not exists rescue_teams_status_idx on public.rescue_teams(status);
create index if not exists rescue_operations_started_at_idx on public.rescue_operations(started_at desc);
create index if not exists alerts_created_at_idx on public.alerts(created_at desc);
create index if not exists system_events_created_at_idx on public.system_events(created_at desc);

create or replace function public.sentinel_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.sentinel_role() from public;
grant execute on function public.sentinel_role() to authenticated;

create or replace function public.sentinel_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'VIEWER', nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists sentinel_create_profile on auth.users;
create trigger sentinel_create_profile
  after insert on auth.users
  for each row execute procedure public.sentinel_new_profile();

alter table public.profiles enable row level security;
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.sentinel_role() = 'ADMIN');
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.sentinel_role() = 'ADMIN')
  with check (public.sentinel_role() = 'ADMIN');
grant select, update on public.profiles to authenticated;

do $$
declare
  table_name text;
  table_names text[] := array[
    'incidents', 'affected_zones', 'shelters', 'shelter_resources', 'resources',
    'rescue_teams', 'rescue_operations', 'alerts', 'weather_observations',
    'flood_observations', 'data_sources', 'system_events'
  ];
begin
  foreach table_name in array table_names loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists sentinel_read_authenticated on public.%I', table_name);
    execute format(
      'create policy sentinel_read_authenticated on public.%I for select to authenticated using (true)',
      table_name
    );
    execute format('drop policy if exists sentinel_write_operational on public.%I', table_name);
    execute format(
      'create policy sentinel_write_operational on public.%I for all to authenticated using (public.sentinel_role() in (''ADMIN'', ''OPERATOR'')) with check (public.sentinel_role() in (''ADMIN'', ''OPERATOR''))',
      table_name
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
  table_names text[] := array[
    'incidents', 'affected_zones', 'shelters', 'shelter_resources', 'resources',
    'rescue_teams', 'rescue_operations', 'alerts', 'weather_observations',
    'flood_observations', 'data_sources', 'system_events'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array table_names loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;
