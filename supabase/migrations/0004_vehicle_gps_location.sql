-- Suivi GPS temps réel du véhicule (mise à jour par le chauffeur, lue par le
-- passager pendant la course via Supabase Realtime sur `vehicles`).
alter table public.vehicles
  add column if not exists current_lat double precision,
  add column if not exists current_lng double precision,
  add column if not exists location_updated_at timestamptz;

do $$ begin
  alter publication supabase_realtime add table public.vehicles;
exception when duplicate_object then null; end $$;

alter table public.vehicles replica identity full;
