# Yalla Nimshi — App VTC (N'Djamena)

Réservation VTC (Next.js 14 + Supabase). Design, logo et icônes de véhicules
inchangés. La logique de réservation a été reconstruite pour suivre le vrai
flux Uber : une course "pending" est diffusée en temps réel (Supabase
Realtime) à **tous** les chauffeurs disponibles du bon type de véhicule ;
le premier qui clique "ACCEPTER" l'obtient (concurrence gérée par les
policies RLS, pas côté client).

## 1. Remettre la base Supabase à zéro

Dans le **SQL Editor** de ton projet Supabase :

```sql
drop schema public cascade;
create schema public;
grant all on schema public to postgres, anon, authenticated, service_role;
```

Puis colle et exécute le contenu de `supabase/migrations/0001_init.sql`
(fichier unique, il contient tout : tables, RLS, Realtime, grille tarifaire).

## 2. Installer en local

```bash
npm install
cp .env.local.example .env.local   # clés déjà pré-remplies
npm run dev
```

## 3. Créer un compte chauffeur (pas d'inscription chauffeur dans l'UI)

1. Crée un compte normal dans l'app (ça crée la ligne `profiles`, role
   `passenger` par défaut).
2. Dans le SQL Editor, promeus ce compte en chauffeur :

```sql
-- remplace <USER_ID> par l'id de auth.users (visible dans Authentication > Users)
update public.profiles set role = 'driver' where id = '<USER_ID>';

insert into public.drivers (id, license_number, validation_status)
values ('<USER_ID>', 'PERMIS-0001', 'approved');

insert into public.vehicles (driver_id, type, plate, brand, model, passenger_capacity, status)
values ('<USER_ID>', 'berline', 'TC-123-AB', 'Toyota', 'Corolla', 4, 'offline');
```

3. Connecte-toi avec ce compte sur `/chauffeur`.

## 4. Créer un compte admin

```sql
update public.profiles set role = 'admin' where id = '<USER_ID>';
```

Puis connecte-toi sur `/admin`.

## 5. Flux applicatif

| Écran (passager)              | Déclencheur                                                   |
|--------------------------------|----------------------------------------------------------------|
| 1. Véhicule + adresses         | Géocodage réel (Nominatim/OSM), tarif en FCFA depuis `pricing_rules` |
| 2. Confirmation + paiement     | Choix Cash / Airtel Money / Moov Money → crée `trips` + `payments` (pending) |
| 3. Recherche chauffeur         | Écoute Realtime sur la course ; annulable tant que "pending"   |
| 4. Chauffeur en route          | Position GPS live du véhicule (table `vehicles`)               |
| 5. En course                   | Suivi carte + statut, le chauffeur termine depuis son tableau de bord |
| 6. Terminée + note             | Confirmation mobile money par le passager si besoin, notation  |

Côté chauffeur (`/chauffeur`) : liste temps réel des courses en attente
(son du navigateur à l'arrivée d'une nouvelle demande), "ACCEPTER" (premier
arrivé premier servi), "DÉMARRER", "TERMINER", partage GPS automatique tant
que le véhicule est "en ligne".

## ⚠️ Sécurité

Les clés `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` sont
publiques et protégées par les policies RLS — ne jamais exposer la
`service_role key` côté client ou sur GitHub.
