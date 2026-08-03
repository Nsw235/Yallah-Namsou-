# Diagnostic & implémentation — véhicules 3D, quotas Mapbox, OSRM

## 1. Architecture du projet (résumé)

Next.js 14 (App Router) + Supabase (auth, données temps réel) + Mapbox GL JS 3.7.
Toute la logique carte est centralisée dans **un seul composant partagé**,
`components/RealMap.tsx`, réutilisé par tous les écrans (`PrivateFleetApp`,
`DriverDashboard`, `AdminDashboard`, `SupervisionOverview`) :

- Une instance `mapboxgl.Map` unique par montage du composant (déjà stockée
  dans un `useRef`, donc pas recréée à chaque re-render — bon point de
  départ).
- Les véhicules 3D sont de vrais modèles `.glb` (glTF binaire), présents dans
  `public/models/` (`berline.glb`, `van.glb`, `suv.glb`), affichés via des
  **layers Mapbox de type `'model'`** (pas Three.js/Threebox — Mapbox GL a sa
  propre pipeline de rendu 3D native depuis la v3).
- Le tracé d'itinéraire était calculé via l'**API Mapbox Directions**
  (`driving-traffic`), appelée à chaque changement de `pickup`/`dropoff`/
  `driverPosition`.
- La position GPS du chauffeur est poussée en continu via
  `navigator.geolocation.watchPosition` (`lib/driver.ts`), sans throttling.

## 2. Pourquoi les véhicules 3D ne s'affichaient pas

**Cause la plus probable : les layers `type: 'model'` exigent un style Mapbox
"Standard" (v3, avec un `import` `"basemap"`), et le style personnalisé du
projet (`mapbox://styles/devnos/cms9xitev009301s80im37bm5`, créé dans Mapbox
Studio) n'en a vraisemblablement pas.**

Les preuves dans le code :

- Le composant sait déjà que cette distinction existe : il calcule
  `hasBasemapImport` (présence d'un import `"basemap"` dans le style chargé)
  et l'utilise pour conditionner `slot: 'top'` sur les layers `traffic` et
  `route-line` — *mais pas* sur le layer du modèle 3D, qui demandait
  toujours `slot: 'top'` sans vérifier que ce slot existe. Sur un style
  classique, un slot inconnu fait échouer l'ajout du layer.
- La documentation Mapbox officielle sur les modèles 3D place systématiquement
  l'exemple de layer `'model'` dans un style qui importe explicitement
  `mapbox://styles/mapbox/standard` — ce n'est pas un hasard : le pipeline de
  rendu 3D (éclairage PBR, slots de composition) fait partie du système
  "Standard", pas des styles classiques.
- Le garde-fou existant (`onMapError` → repli sur l'emoji 🚗) ne couvrait que
  **le véhicule du chauffeur connecté** (`carModelUrl`, comparé littéralement
  dans le message d'erreur). Les autres véhicules 3D (`pins[].car3d`, ex. les
  chauffeurs disponibles autour du passager) n'avaient *aucun* repli — en cas
  d'échec, ils restaient invisibles indéfiniment. Aggravant : `addLayer()`
  avec un type/slot non supporté peut lever une **exception synchrone**
  plutôt qu'émettre l'événement asynchrone `'error'` du style — dans ce cas,
  l'ancien code ne détectait même pas l'échec.

Points vérifiés et écartés :
- **CORS / chemin des fichiers** : les `.glb` sont servis depuis `public/`
  (même origine que l'app), donc pas de souci CORS. Vérifié : les 3 fichiers
  sont bien présents et sont des glTF binaires valides.
- **Échelle / orientation** : l'expression `model-scale` (0.5 → 2.5 entre
  zoom 12 et 18) et `orientation: [0, 0, heading]` sont cohérentes, ce n'est
  pas la cause.
- **Caméra/pitch** : `pitch`/`maxPitch` sont correctement propagés par les
  écrans appelants (75° côté passager/chauffeur en course).

### Correctifs appliqués (`components/RealMap.tsx`)

1. Le `slot: 'top'` du layer `'model'` n'est désormais ajouté **que si** le
   style dispose bien d'un import `"basemap"` (même garde que pour
   `traffic`/`route-line`), via une nouvelle `hasBasemapImportRef`.
2. `addSource`/`addLayer` du modèle sont enveloppés dans un `try/catch` :
   une exception synchrone (layer non supporté par le style) est maintenant
   interceptée, en plus de l'écoute de l'événement `'error'` déjà en place
   (défense en profondeur — les deux mécanismes couvrent des cas différents).
3. Le repli "emoji" ne dépend plus d'un seul booléen lié au véhicule du
   chauffeur : un `Set<string>` `failedModelUrls`, indexé par URL de modèle,
   fait basculer **tous** les véhicules utilisant une URL en échec (chauffeur
   connecté *et* pins `car3d`) sur le marqueur emoji — plus aucun véhicule
   ne reste invisible.
4. L'URL du modèle est résolue en URL absolue (`new URL(url, location.origin)`)
   avant d'être passée à la source `'model'`, par prudence défensive (les
   sources modèle sont chargées par un worker Mapbox GL qui peut avoir un
   contexte de résolution d'URL différent du document).

**Action recommandée côté Mapbox Studio** (hors code) : ouvrir le style
`devnos/cms9xitev009301s80im37bm5` et vérifier s'il est basé sur "Standard".
Si non, le migrer (bouton "Upgrade" dans Studio, ou repartir de
`mapbox://styles/mapbox/standard` et réappliquer la palette/l'ambiance
personnalisée) est la vraie correction de fond — les correctifs ci-dessus
garantissent seulement qu'en attendant (ou si l'upgrade n'est pas possible),
les véhicules restent visibles via le repli emoji plutôt que de disparaître.

## 3. Optimisation des quotas Mapbox

Deux consommateurs de quota identifiés :

1. **API Directions appelée à chaque tick GPS.** L'effet de calcul
   d'itinéraire dépendait de `driverPosition.lat/lng`, mis à jour par
   `watchPosition` (potentiellement plusieurs fois par seconde en
   `enableHighAccuracy`). Chaque micro-déplacement déclenchait un appel
   Directions complet — le poste de consommation de loin le plus important.
2. Le principe de réutilisation d'instance (`mapRef`) était déjà respecté
   partout où le composant est réellement utilisé dans l'app. Deux fichiers
   `MapView.tsx` (racine et `legacy/`) forçaient un remount complet de la
   carte via `key={mapKey}` sur le bouton "Recenter" (= nouveau "map load"
   facturé à chaque clic) — mais ces deux fichiers ne sont importés nulle
   part dans les routes actives (`app/*`), donc sans impact réel aujourd'hui.
   À corriger si/quand ce composant est réactivé (recentrer via
   `map.flyTo()`/`easeTo()` plutôt que `key`).
3. **Remarque additionnelle (hors périmètre Mapbox strict) :**
   `startSharingLocation` (`lib/driver.ts`) écrit en base à chaque callback
   `watchPosition` sans throttling — ce n'est pas un coût Mapbox, mais ça
   amplifie la fréquence des mises à jour de `driverPosition` en amont. Un
   throttle similaire (distance/temps minimum) y serait cohérent si les
   quotas Supabase Realtime deviennent un sujet.

### Garde-fous mis en place

- **Remplacement de l'API Directions par OSRM** (voir §4) : supprime
  entièrement ce poste de coût côté Mapbox.
- **Throttle sur le recalcul d'itinéraire**, indépendant du fournisseur : un
  nouvel itinéraire n'est redemandé que si le point de départ a bougé d'au
  moins **25 m** ET qu'au moins **8 s** se sont écoulées depuis le dernier
  calcul — sauf changement réel de trajet (nouveau `pickup`/`dropoff`), qui
  force un recalcul immédiat. Implémenté via un simple `useRef` (pas d'état
  React superflu, pas de re-render additionnel).

## 4. Intégration OSRM

Nouveau module **`lib/osrm.ts`** :

- `fetchOsrmRoute(start, end)` appelle
  `GET {OSRM_BASE_URL}/route/v1/driving/{lng,lat};{lng,lat}?overview=full&geometries=geojson&steps=true`
  et renvoie `{ geometry, distanceMeters, durationSeconds, steps }`.
- `OSRM_BASE_URL` est surchargeable via `NEXT_PUBLIC_OSRM_URL` (défaut :
  `https://router.project-osrm.org`, le serveur de démo public — gratuit,
  sans clé, mais sans SLA ni trafic temps réel).
- OSRM ne renvoie pas de texte d'instruction (contrairement à Mapbox
  Directions avec `language=fr`), seulement `type`/`modifier`/`name` par
  étape. `lib/osrm.ts` génère donc les instructions en français localement
  (`frInstruction`). Le vocabulaire `type`/`modifier` d'OSRM est identique à
  celui de Mapbox (Mapbox Directions dérive historiquement d'OSRM), donc
  `ManeuverIcon` côté UI fonctionne sans aucune modification.
- Dans `RealMap.tsx`, la géométrie GeoJSON renvoyée est injectée directement
  dans la source déjà existante via `map.getSource('route').setData(...)`
  (le pattern `addSource`/`addLayer` était déjà en place pour la ligne de
  route — seule l'origine des données change).
- En cas d'échec réseau, le repli existant (trait direct départ → arrivée)
  est conservé tel quel.

**Compromis assumé et documenté :** le calque `traffic` (congestion en temps
réel, coloration de la route) reste un calque **vectoriel Mapbox** distinct
(`mapbox.mapbox-traffic-v1`) — il n'a jamais dépendu de l'API Directions et
n'est pas affecté par ce changement. En revanche, l'ETA/l'itinéraire calculés
par le serveur de démo OSRM public **ne tiennent pas compte du trafic temps
réel** (contrairement à l'ancien profil `driving-traffic` de Mapbox). Si la
précision de l'ETA en heure de pointe est un enjeu produit, deux options :
- héberger sa propre instance OSRM avec des poids de trafic ajustés
  (`osrm-backend` + extrait OSM du Tchad, coût serveur mais infrastructure
  gratuite/open-source), ou
- garder Mapbox Directions *uniquement* pour le calcul final au moment de la
  confirmation de course (peu fréquent), et OSRM pour le suivi live
  (fréquent) — un compromis hybride facile à implémenter en changeant un seul
  point d'appel dans `RealMap.tsx` si besoin.

## 5. Fichiers livrés

- `components/RealMap.tsx` — correctif 3D + throttle + intégration OSRM.
- `lib/osrm.ts` — nouveau module client OSRM (fetch + instructions FR).
