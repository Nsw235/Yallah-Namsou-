import { PaymentMethod, PricingRule, VehicleType } from '@/types/database';

// Coordonnées démo pour le trajet affiché dans l'app (N'Djamena).
// À remplacer plus tard par une vraie saisie d'adresse / géocodage.
export const DEMO_ROUTE = {
  pickup: {
    label: 'Quartier Klemat',
    address: 'Quartier Klemat, N\u2019Djamena',
    lat: 12.1050,
    lng: 15.0350,
  },
  dropoff: {
    label: "Ave de l'indépendance",
    address: "Avenue de l'indépendance, N'Djamena",
    lat: 12.1150,
    lng: 15.0480,
  },
};

// Distance à vol d'oiseau (Haversine), en kilomètres.
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function estimatePrice(rule: PricingRule, distanceKm: number, isPeak = false): number {
  const multiplier = isPeak ? Number(rule.peak_multiplier) : 1;
  const price = (rule.base_fare + rule.price_per_km * distanceKm) * multiplier;
  // arrondi à la dizaine de FCFA la plus proche
  return Math.round(price / 10) * 10;
}

export function formatFCFA(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString('fr-FR')} FCFA`;
}

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  berline: 'BERLINE',
  van: 'VAN',
  suv: 'SUV',
};

export const VEHICLE_EMOJI: Record<VehicleType, string> = {
  berline: '🚗',
  van: '🚐',
  suv: '🚘',
};

export const VEHICLE_ICON: Record<VehicleType, string> = {
  berline: '/icon_berline.png',
  van: '/icon_van.png',
  suv: '/icon_suv.png',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  airtel_money: 'Airtel Money',
  moov_money: 'Moov Money',
};

export const PAYMENT_METHOD_ICON: Record<PaymentMethod, string> = {
  cash: '💵',
  airtel_money: '📱',
  moov_money: '📲',
};
