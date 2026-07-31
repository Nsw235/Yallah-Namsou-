# État de synchronisation avec Supabase — 2026-08-01

Projet Supabase connecté : **Yallah-Namsou** (`jijvqzrldnijjfhlawda`, région eu-west-3, actif).

## Constat

Le dossier `supabase/migrations/` du dépôt ne contenait que **6 fichiers**, alors que
**21 migrations** ont réellement été appliquées sur la base de production. Le dépôt
était donc en retard d'une quinzaine de migrations, notamment :

- `cars_only_categories_fixed`, `cars_only_vehicle_types` — restriction aux véhicules
- `cash_payment_policies`, `trips_driver_accept_policy`, `admin_role_policies`
- `auto_create_profile_on_signup`, `auto_confirm_email_on_signup`
- `fix_driver_profile_visibility`
- `rename_prestige_to_van`, `fix_van_vehicle_type`, `add_van_pricing_rule`
- `dispatch_and_realtime_setup_2`, `dispatch_rpcs`
- `passenger_trip_transitions`, `driver_trip_transitions`
- `lock_privileged_columns_and_revoke_trigger_rpc`,
  `revoke_new_trigger_functions_public_execute`
- `trip_summary_fields`, `allow_driver_update_cash_payment_amount`

Supabase n'expose pas le SQL original de ces migrations via l'API (seulement leur nom
et leur version), donc je n'ai pas pu reconstituer les fichiers `.sql` historiques à
l'identique. En revanche, j'ai **régénéré `types/database.ts` directement depuis le
schéma live** — ce fichier est maintenant garanti exact (tables, enums, fonctions RPC).

## Fonctions RPC disponibles côté base (issues des migrations manquantes)

Ces fonctions existent en production mais ne sont pas toutes appelées par le code
frontend actuel (`lib/rides.ts`, `lib/driver.ts` font encore des `.update()` directs
sur `trips`, ce qui reste autorisé par les policies RLS actuelles — donc ça fonctionne,
mais ce n'est pas la voie "officielle" mise en place par les dernières migrations) :

- `assign_nearest_driver(p_trip_id)`
- `cancel_my_pending_trip(p_trip_id)` — déjà utilisée dans `lib/rides.ts`
- `driver_start_trip(p_trip_id)`
- `driver_complete_trip(p_trip_id, p_final_price)`
- `passenger_confirm_boarding(p_trip_id)`
- `passenger_complete_trip(p_trip_id, p_final_price)`
- `update_my_vehicle_location(p_vehicle_id, p_lat, p_lng)`
- `is_admin()`

## Tables en production

`profiles`, `drivers`, `vehicles`, `pricing_rules`, `trips`, `payments`, `ratings` —
toutes avec RLS activé, cohérentes avec `types/database.ts` mis à jour.

## Ce qui a été fait dans ce paquet

- ✅ `types/database.ts` régénéré à l'identique du schéma live.
- ⏳ Le dossier `supabase/migrations/` n'a pas pu être complété avec le SQL exact des
  15 migrations manquantes (non récupérable via l'API Supabase). Si besoin, on peut
  soit exporter le SQL depuis le Dashboard Supabase (Database → Migrations), soit je
  génère une migration de resynchronisation "snapshot" à partir de l'état actuel.
