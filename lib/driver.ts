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
