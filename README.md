# Yallah-Namsou نمشوا — App passager (MVP)

Voitures uniquement (SUV / Prestige / Berline) à N'Djamena.

## Fusionner avec ton repo GitHub existant

```bash
cd yallah-namsou
git init
git add .
git commit -m "Voitures uniquement : SUV/Prestige/Berline + carte + drapeau Tchad"
git remote add origin https://github.com/Nsw235/Yallah-Namsou-.git
git branch -M main
git pull origin main --allow-unrelated-histories   # pour fusionner avec l'existant, résous les conflits si besoin
git push -u origin main
```

Si tu préfères écraser complètement ce qui existe sur le repo distant :
```bash
git push -u origin main --force
```

## Pousser ce code sur le repo GitHub existant

```bash
cd yallah-namsou
git init
git add .
git commit -m "Refonte carte + 3 catégories voiture (SUV/Prestige/Berline)"
git remote add origin https://github.com/Nsw235/Yallah-Namsou-.git
git branch -M main
git push -u origin main --force
```
(`--force` seulement si le repo distant est encore vide ou que tu veux écraser son contenu actuel — vérifie d'abord avec `git log` côté GitHub.)

## Configuration locale

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Stack de cet écran
- Next.js 14 (App Router) + TypeScript
- Carte : Leaflet + tuiles CartoDB Dark (gratuit, sans clé API)
- Données : Supabase (projet `yallah-namsou`, table `pricing_rules` avec suv/prestige/berline)

## Prochaines étapes
- Authentification téléphone + OTP (Supabase Auth)
- Positions réelles des chauffeurs (actuellement des points de démo statiques sur la carte)
- Écran chauffeur + dashboard admin
