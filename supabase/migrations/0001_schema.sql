-- =========================================================================
-- Private Fleet — schéma Supabase
-- Ce fichier reflète le schéma tel que déployé sur le projet Supabase
-- "moto-taxi-tchad" utilisé par cette application.
-- Il est fourni pour pouvoir recréer la base sur un nouveau projet Supabase
-- si nécessaire (Dashboard > SQL Editor > coller ce fichier, dans l'ordre).
-- =========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('passenger', 'driver', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type driver_validation_status as enum ('pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vehicle_type as enum ('suv', 'prestige', 'berline');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vehicle_status as enum ('offline', 'available', 'busy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trip_status as enum ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('airtel_money', 'moov_money', 'cash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'paid', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Utilisateurs (1 ligne par compte auth.users, passager ou chauffeur)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'passenger',
  full_name text,
  phone text unique,
  created_at timestamptz not null default now()
);

-- Chauffeurs (données spécifiques, 1-1 avec profiles quand role='driver')
create table if not exists public.drivers (
  id uuid primary key references public.profiles(id) on delete cascade,
  license_number text,
  insurance_expiry date,
  validation_status driver_validation_status not null default 'pending',
  rating_avg numeric default 5.0,
  created_at timestamptz not null default now()
);

-- Véhicules affectés à un chauffeur
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  type vehicle_type not null,
  plate text not null,
  brand text,
  model text,
  passenger_capacity integer not null default 1,
  status vehicle_status not null default 'offline',
  last_lat double precision,
  last_lng double precision,
  updated_at timestamptz not null default now()
);

-- Grille tarifaire par type de véhicule
create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  vehicle_type vehicle_type not null unique,
  base_fare integer not null,
  price_per_km integer not null,
  peak_multiplier numeric not null default 1.0,
  updated_at timestamptz not null default now()
);

-- Courses
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles(id),
  driver_id uuid references public.drivers(id),
  vehicle_id uuid references public.vehicles(id),
  vehicle_type vehicle_type not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  pickup_address text,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  dropoff_address text,
  estimated_price integer,
  final_price integer,
  status trip_status not null default 'pending',
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);

-- Paiements (espèces, Airtel Money, Moov Money)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  method payment_method not null,
  amount integer not null,
  status payment_status not null default 'pending',
  provider_reference text,
  created_at timestamptz not null default now()
);

-- Notations passager -> chauffeur (ou inverse)
create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  rated_by uuid not null references public.profiles(id),
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.trips enable row level security;
alter table public.payments enable row level security;
alter table public.ratings enable row level security;

-- profiles
create policy profiles_select_own on public.profiles for select
  using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert
  with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update
  using (auth.uid() = id);
create policy profiles_admin_select on public.profiles for select to authenticated
  using (is_admin());

-- drivers
create policy drivers_select_approved_or_own on public.drivers for select
  using (validation_status = 'approved' or auth.uid() = id);
create policy drivers_insert_own on public.drivers for insert
  with check (auth.uid() = id);
create policy drivers_update_own on public.drivers for update
  using (auth.uid() = id);
create policy drivers_admin_all on public.drivers for all to authenticated
  using (is_admin()) with check (is_admin());

-- vehicles
create policy vehicles_select_all_authenticated on public.vehicles for select
  using (auth.role() = 'authenticated');
create policy vehicles_modify_own on public.vehicles for all
  using (auth.uid() = (select drivers.id from public.drivers where drivers.id = vehicles.driver_id));
create policy vehicles_admin_all on public.vehicles for all to authenticated
  using (is_admin()) with check (is_admin());

-- pricing_rules
create policy pricing_rules_select_all on public.pricing_rules for select
  using (auth.role() = 'authenticated');

-- trips
create policy trips_insert_own on public.trips for insert
  with check (auth.uid() = passenger_id);
create policy trips_select_own_passenger on public.trips for select
  using (auth.uid() = passenger_id);
create policy trips_select_own_driver on public.trips for select
  using (auth.uid() = driver_id);
create policy trips_select_pending_for_drivers on public.trips for select
  using (
    status = 'pending' and exists (
      select 1 from public.drivers
      where drivers.id = auth.uid() and drivers.validation_status = 'approved'
    )
  );
create policy trips_update_passenger_or_driver on public.trips for update
  using (auth.uid() = passenger_id or auth.uid() = driver_id);
create policy trips_accept_by_approved_driver on public.trips for update to authenticated
  using (
    status = 'pending' and driver_id is null and exists (
      select 1 from public.drivers
      where drivers.id = auth.uid() and drivers.validation_status = 'approved'
    )
  )
  with check (driver_id = auth.uid() and status = 'accepted');
create policy trips_admin_select on public.trips for select to authenticated
  using (is_admin());

-- payments
create policy payments_select_related on public.payments for select
  using (exists (
    select 1 from public.trips
    where trips.id = payments.trip_id
      and (trips.passenger_id = auth.uid() or trips.driver_id = auth.uid())
  ));
create policy payments_insert_cash_own on public.payments for insert to authenticated
  with check (
    method = 'cash' and status = 'pending' and exists (
      select 1 from public.trips
      where trips.id = payments.trip_id and trips.passenger_id = auth.uid()
    )
  );
create policy payments_update_driver_confirms_cash on public.payments for update to authenticated
  using (
    method = 'cash' and exists (
      select 1 from public.trips
      where trips.id = payments.trip_id and trips.driver_id = auth.uid()
    )
  )
  with check (status in ('paid', 'failed'));
create policy payments_admin_select on public.payments for select to authenticated
  using (is_admin());

-- ratings
create policy ratings_select_related on public.ratings for select
  using (exists (
    select 1 from public.trips
    where trips.id = ratings.trip_id
      and (trips.passenger_id = auth.uid() or trips.driver_id = auth.uid())
  ));
create policy ratings_insert_own on public.ratings for insert
  with check (auth.uid() = rated_by);

-- ---------------------------------------------------------------------
-- Grille tarifaire par défaut (FCFA)
-- ---------------------------------------------------------------------
insert into public.pricing_rules (vehicle_type, base_fare, price_per_km, peak_multiplier)
values
  ('berline', 1000, 350, 1.2),
  ('prestige', 1500, 450, 1.2),
  ('suv', 2000, 550, 1.2)
on conflict (vehicle_type) do nothing;
