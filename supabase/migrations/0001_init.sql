-- =========================================================================
-- Yalla Nimshi — schéma complet (repartir d'une base Supabase vide)
-- Flux "vrai Uber" : le passager crée une course "pending", TOUS les
-- chauffeurs disponibles du bon type de véhicule la voient en temps réel
-- (Realtime) et le premier qui clique "ACCEPTER" l'obtient (concurrence
-- gérée au niveau RLS : la ligne ne peut être acceptée qu'une seule fois).
-- =========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$ begin
  create type vehicle_type as enum ('berline', 'van', 'suv');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trip_status as enum ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cash', 'airtel_money', 'moov_money');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'paid', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Un profil par utilisateur Supabase Auth (passager, chauffeur ou admin)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'passenger' check (role in ('passenger', 'driver', 'admin')),
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- Détails spécifiques chauffeur (validation, note moyenne)
create table if not exists public.drivers (
  id uuid primary key references public.profiles(id) on delete cascade,
  license_number text,
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'approved', 'rejected', 'suspended')),
  rating_avg numeric(2,1) not null default 5.0,
  created_at timestamptz not null default now()
);

-- Véhicules de la flotte, avec position GPS en direct
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  type vehicle_type not null,
  plate text not null,
  brand text,
  model text,
  passenger_capacity int not null default 4,
  status text not null default 'offline' check (status in ('offline', 'available', 'busy')),
  current_lat double precision,
  current_lng double precision,
  location_updated_at timestamptz
);

-- Grille tarifaire (une ligne par type de véhicule)
create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  vehicle_type vehicle_type not null unique,
  base_fare integer not null,
  price_per_km integer not null,
  peak_multiplier numeric(3,2) not null default 1.0
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

-- Paiements — une ligne par course, créée dès la réservation avec la
-- méthode choisie par le passager (cash / Airtel Money / Moov Money)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  method payment_method not null,
  amount integer,
  status payment_status not null default 'pending',
  provider_reference text,
  created_at timestamptz not null default now()
);

-- Notation passager -> chauffeur
create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  rated_by uuid not null references public.profiles(id),
  rating integer not null check (rating between 1 and 5),
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
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
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
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
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
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles for select to authenticated using (is_admin());
-- un passager doit voir le nom du chauffeur qui lui est assigné, et vice-versa
drop policy if exists profiles_select_trip_counterpart on public.profiles;
create policy profiles_select_trip_counterpart on public.profiles for select to authenticated
  using (exists (
    select 1 from public.trips
    where (trips.passenger_id = auth.uid() and trips.driver_id = profiles.id)
       or (trips.driver_id = auth.uid() and trips.passenger_id = profiles.id)
  ));

-- drivers
drop policy if exists drivers_select_approved_or_own on public.drivers;
create policy drivers_select_approved_or_own on public.drivers for select
  using (validation_status = 'approved' or auth.uid() = id);
drop policy if exists drivers_insert_own on public.drivers;
create policy drivers_insert_own on public.drivers for insert with check (auth.uid() = id);
drop policy if exists drivers_update_own on public.drivers;
create policy drivers_update_own on public.drivers for update using (auth.uid() = id);
drop policy if exists drivers_admin_all on public.drivers;
create policy drivers_admin_all on public.drivers for all to authenticated
  using (is_admin()) with check (is_admin());

-- vehicles (lecture ouverte aux authentifiés : nécessaire pour afficher la
-- position GPS du véhicule assigné côté passager)
drop policy if exists vehicles_select_all_authenticated on public.vehicles;
create policy vehicles_select_all_authenticated on public.vehicles for select
  using (auth.role() = 'authenticated');
drop policy if exists vehicles_modify_own on public.vehicles;
create policy vehicles_modify_own on public.vehicles for all
  using (auth.uid() = driver_id);
drop policy if exists vehicles_admin_all on public.vehicles;
create policy vehicles_admin_all on public.vehicles for all to authenticated
  using (is_admin()) with check (is_admin());

-- pricing_rules
drop policy if exists pricing_rules_select_all on public.pricing_rules;
create policy pricing_rules_select_all on public.pricing_rules for select
  using (auth.role() = 'authenticated');

-- trips
drop policy if exists trips_insert_own on public.trips;
create policy trips_insert_own on public.trips for insert with check (auth.uid() = passenger_id);
drop policy if exists trips_select_own_passenger on public.trips;
create policy trips_select_own_passenger on public.trips for select using (auth.uid() = passenger_id);
drop policy if exists trips_select_own_driver on public.trips;
create policy trips_select_own_driver on public.trips for select using (auth.uid() = driver_id);
drop policy if exists trips_select_pending_for_drivers on public.trips;
create policy trips_select_pending_for_drivers on public.trips for select
  using (
    status = 'pending' and exists (
      select 1 from public.drivers where drivers.id = auth.uid() and drivers.validation_status = 'approved'
    )
  );
drop policy if exists trips_update_passenger_or_driver on public.trips;
create policy trips_update_passenger_or_driver on public.trips for update
  using (auth.uid() = passenger_id or auth.uid() = driver_id);
-- Course prise en 1er arrivé 1er servi : la ligne ne peut passer de
-- pending/driver_id null -> accepted/driver_id=moi qu'une seule fois.
drop policy if exists trips_accept_by_approved_driver on public.trips;
create policy trips_accept_by_approved_driver on public.trips for update to authenticated
  using (
    status = 'pending' and driver_id is null and exists (
      select 1 from public.drivers where drivers.id = auth.uid() and drivers.validation_status = 'approved'
    )
  )
  with check (driver_id = auth.uid() and status = 'accepted');
drop policy if exists trips_admin_select on public.trips;
create policy trips_admin_select on public.trips for select to authenticated using (is_admin());

-- payments
drop policy if exists payments_select_related on public.payments;
create policy payments_select_related on public.payments for select
  using (exists (
    select 1 from public.trips
    where trips.id = payments.trip_id and (trips.passenger_id = auth.uid() or trips.driver_id = auth.uid())
  ));
drop policy if exists payments_insert_own on public.payments;
create policy payments_insert_own on public.payments for insert to authenticated
  with check (exists (
    select 1 from public.trips where trips.id = payments.trip_id and trips.passenger_id = auth.uid()
  ));
-- le chauffeur confirme l'encaissement cash
drop policy if exists payments_update_driver_confirms_cash on public.payments;
create policy payments_update_driver_confirms_cash on public.payments for update to authenticated
  using (
    method = 'cash' and exists (
      select 1 from public.trips where trips.id = payments.trip_id and trips.driver_id = auth.uid()
    )
  )
  with check (status in ('paid', 'failed'));
-- le passager confirme lui-même son virement mobile money
drop policy if exists payments_update_passenger_confirms_mobile on public.payments;
create policy payments_update_passenger_confirms_mobile on public.payments for update to authenticated
  using (
    method in ('airtel_money', 'moov_money') and exists (
      select 1 from public.trips where trips.id = payments.trip_id and trips.passenger_id = auth.uid()
    )
  )
  with check (status in ('paid', 'failed'));
drop policy if exists payments_admin_select on public.payments;
create policy payments_admin_select on public.payments for select to authenticated using (is_admin());

-- ratings
drop policy if exists ratings_select_related on public.ratings;
create policy ratings_select_related on public.ratings for select
  using (exists (
    select 1 from public.trips
    where trips.id = ratings.trip_id and (trips.passenger_id = auth.uid() or trips.driver_id = auth.uid())
  ));
drop policy if exists ratings_insert_own on public.ratings;
create policy ratings_insert_own on public.ratings for insert with check (auth.uid() = rated_by);

-- ---------------------------------------------------------------------
-- Realtime (indispensable : suivi chauffeur temps réel + position GPS)
-- ---------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.trips; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.vehicles; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.payments; exception when duplicate_object then null; end $$;

alter table public.trips replica identity full;
alter table public.vehicles replica identity full;
alter table public.payments replica identity full;

-- ---------------------------------------------------------------------
-- Grille tarifaire par défaut (FCFA)
-- ---------------------------------------------------------------------
insert into public.pricing_rules (vehicle_type, base_fare, price_per_km, peak_multiplier)
values
  ('berline', 1000, 350, 1.2),
  ('van', 1500, 450, 1.2),
  ('suv', 2000, 550, 1.2)
on conflict (vehicle_type) do nothing;
