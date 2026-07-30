import { supabase } from '@/lib/supabaseClient';
import { Trip, VehicleType } from '@/types/database';

export type MyVehicle = {
  id: string;
  type: VehicleType;
  plate: string;
  brand: string | null;
  model: string | null;
  status: 'offline' | 'available' | 'busy';
};

export type MyDriverProfile = {
  full_name: string | null;
  phone: string | null;
  rating_avg: number;
  validation_status: string;
};

/** Profil chauffeur + ses véhicules. */
export async function getMyDriverData(userId: string) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', userId)
    .single();
  if (profileError) throw profileError;

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('rating_avg, validation_status')
    .eq('id', userId)
    .single();
  if (driverError) throw driverError;

  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, type, plate, brand, model, status')
    .eq('driver_id', userId);
  if (vehiclesError) throw vehiclesError;

  return {
    profile: profile as MyDriverProfile & { full_name: string | null; phone: string | null },
    driver: driver as { rating_avg: number; validation_status: string },
    vehicles: (vehicles ?? []) as MyVehicle[],
  };
}

/** Change le statut d'un véhicule (en ligne / hors ligne). */
export async function setVehicleStatus(vehicleId: string, status: 'offline' | 'available' | 'busy') {
  const { error } = await supabase.from('vehicles').update({ status }).eq('id', vehicleId);
  if (error) throw error;
}

/** Courses en attente qu'un chauffeur approuvé peut voir et accepter (RLS filtrée). */
export async function getPendingTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Trip[];
}

/** La course en cours du chauffeur (acceptée ou en route). */
export async function getMyActiveTrip(driverId: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'in_progress'])
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Trip) ?? null;
}

/** Le chauffeur accepte une course en attente avec l'un de ses véhicules disponibles. */
export async function acceptTrip(tripId: string, driverId: string, vehicleId: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({ driver_id: driverId, vehicle_id: vehicleId, status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', tripId)
    .select()
    .single();
  if (error) throw error;
  await setVehicleStatus(vehicleId, 'busy');
  return data as Trip;
}

/** Le chauffeur démarre la course qui lui a été assignée (RPC sécurisée). */
export async function startTrip(tripId: string): Promise<Trip> {
  const { data, error } = await supabase.rpc('driver_start_trip', { p_trip_id: tripId });
  if (error) throw new Error(error.message === 'trip_not_startable' ? 'Cette course ne peut plus être démarrée.' : error.message);
  return data as Trip;
}

/** Termine la course (RPC atomique : statut + paiement cash "pending" + véhicule libéré). */
export async function finishTrip(tripId: string, _vehicleId: string, finalPrice: number): Promise<Trip> {
  const { data, error } = await supabase.rpc('driver_complete_trip', {
    p_trip_id: tripId,
    p_final_price: finalPrice,
  });
  if (error) throw new Error(error.message === 'trip_not_completable' ? 'Cette course ne peut plus être terminée.' : error.message);
  return data as Trip;
}

/**
 * Partage la position GPS du chauffeur en direct (toutes les ~5s ou à chaque
 * mouvement significatif) tant que le véhicule est en ligne. À appeler quand
 * le chauffeur passe "en ligne" et à arrêter quand il repasse "hors ligne"
 * ou ferme l'app. Retourne une fonction `stop()`.
 */
export function startSharingLocation(vehicleId: string): { stop: () => void } {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { stop: () => {} };
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      supabase
        .rpc('update_my_vehicle_location', {
          p_vehicle_id: vehicleId,
          p_lat: pos.coords.latitude,
          p_lng: pos.coords.longitude,
        })
        .then(({ error }) => {
          if (error) console.error('Erreur envoi position GPS :', error.message);
        });
    },
    (err) => console.error('Erreur géolocalisation :', err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  return {
    stop: () => navigator.geolocation.clearWatch(watchId),
  };
}

/** Le chauffeur confirme avoir encaissé le paiement en espèces. */
export async function confirmCashPayment(tripId: string) {
  const { error } = await supabase
    .from('payments')
    .update({ status: 'paid' })
    .eq('trip_id', tripId)
    .eq('method', 'cash');
  if (error) throw error;
}

/** Historique + statistiques du chauffeur. */
export async function getMyTripHistory(driverId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Trip[];
}
