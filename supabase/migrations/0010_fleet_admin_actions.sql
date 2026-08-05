-- Support les actions du BackOffice admin sur l'onglet Flotte et le panneau
-- "Actions administratives" : retrait d'un véhicule, notification flotte,
-- planification de maintenance.

-- 1. Retrait "logique" d'un véhicule : on ne supprime jamais la ligne (des
--    courses passées peuvent y faire référence), on le marque simplement
--    inactif et il disparaît des vues flotte.
alter table public.vehicles
  add column if not exists is_active boolean not null default true;

-- 2. Notifications envoyées par l'admin à tout ou partie de la flotte.
create table if not exists public.fleet_notifications (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  sent_by uuid references public.profiles(id),
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.fleet_notifications enable row level security;

drop policy if exists fleet_notifications_admin_all on public.fleet_notifications;
create policy fleet_notifications_admin_all on public.fleet_notifications for all to authenticated
  using (is_admin()) with check (is_admin());

-- 3. Maintenance planifiée pour un ou plusieurs véhicules.
create table if not exists public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  scheduled_date date not null,
  note text,
  created_by uuid references public.profiles(id),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.vehicle_maintenance enable row level security;

drop policy if exists vehicle_maintenance_admin_all on public.vehicle_maintenance;
create policy vehicle_maintenance_admin_all on public.vehicle_maintenance for all to authenticated
  using (is_admin()) with check (is_admin());
