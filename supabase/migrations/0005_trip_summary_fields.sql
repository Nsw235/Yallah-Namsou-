alter table public.trips
  add column if not exists distance_km numeric(6,2),
  add column if not exists driver_notes text;

alter table public.ratings
  add column if not exists tag text check (tag in ('client_sympa', 'aucun'));
