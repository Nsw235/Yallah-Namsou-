'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type LatLng = { lat: number; lng: number };
export type MapPin = {
  position: LatLng;
  emoji?: string;
  color?: string;
  /** Affiche une étiquette passager (avatar initiales + nom + distance) au lieu d'un simple emoji. */
  passenger?: {
    initials: string;
    name: string;
    distanceKm: number;
    /** Course la plus proche : contour vert + étiquette pleine opacité. */
    highlight?: boolean;
  };
  /** Affiche un vrai modèle 3D (.glb) à la place de l'emoji — ex: un autre chauffeur disponible. */
  car3d?: { modelUrl?: string; heading?: number };
  /** Petit point coloré (pulsant en option) — léger, pour afficher beaucoup de véhicules
   *  d'un coup (ex: carte de supervision flotte côté admin) sans charger un modèle 3D par pin. */
  dot?: { color: string; pulse?: boolean; label?: string };
  /** Icône véhicule à plat (PNG) — vue de dessus/profil, sans les coûts et risques
   *  d'affichage d'un modèle 3D (chargement GLB, éclairage, échelle). Utilisée pour les
   *  vues avec plusieurs véhicules à la fois (flotte admin, véhicules dispo passager). */
  icon?: { url: string; ringColor?: string; label?: string };
  /** Appelé au tap sur ce pin (ex: ouvrir la fiche de la course correspondante). */
  onClick?: () => void;
};
/** Prochaine manœuvre du guidage virage par virage (voir onNavigationUpdate). */
export type NavigationStep = {
  instruction: string;
  type: string;
  modifier?: string;
  distanceMeters: number;
};

// Centre par défaut : N'Djamena, Tchad.
const DEFAULT_CENTER: LatLng = { lat: 12.1348, lng: 15.0557 };

// Distance à vol d'oiseau (km) — utilisée uniquement pour estimer une durée
// de secours quand l'API Directions est indisponible (token manquant, hors-ligne…).
function haversineKmLocal(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

// Style Mapbox personnalisé (créé dans Mapbox Studio par l'utilisateur).
// Si ce style est basé sur "Standard" (v3, avec imports), les fonctionnalités
// natives (slots, config 3D) restent utilisables — sinon elles sont ignorées
// proprement (voir `hasBasemapImport` plus bas).
const MAP_STYLE = 'mapbox://styles/devnos/cmsgphos4009301sa1rhm9gg1';

// Modèle 3D par défaut du véhicule (place ton .glb dans /public/models/).
const DEFAULT_CAR_MODEL_URL = '/models/berline.glb';

/** Handle impératif exposé via ref : permet de recentrer la caméra sans
 *  remonter le composant (évite de perdre/recréer le contexte WebGL). */
export type RealMapHandle = {
  /** Recentre la caméra sur les points actuellement affichés (pins, chauffeur, pickup/dropoff). */
  recenter: () => void;
};

/**
 * Carte vecteur Mapbox GL JS : rendu fluide, trafic en temps réel,
 * itinéraire "driving-traffic" (tient compte des embouteillages),
 * marqueurs animés en continu (position interpolée, pas de saut).
 */
const RealMap = forwardRef<RealMapHandle, {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  /** Position live du chauffeur (GPS). Si fournie, sert de point de départ
   *  pour l'itinéraire (à la place de `pickup`) et s'affiche comme un
   *  marqueur véhicule dédié, animé en continu. */
  driverPosition?: LatLng | null;
  showRoute?: boolean;
  routeColor?: string;
  /** Active un tracé "vivant" : glow doux sous la ligne + chevrons lumineux
   *  qui défilent en continu vers la destination, au lieu d'un simple trait
   *  statique. Prévu pour les vues caméra inclinées (trajet en cours). */
  routeFlow?: boolean;
  pins?: MapPin[];
  /** Inclinaison de la caméra (0 = vue du dessus, ~55-60 = look isométrique 3D). */
  pitch?: number;
  /** Active les bâtiments 3D natifs du style Mapbox Standard ("ville miniature"). */
  buildings3d?: boolean;
  /** Affiche un vrai modèle 3D (.glb) pour le véhicule au lieu de l'emoji 🚗. */
  use3dCar?: boolean;
  /** Chemin vers le modèle .glb (dans /public), ex: "/models/berline.glb". */
  carModelUrl?: string;
  /** Orientation du véhicule en degrés (0-360). */
  carHeading?: number;
  /** Appelé à chaque recalcul d'itinéraire avec la prochaine manœuvre (guidage virage par virage), ou null si pas d'itinéraire. */
  onNavigationUpdate?: (step: NavigationStep | null) => void;
  /** Appelé à chaque recalcul d'itinéraire avec la distance/durée TOTALE (trafic pris en compte),
   *  ou null si pas d'itinéraire. Sert par ex. à afficher "chauffeur arrive dans X min" côté passager. */
  onRouteInfo?: (info: { distanceMeters: number; durationSeconds: number } | null) => void;
  /** Niveau de zoom appliqué quand il n'y a qu'un seul point à centrer (ex: juste
   *  la position du chauffeur, personne à proximité). Par défaut 15 (rue). Passer
   *  une valeur plus basse (ex: 12.5) pour une vue d'ensemble de la ville. */
  overviewZoom?: number;
}>(function RealMap({
  pickup,
  dropoff,
  driverPosition,
  showRoute = false,
  routeColor = '#e8c9a8',
  routeFlow = false,
  pins = [],
  pitch = 0,
  buildings3d = false,
  use3dCar = false,
  carModelUrl = DEFAULT_CAR_MODEL_URL,
  carHeading = 90,
  onNavigationUpdate,
  onRouteInfo,
  overviewZoom = 15,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  // Vrai dès que `map.remove()` a été appelé (démontage). Les autres effects
  // partagent cette même instance `map` et peuvent tenter d'y accéder (getLayer,
  // removeLayer...) dans LEUR propre cleanup, exécuté au même moment que celui-ci
  // — sans garde, ça plante avec "this.style is undefined" si la carte a déjà été
  // détruite en premier (l'ordre d'exécution des cleanups entre effects n'est pas
  // quelque chose sur lequel on doit compter ici).
  const mapRemovedRef = useRef(false);
  const markersRef = useRef<Record<string, any>>({});
  // Handlers de clic par marqueur — dans une ref pour toujours appeler la
  // version la plus récente (props/callbacks) même si l'élément DOM du
  // marqueur, lui, n'est créé qu'une seule fois et réutilisé ensuite.
  const markerClickHandlersRef = useRef<Record<string, (() => void) | undefined>>({});
  const animFrames = useRef<Record<string, number>>({});
  // Le style personnalisé du projet n'est pas un style "Standard" (v3) : il
  // n'a pas d'import "basemap" et ne supporte donc PAS l'option `slot` sur
  // les layers. `map.addLayer({..., slot: 'top'})` sur un tel style lève une
  // EXCEPTION SYNCHRONE (pas un simple événement 'error' asynchrone) — non
  // interceptée, elle remonte jusqu'à React et fait planter toute l'app
  // ("Application error: a client-side exception has occurred"), typiquement
  // dès qu'un véhicule 3D (dispo, ou chauffeur assigné après réservation)
  // apparaît sur la carte. Ce ref, rempli une fois le style chargé, permet
  // aux autres effets (modèles 3D) de savoir s'il est sûr d'utiliser `slot`.
  const hasBasemapImportRef = useRef(false);
  // Si un modèle .glb demandé échoue à charger (style Mapbox sans support
  // des layers 3D, fichier manquant, etc.), on retombe sur un marqueur plat
  // stylé plutôt que de laisser le véhicule invisible. Indexé par URL (et
  // non un simple booléen) pour que CHAQUE véhicule concerné bascule sur son
  // repli — le chauffeur connecté (carModelUrl) comme les pins `car3d`
  // (ex: chauffeurs disponibles autour du passager), qui n'avaient jusqu'ici
  // aucun filet de sécurité et disparaissaient silencieusement en cas
  // d'échec (voir DIAGNOSTIC.md).
  const [failedModelUrls, setFailedModelUrls] = useState<Set<string>>(new Set());
  // Bascule à `true` une fois le style de la carte réellement chargé.
  // CRITIQUE : les effets qui dessinent le tracé et les marqueurs dépendent
  // des coordonnées (pickup/dropoff/driverPosition), qui sur certains écrans
  // (ex: "chauffeur arrive") ne changent qu'une seule fois, voire jamais,
  // après le montage. Sur une connexion lente, ce changement unique peut
  // survenir AVANT que mapbox-gl ait fini de charger (import dynamique +
  // création de la carte + chargement du style prennent parfois plusieurs
  // secondes en 4G) : l'effet s'exécute alors avec `mapRef.current` encore
  // `null`, ne dessine rien, et — comme les refs ne déclenchent pas de
  // nouveau rendu — ne serait jamais réexécuté. Ce state, lui, force un
  // nouveau rendu dès que la carte est réellement prête, garantissant que
  // le tracé et les marqueurs finissent toujours par s'afficher.
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    setFailedModelUrls((s) => {
      if (!s.has(carModelUrl)) return s;
      const next = new Set(s);
      next.delete(carModelUrl);
      return next;
    });
  }, [carModelUrl]);
  const effectiveUse3dCar = use3dCar && !failedModelUrls.has(carModelUrl);

  // Initialisation (une seule fois).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!containerRef.current || mapRef.current) return;
      const mapboxgl = (await import('mapbox-gl')).default;
      if (cancelled) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: 13,
        attributionControl: true,
        pitch,
        maxPitch: 85, // Mapbox limite à 60° par défaut ; on l'augmente pour permettre une vue plus inclinée (voir le ciel).
        bearing: buildings3d ? -17 : 0,
        antialias: true,
      });
      mapRef.current = map;

      // Avec un style Standard (v3, "imports"), on attend 'style.load' plutôt
      // que 'load' pour être sûr que le basemap + sa config soient prêts.
      // Ça marche aussi sans problème avec un style classique.
      map.on('style.load', () => {
        const styleJson = map.getStyle?.();
        const hasBasemapImport = Array.isArray(styleJson?.imports) && styleJson.imports.some((i: any) => i.id === 'basemap');
        hasBasemapImportRef.current = hasBasemapImport;

        // Source/couche du tracé d'itinéraire — créées EN PREMIER et
        // isolées dans leur propre try/catch : si l'ajout d'une autre
        // couche plus bas (trafic, etc.) échoue, ça ne doit jamais
        // empêcher le tracé lui-même d'exister. Avant ce correctif, une
        // erreur sur la couche trafic interrompait tout le callback et
        // 'route'/'route-line' n'étaient jamais créées, donc le tracé ne
        // s'affichait jamais côté passager, sans aucune erreur visible.
        try {
          map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          // Halo doux sous le tracé : donne de l'épaisseur/lumière au trait
          // sans dépendre d'un style Mapbox particulier (line-blur marche
          // sur tous les styles vecteur classiques ou Standard).
          map.addLayer({
            id: 'route-line-glow',
            type: 'line',
            source: 'route',
            ...(hasBasemapImport ? { slot: 'top' } : {}),
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-width': 20, 'line-color': routeColor, 'line-opacity': 0.28, 'line-blur': 7 },
          });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            ...(hasBasemapImport ? { slot: 'top' } : {}),
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-width': 5.5, 'line-color': routeColor, 'line-opacity': 0.95 },
          });
          // Chevrons lumineux qui défilent vers la destination (voir l'effect
          // d'animation dédié plus bas) — n'existe que quand `routeFlow` est
          // activé, mais la couche est toujours créée pour simplifier le
          // toggle (opacité à 0 sinon).
          map.addLayer({
            id: 'route-line-flow',
            type: 'line',
            source: 'route',
            ...(hasBasemapImport ? { slot: 'top' } : {}),
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-width': 4.5,
              'line-color': '#f7e6d4',
              'line-opacity': routeFlow ? 0.95 : 0,
              'line-dasharray': [0, 4, 3],
            },
          });
        } catch {
          // Au pire le tracé ne s'affiche pas, mais le reste de la carte
          // (pins, position chauffeur, etc.) continue de fonctionner.
        }

        // Calque trafic live officiel Mapbox (congestion en temps réel).
        // `slot: 'top'` n'existe que sur les styles Standard (v3) : on ne
        // l'ajoute que si le style personnalisé en dispose, sinon Mapbox GL
        // rejetterait la couche.
        try {
          map.addSource('mapbox-traffic', {
            type: 'vector',
            url: 'mapbox://mapbox.mapbox-traffic-v1',
          });
          map.addLayer({
            id: 'traffic',
            type: 'line',
            source: 'mapbox-traffic',
            'source-layer': 'traffic',
            ...(hasBasemapImport ? { slot: 'top' } : {}),
            paint: {
              'line-width': 2.2,
              'line-color': [
                'match',
                ['get', 'congestion'],
                'low', '#7fbf94',
                'moderate', '#e8c9a8',
                'heavy', '#d97b6a',
                'severe', '#c0392b',
                'rgba(0,0,0,0)',
              ],
            },
          });
        } catch {
          // Le trafic est décoratif — son absence ne doit jamais bloquer
          // le reste (tracé, pins, position chauffeur).
        }

        // Le toggle 3D natif ne s'applique qu'aux styles Standard. Si le style
        // personnalisé est un style classique, les bâtiments 3D (s'il y en a)
        // restent tels qu'ils ont été configurés dans Mapbox Studio.
        if (hasBasemapImport) {
          map.setConfigProperty('basemap', 'show3dObjects', buildings3d);
        }

        // Pas de map.setFog() ici : le style personnalisé (Mapbox Studio,
        // panneau "Atmosphere") définit déjà sa propre ambiance de ciel/brume.
        // La forcer ici en JS écraserait ce réglage à chaque chargement.

        // Déclenche le re-rendu qui permet aux effets tracé/marqueurs de
        // (re)tourner maintenant que la carte est prête — voir le
        // commentaire sur `mapReady` plus haut.
        setMapReady(true);
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      Object.values(animFrames.current).forEach((id) => cancelAnimationFrame(id));
      mapRemovedRef.current = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Anime les chevrons du tracé "vivant" (voir routeFlow) : on fait défiler
  // un motif de tirets vers l'avant en boucle, ce qui donne l'impression
  // d'un flux lumineux continu vers la destination plutôt qu'une ligne
  // statique. On (re)lit `mapRef.current` à chaque tick plutôt qu'une fois
  // au montage de l'effect, car la carte peut ne pas encore exister quand
  // `routeFlow` passe à true juste après un changement d'écran.
  useEffect(() => {
    const dashSteps = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5],
    ];
    let step = 0;
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || mapRemovedRef.current) return;
      try {
        if (!map.getLayer('route-line-flow')) return;
        map.setPaintProperty('route-line-flow', 'line-opacity', routeFlow ? 0.95 : 0);
        if (routeFlow) {
          step = (step + 1) % dashSteps.length;
          map.setPaintProperty('route-line-flow', 'line-dasharray', dashSteps[step]);
        }
      } catch {
        // La couche peut ne pas exister si le style est encore en train de
        // charger — on retentera au prochain tick, rien de bloquant.
      }
    }, 60);
    return () => window.clearInterval(id);
  }, [routeFlow]);

  // Force Mapbox GL à recalculer/redimensionner son canvas WebGL dès que son
  // conteneur change de taille (ex: clavier virtuel qui s'ouvre sur mobile —
  // voir ViewportHeightFix.tsx : --app-vh rétrécit alors la hauteur de
  // l'appli). `trackResize` (activé par défaut sur Mapbox GL) n'écoute que
  // l'évènement `resize` de la fenêtre, qui ne se déclenche PAS quand seul le
  // `visualViewport` change (cas du clavier iOS) : sans cet observer, le
  // canvas garde son ancienne taille interne alors que son élément DOM a
  // rétréci → rendu noir/déformé. `requestAnimationFrame` évite les erreurs
  // "ResizeObserver loop" et laisse le layout se stabiliser avant de resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        mapRef.current?.resize();
      });
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Recentre la caméra sur les points actuellement affichés (pickup, dropoff,
  // chauffeur, pins). Factorisé ici pour être appelable à la fois automatiquement
  // (quand les positions changent) et manuellement (bouton "Recentrer" via ref),
  // sans jamais remonter/recréer la carte (ce qui plantait le contexte WebGL).
  const recenterView = async () => {
    const map = mapRef.current;
    if (!map) return;

    const coords: [number, number][] = [];
    if (pickup) coords.push([pickup.lng, pickup.lat]);
    if (dropoff) coords.push([dropoff.lng, dropoff.lat]);
    if (driverPosition) coords.push([driverPosition.lng, driverPosition.lat]);
    pins.forEach((p) => coords.push([p.position.lng, p.position.lat]));

    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: overviewZoom, pitch, bearing: map.getBearing(), duration: 800 });
    } else if (coords.length > 1) {
      const mapboxgl = (await import('mapbox-gl')).default;
      const bounds = coords.reduce(
        (b, c) => b.extend(c as any),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      // IMPORTANT : fitBounds() remet pitch/bearing à 0 par défaut si on ne
      // les précise pas ici — ça écrasait la vue inclinée (ciel visible) à
      // chaque recentrage sur plusieurs points (ex: chauffeur + pickup).
      map.fitBounds(bounds, { padding: 60, duration: 800, pitch, bearing: map.getBearing() });
    }
  };

  useImperativeHandle(ref, () => ({ recenter: recenterView }));

  // Marqueurs pickup / dropoff + pins (chauffeur, etc.), avec déplacement animé.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    async function render() {
      const mapboxgl = (await import('mapbox-gl')).default;
      const wanted: Record<string, { pos: LatLng; el: () => HTMLElement; onClick?: () => void }> = {};

      if (pickup) {
        wanted['pickup'] = { pos: pickup, el: () => dropEl('#e8c9a8') };
      }
      if (dropoff) {
        wanted['dropoff'] = { pos: dropoff, el: () => dropEl('#d97b6a') };
      }
      if (driverPosition && !effectiveUse3dCar) {
        wanted['driver'] = { pos: driverPosition, el: () => carIconEl() };
      }
      pins.forEach((p, i) => {
        if (p.car3d) {
          const url = p.car3d.modelUrl ?? DEFAULT_CAR_MODEL_URL;
          if (!failedModelUrls.has(url)) return; // rendu en modèle 3D réel, pas en marqueur DOM plat
          // Modèle 3D indisponible pour cette URL : repli sur l'icône stylée
          // plutôt que de laisser ce véhicule invisible.
          wanted[`pin-${i}`] = { pos: p.position, el: () => carIconEl(p.car3d?.heading), onClick: p.onClick };
          return;
        }
        wanted[`pin-${i}`] = {
          pos: p.position,
          el: () => (p.icon ? iconEl(p.icon) : p.passenger ? passengerEl(p.passenger) : p.dot ? dotEl(p.dot) : p.emoji ? emojiEl(p.emoji) : carIconEl()),
          onClick: p.onClick,
        };
      });

      // Retire les marqueurs qui ne sont plus utilisés.
      Object.keys(markersRef.current).forEach((key) => {
        if (!wanted[key]) {
          markersRef.current[key].remove();
          delete markersRef.current[key];
          delete markerClickHandlersRef.current[key];
        }
      });

      Object.entries(wanted).forEach(([key, { pos, el, onClick }]) => {
        // Toujours la dernière version du callback, y compris pour un
        // marqueur dont l'élément DOM existe déjà (voir écouteur ci-dessous).
        markerClickHandlersRef.current[key] = onClick;

        const existing = markersRef.current[key];
        if (!existing) {
          const element = el();
          if (onClick) {
            element.style.cursor = 'pointer';
            element.addEventListener('click', (e) => {
              e.stopPropagation();
              markerClickHandlersRef.current[key]?.();
            });
          }
          const marker = new mapboxgl.Marker({ element }).setLngLat([pos.lng, pos.lat]).addTo(map);
          markersRef.current[key] = marker;
          return;
        }
        // Anime la transition vers la nouvelle position plutôt qu'un saut brut :
        // rend le déplacement du véhicule "vivant" plutôt que téléporté.
        const from = existing.getLngLat();
        const to = { lng: pos.lng, lat: pos.lat };
        if (from.lng === to.lng && from.lat === to.lat) return;
        if (animFrames.current[key]) cancelAnimationFrame(animFrames.current[key]);
        const duration = 900;
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          existing.setLngLat([from.lng + (to.lng - from.lng) * ease, from.lat + (to.lat - from.lat) * ease]);
          if (t < 1) animFrames.current[key] = requestAnimationFrame(step);
        };
        animFrames.current[key] = requestAnimationFrame(step);
      });

      await recenterView();
    }

    if (map.isStyleLoaded()) render();
    else map.once('load', render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins), effectiveUse3dCar, overviewZoom, Array.from(failedModelUrls).sort().join(','), mapReady]);

  // Modèles 3D réels (.glb) : le véhicule du chauffeur connecté (driverPosition,
  // si use3dCar) + tout pin déclarant `car3d` (ex: autres chauffeurs disponibles
  // autour). Chacun a sa propre source/layer Mapbox — on les recrée à chaque
  // changement de position, les sources "model" n'ayant pas d'update incrémental.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    type CarModel = { id: string; modelUrl: string; position: LatLng; heading: number };
    const cars: CarModel[] = [];
    if (effectiveUse3dCar && driverPosition) {
      cars.push({ id: 'car-3d-ego', modelUrl: carModelUrl, position: driverPosition, heading: carHeading });
    }
    pins.forEach((p, i) => {
      if (p.car3d) {
        cars.push({
          id: `car-3d-pin-${i}`,
          modelUrl: p.car3d.modelUrl ?? DEFAULT_CAR_MODEL_URL,
          position: p.position,
          heading: p.car3d.heading ?? 90,
        });
      }
    });

    const activeIds = new Set(cars.map((c) => c.id));

    // Si un .glb est manquant/invalide, Mapbox émet un événement 'error'
    // plutôt que de planter : on l'écoute pour retomber sur l'icône stylée
    // du véhicule concerné (identifié par son URL de modèle) au lieu de le
    // laisser invisible.
    function onMapError(e: any) {
      const msg = e?.error?.message;
      if (typeof msg !== 'string') return;
      const failed = cars.find((c) => msg.includes(c.modelUrl));
      if (failed) {
        setFailedModelUrls((s) => (s.has(failed.modelUrl) ? s : new Set(s).add(failed.modelUrl)));
      }
    }
    map.on('error', onMapError);

    function upsertCarModels() {
      cars.forEach((car) => {
        const sourceId = `${car.id}-source`;
        const layerId = `${car.id}-layer`;
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);

          map.addSource(sourceId, {
            type: 'model',
            models: {
              car: {
                // Résolue en URL absolue : la source 'model' est chargée par un
                // worker Mapbox GL, dont le contexte de résolution d'URL relative
                // peut différer de celui du document.
                uri: new URL(car.modelUrl, window.location.origin).toString(),
                position: [car.position.lng, car.position.lat],
                orientation: [0, 0, car.heading],
              },
            },
          } as any);

          map.addLayer({
            id: layerId,
            type: 'model',
            source: sourceId,
            // `slot` n'existe que sur les styles Standard (v3, avec import
            // "basemap") — l'ajouter sur un style classique fait échouer
            // addLayer(). On ne le passe donc que si le style chargé le
            // supporte réellement (voir hasBasemapImportRef ci-dessus).
            ...(hasBasemapImportRef.current ? { slot: 'top' } : {}),
            paint: {
              'model-scale': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, ['literal', [0.5, 0.5, 0.5]],
                18, ['literal', [2.5, 2.5, 2.5]],
              ],
            },
          } as any);
        } catch (err) {
          // Filet de sécurité : un style/version Mapbox qui rejette ce layer
          // (slot, type 'model' non supporté, etc.) peut lever une exception
          // SYNCHRONE plutôt que d'émettre l'événement 'error' du style. Sans
          // ce try/catch, cette exception remontait jusqu'à React et faisait
          // planter toute l'application. On se contente de logguer et de
          // basculer CE véhicule (ego ou pin) sur son repli icône plutôt que
          // de crasher — plus aucun véhicule ne reste invisible en silence.
          // eslint-disable-next-line no-console
          console.warn('[RealMap] Échec ajout modèle 3D, repli icône :', err);
          setFailedModelUrls((s) => (s.has(car.modelUrl) ? s : new Set(s).add(car.modelUrl)));
        }
      });
    }

    if (map.isStyleLoaded()) upsertCarModels();
    else map.once('style.load', upsertCarModels);

    return () => {
      // La carte a déjà été détruite par l'autre effect (démontage de RealMap) :
      // toute méthode Mapbox (getLayer, getSource...) planterait ici avec
      // "this.style is undefined" puisque le style interne n'existe plus.
      // Rien à nettoyer dans ce cas, la carte entière disparaît de toute façon.
      if (mapRemovedRef.current) return;
      map.off('error', onMapError);
      // Nettoie uniquement les modèles gérés par ce rendu (via activeIds),
      // pour ne pas toucher aux sources/layers d'un autre appel en cours.
      try {
        activeIds.forEach((id) => {
          if (map.getLayer(`${id}-layer`)) map.removeLayer(`${id}-layer`);
          if (map.getSource(`${id}-source`)) map.removeSource(`${id}-source`);
        });
      } catch (err) {
        // Filet de sécurité supplémentaire : même garde protégée, Mapbox peut
        // lever une exception synchrone en pleine phase de démontage React —
        // on logue plutôt que de planter toute l'app (même principe que le
        // try/catch de upsertCarModels ci-dessus).
        // eslint-disable-next-line no-console
        console.warn('[RealMap] Échec nettoyage modèles 3D au démontage :', err);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUse3dCar, carModelUrl, carHeading, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins), mapReady]);

  // Itinéraire réel tenant compte du trafic (Mapbox Directions, profil driving-traffic).
  // Point de départ : la position live du chauffeur si disponible (suivi temps réel),
  // sinon le point de prise en charge (comportement historique, ex. écrans passager).
  // `steps=true&language=fr` permet aussi de calculer la prochaine manœuvre
  // (guidage virage par virage) via `onNavigationUpdate`.
  useEffect(() => {
    const map = mapRef.current;
    const routeStart = driverPosition ?? pickup;
    if (!map || !showRoute || !routeStart || !dropoff) {
      onNavigationUpdate?.(null);
      onRouteInfo?.(null);
      return;
    }

    // Filet de sécurité : la source/les calques auraient dû être créés dans
    // 'style.load', mais si ce callback a échoué avant de les ajouter (voir
    // plus haut) ou n'a pas encore eu lieu, on les crée ici plutôt que de
    // silencieusement abandonner le tracé — utilisé aussi bien pour
    // l'itinéraire réel que pour le trait de secours ci-dessous.
    function ensureRouteLayers() {
      let src = map!.getSource('route');
      if (!src) {
        try {
          map!.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map!.addLayer({
            id: 'route-line-glow',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-width': 20, 'line-color': routeColor, 'line-opacity': 0.28, 'line-blur': 7 },
          });
          map!.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-width': 5.5, 'line-color': routeColor, 'line-opacity': 0.95 },
          });
          map!.addLayer({
            id: 'route-line-flow',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-width': 4.5,
              'line-color': '#f7e6d4',
              'line-opacity': routeFlow ? 0.95 : 0,
              'line-dasharray': [0, 4, 3],
            },
          });
          src = map!.getSource('route');
        } catch {
          src = undefined;
        }
      }
      return src;
    }

    // Trait direct départ → arrivée : utilisé chaque fois que l'itinéraire
    // réel (Mapbox Directions) n'est pas disponible, pour que le passager
    // voie TOUJOURS un tracé plutôt qu'une carte vide (ex: token Mapbox
    // manquant, API indisponible, hors-ligne, réponse sans géométrie…).
    function drawFallbackLine() {
      if (mapRemovedRef.current) return;
      const src = ensureRouteLayers();
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [routeStart!.lng, routeStart!.lat],
              [dropoff!.lng, dropoff!.lat],
            ],
          },
        });
      }
      // Estimation grossière (vitesse moyenne 28 km/h en ville) pour que
      // l'ETA affichée à l'écran ne reste jamais bloquée sur "…".
      const distanceMeters = haversineKmLocal(routeStart!, dropoff!) * 1000;
      const durationSeconds = (distanceMeters / 1000 / 28) * 3600;
      onRouteInfo?.({ distanceMeters, durationSeconds });
      onNavigationUpdate?.(null);
    }

    async function drawRoute() {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${routeStart!.lng},${routeStart!.lat};${dropoff!.lng},${dropoff!.lat}?geometries=geojson&overview=full&steps=true&language=fr&access_token=${MAPBOX_TOKEN}`;
      try {
        if (!MAPBOX_TOKEN) {
          // Pas de token configuré : inutile d'appeler l'API, on trace
          // directement le trait de secours.
          drawFallbackLine();
          return;
        }
        const res = await fetch(url);
        const data = await res.json();
        const geometry = data?.routes?.[0]?.geometry;
        if (!res.ok || !geometry) {
          drawFallbackLine();
          return;
        }
        // La carte a pu être détruite (changement d'écran) pendant l'attente
        // de la réponse réseau ci-dessus : `map.getSource` planterait sinon.
        if (mapRemovedRef.current) return;
        const src = ensureRouteLayers();
        if (src) src.setData({ type: 'Feature', properties: {}, geometry });

        const totalDistance = data?.routes?.[0]?.distance;
        const totalDuration = data?.routes?.[0]?.duration;
        if (typeof totalDistance === 'number' && typeof totalDuration === 'number') {
          onRouteInfo?.({ distanceMeters: totalDistance, durationSeconds: totalDuration });
        } else {
          onRouteInfo?.(null);
        }

        // Étapes de l'itinéraire recalculé depuis la position actuelle :
        // steps[0] = segment en cours (jusqu'à la prochaine manœuvre),
        // steps[1] = la manœuvre à venir elle-même (instruction à afficher).
        const routeSteps = data?.routes?.[0]?.legs?.[0]?.steps as
          | { distance: number; maneuver: { instruction: string; type: string; modifier?: string } }[]
          | undefined;
        if (routeSteps && routeSteps.length >= 2) {
          onNavigationUpdate?.({
            instruction: routeSteps[1].maneuver.instruction,
            type: routeSteps[1].maneuver.type,
            modifier: routeSteps[1].maneuver.modifier,
            distanceMeters: routeSteps[0].distance,
          });
        } else if (routeSteps && routeSteps.length === 1) {
          onNavigationUpdate?.({ instruction: 'Vous êtes arrivé à destination', type: 'arrive', distanceMeters: 0 });
        } else {
          onNavigationUpdate?.(null);
        }
      } catch {
        // Hors-ligne ou erreur réseau : trait direct départ → arrivée en secours.
        drawFallbackLine();
      }
    }

    if (map.isStyleLoaded()) drawRoute();
    else map.once('load', drawRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPosition?.lat, driverPosition?.lng, showRoute, mapReady]);

  return <div ref={containerRef} className="real-map" />;
});

RealMap.displayName = 'RealMap';

export default RealMap;

function dropEl(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '16px';
  el.style.height = '16px';
  el.style.background = color;
  el.style.borderRadius = '50% 50% 50% 0';
  el.style.transform = 'rotate(-45deg)';
  el.style.boxShadow = `0 0 8px ${color}`;
  el.style.border = '2px solid rgba(0,0,0,0.45)';
  return el;
}

function passengerEl(p: { initials: string; name: string; distanceKm: number; highlight?: boolean }): HTMLElement {
  const accent = p.highlight ? '#6fae4a' : '#4a3626';
  const textColor = p.highlight ? '#e8c9a8' : '#c9bba8';

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '2px';
  wrap.style.cursor = 'pointer';

  const tag = document.createElement('div');
  tag.style.background = '#1c1108';
  tag.style.border = `${p.highlight ? 2 : 1}px solid ${accent}`;
  tag.style.borderRadius = '10px';
  tag.style.padding = '3px 7px';
  tag.style.fontSize = '10px';
  tag.style.fontWeight = '500';
  tag.style.color = textColor;
  tag.style.whiteSpace = 'nowrap';
  tag.textContent = `${p.name} · ${p.distanceKm.toFixed(1)} km`;

  const avatarBox = document.createElement('div');
  avatarBox.style.position = 'relative';
  const size = p.highlight ? 28 : 24;
  avatarBox.style.width = `${size}px`;
  avatarBox.style.height = `${size}px`;

  if (p.highlight) {
    const pulse = document.createElement('div');
    pulse.className = 'nearest-pin-pulse';
    pulse.style.width = `${size}px`;
    pulse.style.height = `${size}px`;
    avatarBox.appendChild(pulse);
  }

  const avatar = document.createElement('div');
  avatar.style.position = 'relative';
  avatar.style.width = `${size}px`;
  avatar.style.height = `${size}px`;
  avatar.style.borderRadius = '50%';
  avatar.style.background = '#3b2716';
  avatar.style.border = `${p.highlight ? 2 : 1}px solid ${accent}`;
  avatar.style.display = 'flex';
  avatar.style.alignItems = 'center';
  avatar.style.justifyContent = 'center';
  avatar.style.color = textColor;
  avatar.style.fontSize = p.highlight ? '10px' : '9px';
  avatar.style.fontWeight = '500';
  avatar.textContent = p.initials;
  avatarBox.appendChild(avatar);

  wrap.appendChild(tag);
  wrap.appendChild(avatarBox);
  return wrap;
}

function emojiEl(emoji: string): HTMLElement {
  const el = document.createElement('div');
  el.style.fontSize = '26px';
  el.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.6))';
  el.textContent = emoji;
  return el;
}

// Repli stylé pour un véhicule (chauffeur connecté ou pin `car3d`) quand son
// modèle 3D .glb ne peut pas être chargé — badge rond cuivré avec un
// pictogramme de voiture, plutôt que l'émoji 🚗 brut du système.
function carIconEl(heading?: number): HTMLElement {
  const outer = document.createElement('div');
  outer.style.position = 'relative';
  outer.style.width = '40px';
  outer.style.height = '40px';
  outer.style.display = 'flex';
  outer.style.alignItems = 'center';
  outer.style.justifyContent = 'center';

  const ring = document.createElement('div');
  ring.style.position = 'absolute';
  ring.style.inset = '0';
  ring.style.borderRadius = '50%';
  ring.style.background = '#e8944a';
  ring.style.opacity = '0.3';
  ring.style.animation = 'yn-dot-pulse 1.8s ease-out infinite';
  outer.appendChild(ring);

  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.width = '30px';
  wrap.style.height = '30px';
  wrap.style.borderRadius = '50%';
  wrap.style.background = '#241a13';
  wrap.style.border = '1.5px solid #e8944a';
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  wrap.style.boxShadow = '0 3px 8px rgba(0,0,0,0.5)';
  if (heading != null) wrap.style.transform = `rotate(${heading}deg)`;
  wrap.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f7d199" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l1.5 -4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />' +
    '<rect x="2.5" y="11" width="19" height="6" rx="1.5" />' +
    '<circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></svg>';
  outer.appendChild(wrap);

  // Réutilise le keyframe 'yn-dot-pulse' (voir dotEl) : un seul <style> injecté
  // pour toute la carte, peu importe combien de marqueurs pulsent.
  if (!document.getElementById('yn-dot-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'yn-dot-pulse-style';
    style.textContent =
      '@keyframes yn-dot-pulse{0%{transform:scale(1);opacity:.45}100%{transform:scale(2.6);opacity:0}}';
    document.head.appendChild(style);
  }

  return outer;
}

function dotEl(dot: { color: string; pulse?: boolean; label?: string }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.width = '14px';
  wrap.style.height = '14px';

  if (dot.pulse) {
    const ring = document.createElement('div');
    ring.style.position = 'absolute';
    ring.style.inset = '0';
    ring.style.borderRadius = '50%';
    ring.style.background = dot.color;
    ring.style.opacity = '0.35';
    ring.style.animation = 'yn-dot-pulse 1.8s ease-out infinite';
    wrap.appendChild(ring);
  }

  const core = document.createElement('div');
  core.style.position = 'absolute';
  core.style.inset = '2px';
  core.style.borderRadius = '50%';
  core.style.background = dot.color;
  core.style.border = '2px solid rgba(10,11,13,0.9)';
  core.style.boxShadow = `0 0 6px ${dot.color}`;
  wrap.appendChild(core);

  if (dot.label) {
    const tag = document.createElement('div');
    tag.textContent = dot.label;
    tag.style.position = 'absolute';
    tag.style.top = '16px';
    tag.style.left = '50%';
    tag.style.transform = 'translateX(-50%)';
    tag.style.fontSize = '9px';
    tag.style.fontWeight = '700';
    tag.style.color = '#f2f3f5';
    tag.style.background = 'rgba(10,11,13,0.75)';
    tag.style.padding = '1px 5px';
    tag.style.borderRadius = '6px';
    tag.style.whiteSpace = 'nowrap';
    wrap.appendChild(tag);
  }

  if (!document.getElementById('yn-dot-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'yn-dot-pulse-style';
    style.textContent =
      '@keyframes yn-dot-pulse{0%{transform:scale(1);opacity:.45}100%{transform:scale(2.6);opacity:0}}';
    document.head.appendChild(style);
  }

  return wrap;
}

function iconEl(icon: { url: string; ringColor?: string; label?: string }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.width = '38px';
  wrap.style.height = '38px';
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';

  const badge = document.createElement('div');
  badge.style.width = '36px';
  badge.style.height = '36px';
  badge.style.borderRadius = '50%';
  badge.style.background = 'rgba(20,16,12,0.92)';
  badge.style.border = `2px solid ${icon.ringColor ?? '#a97a5b'}`;
  badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.45)';
  badge.style.display = 'flex';
  badge.style.alignItems = 'center';
  badge.style.justifyContent = 'center';
  badge.style.overflow = 'hidden';

  const img = document.createElement('img');
  img.src = icon.url;
  img.alt = '';
  img.style.width = '86%';
  img.style.height = '86%';
  img.style.objectFit = 'contain';
  badge.appendChild(img);
  wrap.appendChild(badge);

  if (icon.label) {
    const tag = document.createElement('div');
    tag.textContent = icon.label;
    tag.style.position = 'absolute';
    tag.style.top = '40px';
    tag.style.left = '50%';
    tag.style.transform = 'translateX(-50%)';
    tag.style.fontSize = '9px';
    tag.style.fontWeight = '700';
    tag.style.color = '#f2f3f5';
    tag.style.background = 'rgba(10,11,13,0.8)';
    tag.style.padding = '1px 5px';
    tag.style.borderRadius = '6px';
    tag.style.whiteSpace = 'nowrap';
    wrap.appendChild(tag);
  }

  return wrap;
}
