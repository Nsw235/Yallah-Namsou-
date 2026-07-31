'use client';

import { useEffect, useRef } from 'react';

export type LatLng = { lat: number; lng: number };
export type MapPin = { position: LatLng; emoji?: string; color?: string };

// Centre par défaut : N'Djamena, Tchad.
const DEFAULT_CENTER: LatLng = { lat: 12.1348, lng: 15.0557 };

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

// Style sombre sur-mesure (base Mapbox "Standard" en mode nuit, teinté cuivre
// pour coller à l'identité de la marque) + calque trafic live officiel.
const MAP_STYLE = 'mapbox://styles/mapbox/navigation-night-v1';

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
  /** Active l'extrusion 3D des bâtiments, teintée cuivre, pour l'effet "ville miniature". */
  buildings3d?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const animFrames = useRef<Record<string, number>>({});

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
        bearing: buildings3d ? -17 : 0,
        antialias: true,
      });
      mapRef.current = map;

      map.on('load', () => {
        // Calque trafic live officiel Mapbox (congestion en temps réel).
        map.addSource('mapbox-traffic', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-traffic-v1',
        });
        map.addLayer({
          id: 'traffic',
          type: 'line',
          source: 'mapbox-traffic',
          'source-layer': 'traffic',
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
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 4, 'line-color': routeColor, 'line-opacity': 0.9 },
        });

        if (buildings3d) {
          // Extrusion 3D des bâtiments (données vectorielles réelles Mapbox),
          // teintée cuivre pour coller à l'identité visuelle "ville miniature".
          const firstSymbolLayer = map
            .getStyle()
            .layers?.find((l: any) => l.type === 'symbol')?.id;
          map.addLayer(
            {
              id: '3d-buildings',
              source: 'composite',
              'source-layer': 'building',
              type: 'fill-extrusion',
              minzoom: 12,
              filter: ['==', 'extrude', 'true'],
              paint: {
                'fill-extrusion-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'height'],
                  0, '#3a2c22',
                  40, '#6b4a35',
                  120, '#a97a5b',
                ],
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-opacity': 0.88,
              },
            },
            firstSymbolLayer
          );
          map.setFog({
            range: [0.5, 10],
            color: '#1c1512',
            'high-color': '#3a2c22',
            'horizon-blend': 0.15,
            'space-color': '#0a0b0d',
            'star-intensity': 0,
          });
        }
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
      if (driverPosition) {
        wanted['driver'] = { pos: driverPosition, el: () => emojiEl('🚗') };
      }
      pins.forEach((p, i) => {
        wanted[`pin-${i}`] = { pos: p.position, el: () => emojiEl(p.emoji ?? '🚗') };
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
        map.easeTo({ center: coords[0], zoom: 15, duration: 800 });
      } else if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as any),
          new (await import('mapbox-gl')).default.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding: 60, duration: 800 });
      }
    }

    if (map.isStyleLoaded()) render();
    else map.once('load', render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPosition?.lat, driverPosition?.lng, JSON.stringify(pins)]);

  // Itinéraire réel tenant compte du trafic (Mapbox Directions, profil driving-traffic).
  // Point de départ : la position live du chauffeur si disponible (suivi temps réel),
  // sinon le point de prise en charge (comportement historique, ex. écrans passager).
  useEffect(() => {
    const map = mapRef.current;
    const routeStart = driverPosition ?? pickup;
    if (!map || !showRoute || !routeStart || !dropoff) return;

    async function drawRoute() {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${routeStart!.lng},${routeStart!.lat};${dropoff!.lng},${dropoff!.lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        const geometry = data?.routes?.[0]?.geometry;
        if (!geometry) return;
        const src = map.getSource('route');
        if (src) src.setData({ type: 'Feature', properties: {}, geometry });
      } catch {
        // Hors-ligne : trait direct départ → arrivée en secours.
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

function emojiEl(emoji: string): HTMLElement {
  const el = document.createElement('div');
  el.style.fontSize = '26px';
  el.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.6))';
  el.textContent = emoji;
  return el;
}
