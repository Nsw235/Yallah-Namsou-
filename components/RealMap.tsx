'use client';

import { useEffect, useRef } from 'react';

export type LatLng = { lat: number; lng: number };
export type MapPin = { position: LatLng; emoji?: string; color?: string };

// Centre par défaut : N'Djamena, Tchad.
const DEFAULT_CENTER: LatLng = { lat: 12.1348, lng: 15.0557 };

/**
 * Vraie carte (tuiles OpenStreetMap, sans clé API) avec marqueurs et
 * itinéraire routier réel (via le service public OSRM). Remplace l'ancien
 * décor en CSS (div "blockA/blockB/road...").
 */
export default function RealMap({
  pickup,
  dropoff,
  showRoute = false,
  routeColor = '#e8c9a8',
  pins = [],
}: {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  showRoute?: boolean;
  routeColor?: string;
  pins?: MapPin[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const ownLayers = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      if (!mapInstance.current) {
        mapInstance.current = L.map(containerRef.current, {
          zoomControl: false,
          attributionControl: true,
        }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        }).addTo(mapInstance.current);
      }
      const map = mapInstance.current;

      // Nettoie les couches ajoutées lors du rendu précédent.
      ownLayers.current.forEach((layer) => map.removeLayer(layer));
      ownLayers.current = [];

      const dropPin = (color: string) =>
        L.divIcon({
          className: '',
          html: `<div style="width:16px;height:16px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 0 8px ${color};border:2px solid rgba(0,0,0,0.45)"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 16],
        });

      const emojiPin = (emoji: string) =>
        L.divIcon({
          className: '',
          html: `<div style="font-size:26px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6))">${emoji}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

      const bounds: [number, number][] = [];

      if (pickup) {
        ownLayers.current.push(L.marker([pickup.lat, pickup.lng], { icon: dropPin('#e8c9a8') }).addTo(map));
        bounds.push([pickup.lat, pickup.lng]);
      }
      if (dropoff) {
        ownLayers.current.push(L.marker([dropoff.lat, dropoff.lng], { icon: dropPin('#ff5f5f') }).addTo(map));
        bounds.push([dropoff.lat, dropoff.lng]);
      }
      pins.forEach((p) => {
        ownLayers.current.push(
          L.marker([p.position.lat, p.position.lng], { icon: emojiPin(p.emoji ?? '🚗') }).addTo(map)
        );
        bounds.push([p.position.lat, p.position.lng]);
      });

      if (showRoute && pickup && dropoff) {
        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`;
          const res = await fetch(url);
          const data = await res.json();
          const coords: number[][] | undefined = data?.routes?.[0]?.geometry?.coordinates;
          if (coords && !cancelled) {
            const latlngs = coords.map((c) => [c[1], c[0]] as [number, number]);
            ownLayers.current.push(
              L.polyline(latlngs, { color: routeColor, weight: 4, opacity: 0.9 }).addTo(map)
            );
            bounds.push(...latlngs);
          }
        } catch {
          // Itinéraire indisponible (hors-ligne) : trait pointillé direct en secours.
          ownLayers.current.push(
            L.polyline(
              [
                [pickup.lat, pickup.lng],
                [dropoff.lat, dropoff.lng],
              ],
              { color: routeColor, weight: 3, opacity: 0.6, dashArray: '6 8' }
            ).addTo(map)
          );
        }
      }

      if (!cancelled) {
        if (bounds.length === 1) map.setView(bounds[0], 15);
        else if (bounds.length > 1) map.fitBounds(bounds as any, { padding: [40, 40] });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, showRoute, routeColor, JSON.stringify(pins)]);

  // Nettoyage complet au démontage du composant.
  useEffect(() => {
    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  return <div ref={containerRef} className="real-map" />;
}
