-- Messagerie in-app entre passager et chauffeur, limitée à la durée d'une
-- course (écrans 4 et 5 côté passager, écran "course en cours" côté
-- chauffeur). Complète le bouton "Message" qui ouvrait jusqu'ici seulement
-- l'app SMS du téléphone (lien hors-app conservé en repli).

create table if not exists public.trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  sender_role text not null check (sender_role in ('passenger', 'driver')),
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists trip_messages_trip_id_created_at_idx
  on public.trip_messages (trip_id, created_at);

alter table public.trip_messages enable row level security;

-- Lecture : uniquement les deux participants de la course concernée.
create policy trip_messages_select_participants on public.trip_messages for select
  using (
    exists (
      select 1 from public.trips
      where trips.id = trip_messages.trip_id
        and (trips.passenger_id = auth.uid() or trips.driver_id = auth.uid())
    )
  );

-- Écriture : un participant ne peut écrire qu'en son propre nom
-- (sender_id = auth.uid()), avec le rôle correspondant à sa relation
-- réelle à la course (évite qu'un passager s'insère comme "driver" ou
-- inversement), et seulement pendant que la course est active.
create policy trip_messages_insert_participants on public.trip_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.trips
      where trips.id = trip_messages.trip_id
        and trips.status in ('accepted', 'in_progress')
        and (
          (trips.passenger_id = auth.uid() and sender_role = 'passenger')
          or (trips.driver_id = auth.uid() and sender_role = 'driver')
        )
    )
  );

do $$ begin
  alter publication supabase_realtime add table public.trip_messages;
exception when duplicate_object then null;
end $$;

alter table public.trip_messages replica identity full;
