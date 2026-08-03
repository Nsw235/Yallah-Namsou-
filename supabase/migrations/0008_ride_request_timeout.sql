-- Ajoute un délai de recherche de chauffeur, comme dans les vraies
-- applications VTC : une course "pending" qu'aucun chauffeur n'accepte à
-- temps est automatiquement annulée, et le passager doit relancer une
-- demande. Corrige aussi le cas "chauffeur annule une course déjà
-- acceptée" : au lieu de disparaître silencieusement côté passager (bug
-- d'écran bloqué), la course repart en recherche pour un autre chauffeur,
-- avec un nouveau délai.

-- 1) Nouvelles colonnes ------------------------------------------------

alter table public.trips
  add column if not exists expires_at timestamptz,
  add column if not exists cancel_reason text
    check (cancel_reason in ('passenger_cancelled', 'driver_cancelled', 'timeout'));

comment on column public.trips.expires_at is
  'Date-limite au-delà de laquelle une course "pending" est automatiquement annulée (recherche de chauffeur expirée).';
comment on column public.trips.cancel_reason is
  'Raison d''une annulation : passenger_cancelled, driver_cancelled ou timeout.';

-- Les courses déjà en attente en base reçoivent un délai à partir de
-- maintenant, pour ne pas être annulées instantanément par le premier
-- passage du job d'expiration.
update public.trips
  set expires_at = now() + interval '3 minutes'
  where status = 'pending' and expires_at is null;

-- 2) Délai fixé automatiquement à la création d'une course --------------

create or replace function public.set_trip_expiry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'pending' and new.expires_at is null then
    new.expires_at := coalesce(new.requested_at, now()) + interval '3 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_set_expiry on public.trips;
create trigger trips_set_expiry
  before insert on public.trips
  for each row
  execute function public.set_trip_expiry();

-- 3) Expiration automatique des courses "pending" trop anciennes --------
-- Appelée par pg_cron toutes les 20 secondes, et en filet de sécurité
-- côté client quand le compte à rebours affiché arrive à zéro (au cas où
-- le job planifié aurait un peu de retard).

create or replace function public.expire_stale_trips()
returns setof public.trips
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
    update public.trips
      set status = 'cancelled',
          cancel_reason = 'timeout'
      where status = 'pending'
        and expires_at is not null
        and expires_at < now()
      returning *;
end;
$$;

revoke all on function public.expire_stale_trips() from public;
grant execute on function public.expire_stale_trips() to authenticated, service_role;

-- 4) Le chauffeur annule une course déjà acceptée ------------------------
-- Avant "j'arrive", si le chauffeur annule, la course repart en recherche
-- (status "pending") pour un autre chauffeur avec un nouveau délai, plutôt
-- que de se terminer sans que le passager comprenne pourquoi. Le véhicule
-- redevient disponible.

create or replace function public.driver_cancel_trip(p_trip_id uuid)
returns public.trips
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trip public.trips;
  v_vehicle_id uuid;
begin
  select vehicle_id into v_vehicle_id
    from public.trips
    where id = p_trip_id
      and driver_id = auth.uid()
      and status = 'accepted'
    for update;

  if not found then
    raise exception 'trip_not_cancellable';
  end if;

  update public.trips
    set status = 'pending',
        driver_id = null,
        vehicle_id = null,
        accepted_at = null,
        expires_at = now() + interval '3 minutes',
        cancel_reason = 'driver_cancelled'
    where id = p_trip_id
    returning * into v_trip;

  if v_vehicle_id is not null then
    update public.vehicles
      set status = 'available', updated_at = now()
      where id = v_vehicle_id;
  end if;

  return v_trip;
end;
$$;

revoke all on function public.driver_cancel_trip(uuid) from public;
grant execute on function public.driver_cancel_trip(uuid) to authenticated;

-- 5) Trace la raison quand le passager annule lui-même -------------------

create or replace function public.cancel_my_pending_trip(p_trip_id uuid)
returns public.trips
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trip public.trips;
begin
  update public.trips
    set status = 'cancelled',
        cancel_reason = 'passenger_cancelled'
    where id = p_trip_id
      and passenger_id = auth.uid()
      and status = 'pending'
    returning * into v_trip;

  if v_trip is null then
    raise exception 'trip_not_cancellable';
  end if;

  return v_trip;
end;
$$;

-- 6) Planification du job d'expiration (toutes les 20 secondes) ---------

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $migration$
begin
  if not exists (select 1 from cron.job where jobname = 'expire-stale-trips') then
    perform cron.schedule(
      'expire-stale-trips',
      '20 seconds',
      $cron$select public.expire_stale_trips();$cron$
    );
  end if;
end;
$migration$;
