# Moto-Taxi Tchad — App passager (MVP)

## Pousser ce code sur GitHub

```bash
# 1. Dézippe ce dossier, puis place-toi dedans
cd moto-taxi-app

# 2. Initialise git
git init
git add .
git commit -m "Premier écran : demande de course passager (Next.js + Supabase)"

# 3. Crée un repo vide sur github.com (ex: moto-taxi-tchad), sans README ni .gitignore
#    puis remplace l'URL ci-dessous par la tienne
git remote add origin https://github.com/TON-COMPTE/moto-taxi-tchad.git
git branch -M main
git push -u origin main
```

## Configuration locale

```bash
cp .env.example .env.local
```

Puis édite `.env.local` :
- `NEXT_PUBLIC_SUPABASE_URL` = `https://jijvqzrldnijjfhlawda.supabase.co` (déjà correct)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = à copier depuis Supabase → Project Settings → API → clé publique "anon"

```bash
npm install
npm run dev
```

## Connecter Vercel au repo GitHub (déploiement continu)

1. Sur vercel.com → **Add New → Project**
2. Importer le repo GitHub `moto-taxi-tchad`
3. Ajouter les mêmes variables d'environnement que ci-dessus dans Settings → Environment Variables
4. Deploy — chaque futur `git push` redéploiera automatiquement

## Ce qui est déjà branché
- Calcul de prix en temps réel (table `pricing_rules` sur Supabase)
- Insertion d'une course dans `trips` (nécessite un utilisateur connecté — l'auth par téléphone/OTP reste à implémenter)

## Prochaines étapes suggérées
- Authentification téléphone + OTP (Supabase Auth)
- Vraie géolocalisation / carte (Mapbox ou Google Maps) à la place du champ "distance manuelle"
- Écran chauffeur (accepter/refuser une course)
- Dashboard admin (carte de la flotte)
