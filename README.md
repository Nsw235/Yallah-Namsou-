# Private Fleet — App VTC (N'Djamena)

Application de réservation VTC haut de gamme (Next.js 14 + Supabase), reprenant
le flux de réservation en 6 écrans : sélection véhicule → confirmation →
recherche chauffeur → chauffeur trouvé → course en cours → notation.

Connectée à une vraie base **Supabase** (projet `moto-taxi-tchad`) :
comptes passagers/chauffeurs, courses, paiements, notations, historique.

## 1. Installer en local

```bash
npm install
cp .env.local.example .env.local   # les clés sont déjà pré-remplies dedans
npm run dev
```

Ouvrez http://localhost:3000 — créez un compte passager (email + mot de passe),
puis réservez une course.

## 2. Déployer sur GitHub

```bash
git init
git add .
git commit -m "Private Fleet — app VTC initiale"
git branch -M main
git remote add origin https://github.com/<votre-compte>/<votre-repo>.git
git push -u origin main
```

## 3. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com) → **Add New Project** → importez le repo GitHub.
2. Vercel détecte automatiquement Next.js (aucune configuration de build nécessaire).
3. Dans **Environment Variables**, ajoutez :
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://jijvqzrldnijjfhlawda.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (voir `.env.local.example`)
4. **Deploy**. C'est tout — l'app est branchée sur Supabase dès le premier déploiement.

## 4. Ce qui est déjà en place côté Supabase

Le projet Supabase `moto-taxi-tchad` contient déjà :

| Table            | Rôle                                                              |
|------------------|--------------------------------------------------------------------|
| `profiles`       | Utilisateurs (passagers ET chauffeurs), créés automatiquement à l'inscription |
| `drivers`        | Infos chauffeur (validation, note moyenne)                         |
| `vehicles`       | Véhicules par chauffeur (type, plaque, statut dispo)               |
| `pricing_rules`  | Grille tarifaire par type de véhicule (base + prix/km)              |
| `trips`          | Les courses (statut : pending → accepted → in_progress → completed)|
| `payments`       | Paiement (espèces pour l'instant), confirmé côté chauffeur          |
| `ratings`        | Notes laissées par le passager                                     |

3 chauffeurs de démonstration sont déjà seedés (1 par catégorie) :
**Moussa B.** (Berline, TC-123-AB), **Ahmat K.** (Prestige, TC-456-CD),
**Fatimé N.** (SUV, TC-789-EF).

Le dossier `supabase/migrations/` contient le SQL correspondant, au cas où
vous voudriez recréer la base sur un nouveau projet Supabase.

## 5. Fonctionnement du flux (résumé technique)

- **Écran 1-2** : choix du véhicule + prix (calculé à partir de `pricing_rules`
  et de la distance démo entre Quartier Klemat et Ave de l'Indépendance).
  À la confirmation → insertion dans `trips` (statut `pending`).
- **Écran 3** : recherche d'un véhicule `available` du bon type dans `vehicles`,
  puis assignation du chauffeur (`trips.driver_id`, statut `accepted`).
- **Écran 4** : affichage des infos chauffeur/véhicule. "Je suis prêt" →
  statut `in_progress`.
- **Écran 5** : suivi de trajet (statique pour la démo).
- **Écran 6** : "Terminer" → statut `completed` + création d'un `payments`
  (espèces, en attente de confirmation par le chauffeur). La note est
  enregistrée dans `ratings`.
- **Historique** : bouton "•••" en haut à droite → liste des courses
  `completed` du passager connecté.

## ⚠️ Notes de sécurité (important avant une mise en prod réelle)

- Les policies RLS actuelles autorisent le **passager** à mettre à jour
  librement le statut de sa propre course (y compris assigner un chauffeur).
  C'est un raccourci volontaire pour permettre la démo sans avoir de vraie
  appli chauffeur. En production, l'assignation du chauffeur et les
  changements de statut sensibles devraient passer par une **fonction
  serveur** (Edge Function / route API) utilisant la `service_role key`,
  jamais exposée côté client.
- Les clés `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` sont
  des clés **publiques**, protégées par les policies RLS : ce n'est pas un
  problème qu'elles soient visibles côté client. Ne mettez en revanche
  **jamais** la `service_role key` dans le code ou sur GitHub.
- Les comptes chauffeurs de démo utilisent un mot de passe partagé
  (`demo-Pf-2026!`), uniquement à but de test interne — à supprimer avant
  une ouverture publique.
