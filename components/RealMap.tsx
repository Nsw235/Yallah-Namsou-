'use client';

import { useEffect, useRef, useState } from 'react';

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
  onRouteInfo,
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
  /** Appelé à chaque recalcul d'itinéraire avec la distance/durée TOTALE (trafic pris en compte),
   *  ou null si pas d'itinéraire. Sert par ex. à afficher "chauffeur arrive dans X min" côté passager. */
  onRouteInfo?: (info: { distanceMeters: number; durationSeconds: number } | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const animFrames = useRef<Record<string, number>>({});
  // Si le fichier .glb demandé (carModelUrl) n'existe pas / échoue à charger,
  // on retombe automatiquement sur le marqueur emoji plutôt que de n'afficher
  // aucun véhicule du tout.
  const [modelFailed, setModelFailed] = useState(false);
  useEffect(() => {
    setModelFailed(false);
  }, [carModelUrl]);
  const effectiveUse3dCar = use3dCar && !modelFailed;

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
        if (p.car3d) return; // rendu en modèle 3D réel, pas en marqueur DOM plat
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
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins), effectiveUse3dCar]);

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
    // plutôt que de planter : on l'écoute pour retomber sur l'emoji 🚗 du
    // véhicule du chauffeur connecté au lieu de le laisser invisible.
    // (Les pins car3d en échec restent simplement invisibles, plus rares.)
    function onMapError(e: any) {
      const msg = e?.error?.message;
      if (typeof msg === 'string' && msg.includes(carModelUrl)) setModelFailed(true);
    }
    map.on('error', onMapError);

    function upsertCarModels() {
      cars.forEach((car) => {
        const sourceId = `${car.id}-source`;
        const layerId = `${car.id}-layer`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        map.addSource(sourceId, {
          type: 'model',
          models: {
            car: {
              uri: car.modelUrl,
              position: [car.position.lng, car.position.lat],
              orientation: [0, 0, car.heading],
            },
          },
        } as any);

        map.addLayer({
          id: layerId,
          type: 'model',
          source: sourceId,
          slot: 'top',
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
  }, [effectiveUse3dCar, carModelUrl, carHeading, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins)]);

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

    async function drawRoute() {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${routeStart!.lng},${routeStart!.lat};${dropoff!.lng},${dropoff!.lat}?geometries=geojson&overview=full&steps=true&language=fr&access_token=${MAPBOX_TOKEN}`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        const geometry = data?.routes?.[0]?.geometry;
        if (!geometry) {
          onNavigationUpdate?.(null);
          onRouteInfo?.(null);
          return;
        }
        const src = map.getSource('route');
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
        // Hors-ligne : trait direct départ → arrivée en secours.
        onNavigationUpdate?.(null);
        onRouteInfo?.(null);
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

    if (map.isStyleLoaded()) drawRoute();
    else map.once('load', drawRoute);
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
