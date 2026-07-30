-- =========================================================================
-- Passage en production :
--  1) le code app utilise 'van' pour le 3ᵉ type de véhicule, la base utilisait
--     encore 'prestige' -> toute réservation "Van" échouait silencieusement.
--  2) active Supabase Realtime sur `trips` pour le tableau de bord chauffeur.
--  3) ouvre les paiements Airtel Money / Moov Money (jusqu'ici seul 'cash'
--     pouvait être inséré/mis à jour par le passager).
-- =========================================================================

-- 1) Aligne l'enum vehicle_type avec le code (public/icon_van.png, lib/pricing.ts)
alter type vehicle_type rename value 'prestige' to 'van';

-- 2) Realtime : indispensable pour l'écoute des nouvelles courses côté chauffeur
--    et le suivi de statut côté passager.
do $$ begin
  alter publication supabase_realtime add table public.trips;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; end $$;

alter table public.trips replica identity full;
alter table public.payments replica identity full;

-- 3) Paiements : autoriser la création d'un paiement Airtel Money / Moov Money
--    par le passager (statut 'pending' au moment de la réservation), en plus
--    du cash déjà géré.
drop policy if exists payments_insert_cash_own on public.payments;

create policy payments_insert_own on public.payments for insert to authenticated
  with check (
    status = 'pending' and exists (
      select 1 from public.trips
      where trips.id = payments.trip_id and trips.passenger_id = auth.uid()
    )
  );

-- Le passager confirme lui-même un paiement mobile money (transfert effectué
-- de son côté via l'appli Airtel/Moov) ; le cash reste confirmé par le chauffeur.
drop policy if exists payments_update_passenger_confirms_mobile on public.payments;

create policy payments_update_passenger_confirms_mobile on public.payments for update to authenticated
  using (
    method in ('airtel_money', 'moov_money') and exists (
      select 1 from public.trips
      where trips.id = payments.trip_id and trips.passenger_id = auth.uid()
    )
  )
  with check (status in ('paid', 'failed'));
