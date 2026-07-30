import { supabase } from '@/lib/supabaseClient';
import { Trip, VehicleType } from '@/types/database';
import { completeTrip } from '@/lib/rides';

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

export async function startTrip(tripId: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', tripId)
    .select()
    .single();
  if (error) throw error;
  return data as Trip;
}

/** Termine la course (crée aussi la ligne de paiement espèces "pending") et libère le véhicule. */
export async function finishTrip(tripId: string, vehicleId: string, finalPrice: number): Promise<Trip> {
  const trip = await completeTrip(tripId, finalPrice);
  await setVehicleStatus(vehicleId, 'available');
  return trip;
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

/**
 * Démarre le partage GPS temps réel du chauffeur : suit sa position via
 * navigator.geolocation.watchPosition et la pousse dans public.vehicles
 * (current_lat/current_lng), lue en Realtime côté passager pendant la course.
 * Retourne une fonction d'arrêt (stopSharingLocation) à appeler au démontage
 * ou quand le chauffeur passe hors-ligne.
 */
export function startSharingLocation(vehicleId: string): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      supabase
        .from('vehicles')
        .update({
          current_lat: pos.coords.latitude,
          current_lng: pos.coords.longitude,
          location_updated_at: new Date().toISOString(),
        })
        .eq('id', vehicleId)
        .then(() => {});
    },
    () => {
      // géolocalisation refusée ou indisponible : on ignore silencieusement,
      // le tableau de bord reste utilisable sans position live.
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  return () => stopSharingLocation(watchId);
}

/** Arrête le partage GPS démarré par startSharingLocation. */
export function stopSharingLocation(watchId: number) {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
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

/**
 * Écoute en temps réel (Supabase Realtime) les courses créées ou mises à
 * jour dans `trips`. Le chauffeur est notifié instantanément d'une nouvelle
 * demande "pending" sans avoir à recharger la page.
 * Retourne une fonction de désinscription à appeler au démontage.
 */
export function subscribeToTripChanges(onChange: (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  trip: Trip;
}) => void): () => void {
  const channel = supabase
    .channel('driver-trips-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trips' },
      (payload) => {
        const trip = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Trip;
        onChange({ eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', trip });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
