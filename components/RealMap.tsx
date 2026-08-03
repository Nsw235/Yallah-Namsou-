'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchOsrmRoute } from '@/lib/osrm';
import { haversineKm } from '@/lib/pricing';

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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

// Style Mapbox personnalisé (créé dans Mapbox Studio par l'utilisateur).
// Si ce style est basé sur "Standard" (v3, avec imports), les fonctionnalités
// natives (slots, config 3D) restent utilisables — sinon elles sont ignorées
// proprement (voir `hasBasemapImport` plus bas).
const MAP_STYLE = 'mapbox://styles/devnos/cms9xitev009301s80im37bm5';

// Modèle 3D par défaut du véhicule (place ton .glb dans /public/models/).
const DEFAULT_CAR_MODEL_URL = '/models/berline.glb';

/**
 * Carte vecteur Mapbox GL JS : rendu fluide, trafic en temps réel,
 * itinéraire "driving-traffic" (tient compte des embouteillages),
 * marqueurs animés en continu (position interpolée, pas de saut).
 */
export default function RealMap({
  pickup,
  dropoff,
  driverPosition,
  showRoute = false,
  routeColor = '#e8c9a8',
  pins = [],
  pitch = 0,
  buildings3d = false,
  use3dCar = false,
  carModelUrl = DEFAULT_CAR_MODEL_URL,
  carHeading = 90,
  onNavigationUpdate,
}: {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  /** Position live du chauffeur (GPS). Si fournie, sert de point de départ
   *  pour l'itinéraire (à la place de `pickup`) et s'affiche comme un
   *  marqueur véhicule dédié, animé en continu. */
  driverPosition?: LatLng | null;
  showRoute?: boolean;
  routeColor?: string;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const animFrames = useRef<Record<string, number>>({});
  // Vrai seulement si le style Mapbox chargé est basé sur "Standard" (v3, avec
  // un import "basemap") — condition nécessaire pour que les layers de type
  // 'model' (véhicules 3D) et les slots ('top'/'middle'/'bottom') soient
  // supportés. Alimenté depuis le handler 'style.load' plus bas.
  const hasBasemapImportRef = useRef(false);
  // URLs de modèles .glb dont on sait, pour cette session, qu'elles échouent
  // à s'afficher en 3D (fichier manquant, layer 'model' non supporté par le
  // style courant, etc.) — on bascule alors ces véhicules sur le marqueur
  // emoji plutôt que de les laisser invisibles. Indexé par URL (et non par
  // id de véhicule) car la cause est presque toujours liée au style/modèle
  // lui-même, donc commune à tous les véhicules qui l'utilisent.
  const [failedModelUrls, setFailedModelUrls] = useState<Set<string>>(new Set());
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

        // Calque trafic live officiel Mapbox (congestion en temps réel).
        // `slot: 'top'` n'existe que sur les styles Standard (v3) : on ne
        // l'ajoute que si le style personnalisé en dispose, sinon Mapbox GL
        // rejetterait la couche.
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

        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          ...(hasBasemapImport ? { slot: 'top' } : {}),
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 4, 'line-color': routeColor, 'line-opacity': 0.9 },
        });

        // Le toggle 3D natif ne s'applique qu'aux styles Standard. Si le style
        // personnalisé est un style classique, les bâtiments 3D (s'il y en a)
        // restent tels qu'ils ont été configurés dans Mapbox Studio.
        if (hasBasemapImport) {
          map.setConfigProperty('basemap', 'show3dObjects', buildings3d);
        }

        // Pas de map.setFog() ici : le style personnalisé (Mapbox Studio,
        // panneau "Atmosphere") définit déjà sa propre ambiance de ciel/brume.
        // La forcer ici en JS écraserait ce réglage à chaque chargement.
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
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Marqueurs pickup / dropoff + pins (chauffeur, etc.), avec déplacement animé.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    async function render() {
      const mapboxgl = (await import('mapbox-gl')).default;
      const wanted: Record<string, { pos: LatLng; el: () => HTMLElement }> = {};

      if (pickup) {
        wanted['pickup'] = { pos: pickup, el: () => dropEl('#e8c9a8') };
      }
      if (dropoff) {
        wanted['dropoff'] = { pos: dropoff, el: () => dropEl('#d97b6a') };
      }
      if (driverPosition && !effectiveUse3dCar) {
        wanted['driver'] = { pos: driverPosition, el: () => emojiEl('🚗') };
      }
      pins.forEach((p, i) => {
        if (p.car3d && !failedModelUrls.has(p.car3d.modelUrl ?? DEFAULT_CAR_MODEL_URL)) return; // rendu en modèle 3D réel, pas en marqueur DOM plat
        wanted[`pin-${i}`] = {
          pos: p.position,
          el: () => (p.passenger ? passengerEl(p.passenger) : emojiEl(p.emoji ?? '🚗')),
        };
      });

      // Retire les marqueurs qui ne sont plus utilisés.
      Object.keys(markersRef.current).forEach((key) => {
        if (!wanted[key]) {
          markersRef.current[key].remove();
          delete markersRef.current[key];
        }
      });

      Object.entries(wanted).forEach(([key, { pos, el }]) => {
        const existing = markersRef.current[key];
        if (!existing) {
          const marker = new mapboxgl.Marker({ element: el() }).setLngLat([pos.lng, pos.lat]).addTo(map);
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

      const coords: [number, number][] = [];
      if (pickup) coords.push([pickup.lng, pickup.lat]);
      if (dropoff) coords.push([dropoff.lng, dropoff.lat]);
      if (driverPosition) coords.push([driverPosition.lng, driverPosition.lat]);
      pins.forEach((p) => coords.push([p.position.lng, p.position.lat]));
      if (coords.length === 1) {
        map.easeTo({ center: coords[0], zoom: 15, pitch, bearing: map.getBearing(), duration: 800 });
      } else if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as any),
          new (await import('mapbox-gl')).default.LngLatBounds(coords[0], coords[0])
        );
        // IMPORTANT : fitBounds() remet pitch/bearing à 0 par défaut si on ne
        // les précise pas ici — ça écrasait la vue inclinée (ciel visible) à
        // chaque recentrage sur plusieurs points (ex: chauffeur + pickup).
        map.fitBounds(bounds, { padding: 60, duration: 800, pitch, bearing: map.getBearing() });
      }
    }

    if (map.isStyleLoaded()) render();
    else map.once('load', render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins), effectiveUse3dCar, failedModelUrls]);

  // Modèles 3D réels (.glb) : le véhicule du chauffeur connecté (driverPosition,
  // si use3dCar) + tout pin déclarant `car3d` (ex: autres chauffeurs disponibles
  // autour). Chacun a sa propre source/layer Mapbox — on les recrée à chaque
  // changement de position, les sources "model" n'ayant pas d'update incrémental.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Résout un chemin relatif (ex: "/models/berline.glb") en URL absolue.
    // Les sources 'model' sont chargées par un worker Mapbox GL qui n'a pas
    // toujours le même contexte d'URL de base que le document — passer une
    // URL absolue évite toute résolution ambiguë (voir diagnostic).
    const absoluteUrl = (u: string) => {
      try {
        return new URL(u, window.location.origin).href;
      } catch {
        return u;
      }
    };

    type CarModel = { id: string; modelUrl: string; position: LatLng; heading: number };
    const cars: CarModel[] = [];
    if (use3dCar && driverPosition && !failedModelUrls.has(carModelUrl)) {
      cars.push({ id: 'car-3d-ego', modelUrl: carModelUrl, position: driverPosition, heading: carHeading });
    }
    pins.forEach((p, i) => {
      if (p.car3d) {
        const url = p.car3d.modelUrl ?? DEFAULT_CAR_MODEL_URL;
        if (failedModelUrls.has(url)) return; // déjà en échec : le marqueur DOM (emoji) prend le relais, voir l'effet ci-dessus
        cars.push({ id: `car-3d-pin-${i}`, modelUrl: url, position: p.position, heading: p.car3d.heading ?? 90 });
      }
    });

    const activeIds = new Set(cars.map((c) => c.id));

    function markUrlFailed(url: string) {
      setFailedModelUrls((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    }

    // Filet de sécurité asynchrone : un .glb manquant / une réponse HTTP en
    // erreur remonte via l'événement 'error' du style plutôt qu'une
    // exception JS. On mappe le message vers l'URL du modèle concerné.
    function onMapError(e: any) {
      const msg = e?.error?.message;
      if (typeof msg !== 'string') return;
      const matched = cars.find((c) => msg.includes(c.modelUrl) || msg.includes(absoluteUrl(c.modelUrl)));
      if (matched) markUrlFailed(matched.modelUrl);
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
                uri: absoluteUrl(car.modelUrl),
                position: [car.position.lng, car.position.lat],
                orientation: [0, 0, car.heading],
              },
            },
          } as any);

          map.addLayer({
            id: layerId,
            type: 'model',
            source: sourceId,
            // 'slot' n'existe que sur les styles Standard (v3, avec import
            // "basemap") : sur un style classique, le fournir ferait échouer
            // l'ajout du layer silencieusement (ou lever une exception selon
            // la version). On ne l'ajoute donc que si le style le supporte —
            // même garde que pour les layers 'traffic'/'route-line' plus haut.
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
          // Layer 'model' non supporté par ce style (le cas le plus probable
          // si le style Mapbox Studio n'est pas basé sur "Standard") : Mapbox
          // GL lève ici une exception synchrone plutôt qu'un événement
          // 'error' asynchrone. On bascule ce véhicule sur l'emoji 🚗.
          console.error(`[RealMap] Échec de l'ajout du modèle 3D "${car.modelUrl}" :`, err);
          markUrlFailed(car.modelUrl);
        }
      });
    }

    if (map.isStyleLoaded()) upsertCarModels();
    else map.once('style.load', upsertCarModels);

    return () => {
      map.off('error', onMapError);
      // Nettoie uniquement les modèles gérés par ce rendu (via activeIds),
      // pour ne pas toucher aux sources/layers d'un autre appel en cours.
      activeIds.forEach((id) => {
        if (map.getLayer(`${id}-layer`)) map.removeLayer(`${id}-layer`);
        if (map.getSource(`${id}-source`)) map.removeSource(`${id}-source`);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3dCar, carModelUrl, carHeading, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins), failedModelUrls]);

  // En dessous de cette distance parcourue par le point de départ ET avant ce
  // délai écoulé depuis le dernier calcul, on ne redemande pas d'itinéraire :
  // le tracé affiché reste valable, seule l'ETA/le guidage se rafraîchissent
  // un peu moins souvent. `startSharingLocation` (lib/driver.ts) pousse une
  // position GPS parfois plusieurs fois par seconde — sans ce garde-fou,
  // chaque micro-déplacement déclenchait un appel réseau complet.
  const ROUTE_REFRESH_MIN_DISTANCE_M = 25;
  const ROUTE_REFRESH_MIN_INTERVAL_MS = 8000;
  const routeThrottleRef = useRef<{ endpointsKey: string; lastStart: LatLng; lastFetchAt: number } | null>(null);

  // Itinéraire routier via OSRM (voir lib/osrm.ts) — remplace les appels à
  // l'API payante Mapbox Directions, qui étaient le principal poste de
  // consommation de quota (un appel à CHAQUE mise à jour GPS du chauffeur).
  // Point de départ : la position live du chauffeur si disponible (suivi temps réel),
  // sinon le point de prise en charge (comportement historique, ex. écrans passager).
  useEffect(() => {
    const map = mapRef.current;
    const routeStart = driverPosition ?? pickup;
    if (!map || !showRoute || !routeStart || !dropoff) {
      onNavigationUpdate?.(null);
      routeThrottleRef.current = null;
      return;
    }

    async function drawRoute() {
      try {
        const result = await fetchOsrmRoute(routeStart!, dropoff!);
        if (!result) {
          onNavigationUpdate?.(null);
          return;
        }
        const src = map.getSource('route');
        if (src) src.setData({ type: 'Feature', properties: {}, geometry: result.geometry as any });

        // steps[0] = segment en cours (jusqu'à la prochaine manœuvre),
        // steps[1] = la manœuvre à venir elle-même (instruction à afficher).
        const steps = result.steps;
        if (steps.length >= 2) {
          onNavigationUpdate?.({
            instruction: steps[1].instruction,
            type: steps[1].type,
            modifier: steps[1].modifier,
            distanceMeters: steps[0].distanceMeters,
          });
        } else if (steps.length === 1) {
          onNavigationUpdate?.({ instruction: 'Vous êtes arrivé à destination', type: 'arrive', distanceMeters: 0 });
        } else {
          onNavigationUpdate?.(null);
        }
      } catch {
        // OSRM indisponible (hors-ligne, serveur de démo public surchargé...) :
        // trait direct départ → arrivée en secours, comme avant.
        onNavigationUpdate?.(null);
        const src = map.getSource('route');
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
      }
    }

    function maybeDrawRoute() {
      const endpointsKey = `${dropoff!.lat},${dropoff!.lng}`;
      const prev = routeThrottleRef.current;
      const isNewTrip = !prev || prev.endpointsKey !== endpointsKey;
      const now = Date.now();

      if (!isNewTrip) {
        const movedM = haversineKm(prev!.lastStart.lat, prev!.lastStart.lng, routeStart!.lat, routeStart!.lng) * 1000;
        const elapsedMs = now - prev!.lastFetchAt;
        if (movedM < ROUTE_REFRESH_MIN_DISTANCE_M && elapsedMs < ROUTE_REFRESH_MIN_INTERVAL_MS) {
          return; // déplacement/délai négligeables depuis le dernier calcul : on garde le tracé actuel
        }
      }

      routeThrottleRef.current = { endpointsKey, lastStart: routeStart!, lastFetchAt: now };
      drawRoute();
    }

    if (map.isStyleLoaded()) maybeDrawRoute();
    else map.once('load', maybeDrawRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPosition?.lat, driverPosition?.lng, showRoute]);

  return <div ref={containerRef} className="real-map" />;
}

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
