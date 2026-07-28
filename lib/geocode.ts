export type GeoResult = {
  label: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * Recherche d'adresses réelles via OpenStreetMap Nominatim (gratuit, sans clé API).
 * Limité au Tchad et centré sur N'Djamena pour des résultats pertinents.
 */
export async function searchAddress(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6' +
    '&countrycodes=td&viewbox=14.9,12.2,15.2,12.0&bounded=1' +
    `&q=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    headers: { 'Accept-Language': 'fr' },
  });
  if (!res.ok) return [];
  const data = await res.json();

  return (data as any[]).map((d) => ({
    label: d.display_name.split(',')[0],
    address: d.display_name,
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
  }));
}
