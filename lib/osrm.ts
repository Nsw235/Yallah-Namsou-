/**
 * Moteur d'itinéraire OSRM (Open Source Routing Machine).
 *
 * Remplace les appels à l'API Mapbox Directions (`/directions/v5/...`), qui
 * consommaient un appel facturé à chaque recalcul de trajet — cf. le
 * diagnostic dans RealMap.tsx. OSRM est open-source, sans clé API et sans
 * quota par défaut sur `router.project-osrm.org` (serveur de démo public).
 *
 * ⚠️ Le serveur de démo public n'est ni garanti en disponibilité ni en débit
 * (pas de SLA, pas de trafic temps réel). Pour la production, héberger sa
 * propre instance OSRM (Docker `osrm-backend`, extrait OSM du Tchad) via
 * `NEXT_PUBLIC_OSRM_URL` est recommandé — voir le README.
 */

export type LatLng = { lat: number; lng: number };

export type OsrmStep = {
  /** Instruction en français, générée localement (OSRM ne renvoie que type/modifier/nom de rue, pas de texte). */
  instruction: string;
  type: string;
  modifier?: string;
  distanceMeters: number;
};

export type OsrmRoute = {
  /** Géométrie GeoJSON (LineString) — injectée telle quelle dans la source Mapbox `route`. */
  geometry: GeoJSON.Geometry;
  distanceMeters: number;
  durationSeconds: number;
  steps: OsrmStep[];
};

// Surchargeable via NEXT_PUBLIC_OSRM_URL pour pointer vers une instance auto-hébergée.
const OSRM_BASE_URL = (process.env.NEXT_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/+$/, '');

/**
 * Calcule un itinéraire routier via OSRM et renvoie la géométrie GeoJSON,
 * la distance/durée totales, et les étapes (guidage virage par virage).
 * Renvoie `null` si OSRM ne trouve pas de trajet ou répond une erreur.
 */
export async function fetchOsrmRoute(start: LatLng, end: LatLng): Promise<OsrmRoute | null> {
  const url =
    `${OSRM_BASE_URL}/route/v1/driving/` +
    `${start.lng},${start.lat};${end.lng},${end.lat}` +
    `?overview=full&geometries=geojson&steps=true&alternatives=false`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data?.code !== 'Ok' || !data.routes?.[0]) return null;

  const route = data.routes[0];
  const legSteps: any[] = route.legs?.[0]?.steps ?? [];

  const steps: OsrmStep[] = legSteps.map((s) => ({
    instruction: frInstruction(s.maneuver?.type, s.maneuver?.modifier, s.name),
    type: s.maneuver?.type ?? 'turn',
    modifier: s.maneuver?.modifier,
    distanceMeters: s.distance ?? 0,
  }));

  return {
    geometry: route.geometry,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    steps,
  };
}

/**
 * Traduit un couple (type, modifier) de manœuvre OSRM en instruction FR.
 * OSRM utilise le même vocabulaire que Mapbox Directions (les deux dérivent
 * du même moteur) : `type` ∈ {turn, depart, arrive, roundabout, merge,
 * fork, end of road, continue, new name, on ramp, off ramp, ...},
 * `modifier` ∈ {uturn, sharp left, left, slight left, straight,
 * slight right, right, sharp right}. Les icônes (`ManeuverIcon` côté UI)
 * restent donc compatibles sans changement.
 */
function frInstruction(type: string | undefined, modifier: string | undefined, roadName?: string): string {
  const road = roadName && roadName.trim() ? ` sur ${roadName}` : '';

  switch (type) {
    case 'depart':
      return `Démarrez${road}`;
    case 'arrive':
      return 'Vous êtes arrivé à destination';
    case 'roundabout':
    case 'rotary':
      return `Prenez le rond-point${road}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Sortez du rond-point${road}`;
    case 'merge':
      return `Rejoignez la voie${road}`;
    case 'on ramp':
      return `Prenez la bretelle${road}`;
    case 'off ramp':
      return `Sortez${road}`;
    case 'fork':
      return modifier?.includes('left') ? `Restez à gauche${road}` : `Restez à droite${road}`;
    case 'end of road':
      return modifier?.includes('left') ? `Tournez à gauche en fin de route${road}` : `Tournez à droite en fin de route${road}`;
    case 'continue':
    case 'new name':
      return `Continuez tout droit${road}`;
    case 'turn':
    default: {
      if (!modifier) return `Continuez${road}`;
      if (modifier.includes('sharp left')) return `Tournez fortement à gauche${road}`;
      if (modifier.includes('slight left')) return `Serrez à gauche${road}`;
      if (modifier.includes('left')) return `Tournez à gauche${road}`;
      if (modifier.includes('sharp right')) return `Tournez fortement à droite${road}`;
      if (modifier.includes('slight right')) return `Serrez à droite${road}`;
      if (modifier.includes('right')) return `Tournez à droite${road}`;
      if (modifier.includes('uturn')) return `Faites demi-tour${road}`;
      return `Continuez tout droit${road}`;
    }
  }
}
