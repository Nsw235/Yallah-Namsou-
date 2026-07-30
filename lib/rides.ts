import { supabase } from '@/lib/supabaseClient';
import { PricingRule, Trip, TripWithDriver, VehicleType } from '@/types/database';
import { GeoResult } from '@/lib/geocode';

/** Récupère la grille tarifaire (une ligne par type de véhicule). */
export async function getPricingRules(): Promise<PricingRule[]> {
  const { data, error } = await supabase.from('pricing_rules').select('*');
  if (error) throw error;
  return data as PricingRule[];
}

/** Crée une nouvelle course à l'état "pending" pour le passager connecté. */
export async function createTrip(params: {
  passengerId: string;
  vehicleType: VehicleType;
  estimatedPrice: number;
  pickup: GeoResult;
  dropoff: GeoResult;
}): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert({
      passenger_id: params.passengerId,
      vehicle_type: params.vehicleType,
      pickup_lat: params.pickup.lat,
      pickup_lng: params.pickup.lng,
      pickup_address: params.pickup.address,
      dropoff_lat: params.dropoff.lat,
      dropoff_lng: params.dropoff.lng,
      dropoff_address: params.dropoff.address,
      estimated_price: params.estimatedPrice,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data as Trip;
}

/** Liste les chauffeurs réellement disponibles pour le type de véhicule demandé. */
export async function listAvailableVehicles(vehicleType: VehicleType) {
  const { data: vehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, driver_id, plate, brand, model, status, type')
    .eq('type', vehicleType)
    .eq('status', 'available');
  if (vehicleError) throw vehicleError;
  if (!vehicles || vehicles.length === 0) return [];

  const driverIds = vehicles.map((v) => v.driver_id);

  const { data: drivers, error: driversError } = await supabase
    .from('drivers')
    .select('id, rating_avg, validation_status')
    .in('id', driverIds)
    .eq('validation_status', 'approved');
  if (driversError) throw driversError;

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, phone')
    .in('id', driverIds);
  if (profilesError) throw profilesError;

  return vehicles
    .map((v) => {
      const driver = drivers?.find((d) => d.id === v.driver_id);
      if (!driver) return null;
      const profile = profiles?.find((p) => p.id === v.driver_id);
      return {
        vehicle: v,
        driver: {
          id: driver.id,
          rating_avg: driver.rating_avg,
          full_name: profile?.full_name ?? null,
          phone: profile?.phone ?? null,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Dispatch automatique : demande à l'Edge Function `dispatch-trip` de trouver
 * et d'assigner le chauffeur disponible le plus proche (calcul de distance
 * réelle côté serveur, verrouillage anti-double-assignation). Le client ne
 * choisit plus lui-même le chauffeur — c'est désormais interdit par les RLS.
 */
export async function dispatchTrip(tripId: string): Promise<Trip> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Session expirée, reconnectez-vous.');

  const { data, error } = await supabase.functions.invoke('dispatch-trip', {
    body: { trip_id: tripId },
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error) {
    // Le corps d'erreur de la function contient un message exploitable
    // (ex: "no_driver_available") remonté par supabase-js dans error.context.
    const ctx = (error as any)?.context;
    let message = error.message;
    try {
      const body = typeof ctx?.body === 'string' ? JSON.parse(ctx.body) : null;
      if (body?.error) message = body.error;
    } catch {
      /* ignore parse errors, garder error.message */
    }
    if (message === 'no_driver_available') {
      throw new Error('Aucun chauffeur disponible pour le moment. Réessayez dans un instant.');
    }
    throw new Error(message ?? 'Dispatch impossible.');
  }

  return (data as { trip: Trip }).trip;
}

/** Détails chauffeur + véhicule assignés à une course (après dispatch). */
export async function getAssignedDriverInfo(trip: Trip) {
  if (!trip.driver_id || !trip.vehicle_id) return null;

  const [{ data: profile }, { data: driver }, { data: vehicle }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone').eq('id', trip.driver_id).maybeSingle(),
    supabase.from('drivers').select('rating_avg').eq('id', trip.driver_id).maybeSingle(),
    supabase.from('vehicles').select('plate, brand, model, last_lat, last_lng').eq('id', trip.vehicle_id).maybeSingle(),
  ]);

  return {
    driver: {
      id: trip.driver_id,
      full_name: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      rating_avg: driver?.rating_avg ?? 5,
    },
    vehicle: {
      plate: vehicle?.plate ?? '',
      brand: vehicle?.brand ?? null,
      model: vehicle?.model ?? null,
      last_lat: vehicle?.last_lat ?? null,
      last_lng: vehicle?.last_lng ?? null,
    },
  };
}

/**
 * Abonnement temps réel au statut d'une course (Realtime Postgres Changes).
 * Retourne une fonction de désabonnement à appeler au démontage.
 */
export function subscribeToTrip(tripId: string, onUpdate: (trip: Trip) => void): () => void {
  const channel = supabase
    .channel(`trip-${tripId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
      (payload) => onUpdate(payload.new as Trip)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Abonnement temps réel à la position d'un véhicule (mise à jour envoyée par
 * le chauffeur via `update_my_vehicle_location`). Utilisé pour faire bouger
 * le pin du chauffeur sur la carte du passager en direct.
 */
export function subscribeToVehiclePosition(
  vehicleId: string,
  onUpdate: (pos: { lat: number; lng: number }) => void
): () => void {
  const channel = supabase
    .channel(`vehicle-${vehicleId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'vehicles', filter: `id=eq.${vehicleId}` },
      (payload) => {
        const row = payload.new as { last_lat: number | null; last_lng: number | null };
        if (row.last_lat != null && row.last_lng != null) {
          onUpdate({ lat: row.last_lat, lng: row.last_lng });
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Passe la course en "en cours" (le passager confirme être monté à bord). */
export async function startTrip(tripId: string): Promise<Trip> {
  const { data, error } = await supabase.rpc('passenger_confirm_boarding', { p_trip_id: tripId });
  if (error) throw new Error(error.message === 'trip_not_startable' ? 'Cette course ne peut plus être démarrée.' : error.message);
  return data as Trip;
}

/** Termine la course côté passager (RPC atomique : statut + ligne de paiement cash "pending"). */
export async function completeTrip(tripId: string, finalPrice: number): Promise<Trip> {
  const { data, error } = await supabase.rpc('passenger_complete_trip', {
    p_trip_id: tripId,
    p_final_price: finalPrice,
  });
  if (error) throw new Error(error.message === 'trip_not_completable' ? 'Cette course ne peut plus être terminée.' : error.message);
  return data as Trip;
}

/** Enregistre la note laissée par le passager pour cette course. */
export async function rateTrip(tripId: string, ratedBy: string, rating: number) {
  const { error } = await supabase.from('ratings').insert({
    trip_id: tripId,
    rated_by: ratedBy,
    rating,
  });
  if (error) throw error;
}

/** Historique des courses terminées du passager connecté, chauffeur inclus. */
export async function getTripHistory(passengerId: string): Promise<TripWithDriver[]> {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('*')
    .eq('passenger_id', passengerId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });
  if (error) throw error;

  const results: TripWithDriver[] = [];
  for (const trip of (trips as Trip[]) ?? []) {
    if (!trip.driver_id) {
      results.push(trip);
      continue;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', trip.driver_id)
      .maybeSingle();
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('plate, brand, model')
      .eq('id', trip.vehicle_id ?? '')
      .maybeSingle();
    results.push({ ...trip, driver_profile: profile, vehicle_info: vehicle });
  }
  return results;
}
