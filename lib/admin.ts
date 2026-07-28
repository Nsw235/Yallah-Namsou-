import { supabase } from '@/lib/supabaseClient';

/** Vérifie si l'utilisateur connecté a le rôle admin. */
export async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (error) throw error;
  return data?.role === 'admin';
}

export type FleetVehicle = {
  id: string;
  type: string;
  plate: string;
  brand: string | null;
  model: string | null;
  status: 'offline' | 'available' | 'busy';
  driver_name: string | null;
  driver_id: string;
};

/** Vue d'ensemble de la flotte : chaque véhicule, son statut, son chauffeur. */
export async function getFleetOverview(): Promise<FleetVehicle[]> {
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, type, plate, brand, model, status, driver_id');
  if (error) throw error;
  if (!vehicles || vehicles.length === 0) return [];

  const driverIds = Array.from(new Set(vehicles.map((v) => v.driver_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', driverIds);
  if (profilesError) throw profilesError;

  return vehicles.map((v) => ({
    ...v,
    driver_name: profiles?.find((p) => p.id === v.driver_id)?.full_name ?? null,
  }));
}

export type ActiveTripRow = {
  id: string;
  vehicle_type: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string;
  estimated_price: number | null;
  passenger_name: string | null;
  driver_name: string | null;
};

/** Courses en ce moment en cours (acceptées ou en route). */
export async function getActiveTrips(): Promise<ActiveTripRow[]> {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, vehicle_type, pickup_address, dropoff_address, status, estimated_price, passenger_id, driver_id')
    .in('status', ['accepted', 'in_progress'])
    .order('accepted_at', { ascending: false });
  if (error) throw error;
  if (!trips || trips.length === 0) return [];

  const ids = Array.from(new Set([...trips.map((t) => t.passenger_id), ...trips.map((t) => t.driver_id)].filter(Boolean)));
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', ids as string[]);
  if (profilesError) throw profilesError;

  return trips.map((t) => ({
    id: t.id,
    vehicle_type: t.vehicle_type,
    pickup_address: t.pickup_address,
    dropoff_address: t.dropoff_address,
    status: t.status,
    estimated_price: t.estimated_price,
    passenger_name: profiles?.find((p) => p.id === t.passenger_id)?.full_name ?? null,
    driver_name: profiles?.find((p) => p.id === t.driver_id)?.full_name ?? null,
  }));
}

export type DriverStatRow = {
  id: string;
  full_name: string | null;
  rating_avg: number;
  validation_status: string;
  completed_trips: number;
};

/** Statistiques par chauffeur : nombre de courses effectuées, note, statut. */
export async function getDriverStats(): Promise<DriverStatRow[]> {
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('id, rating_avg, validation_status');
  if (error) throw error;
  if (!drivers || drivers.length === 0) return [];

  const ids = drivers.map((d) => d.id);
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', ids);
  if (profilesError) throw profilesError;

  const { data: completedTrips, error: tripsError } = await supabase
    .from('trips')
    .select('driver_id')
    .eq('status', 'completed')
    .in('driver_id', ids);
  if (tripsError) throw tripsError;

  return drivers.map((d) => ({
    id: d.id,
    full_name: profiles?.find((p) => p.id === d.id)?.full_name ?? null,
    rating_avg: d.rating_avg,
    validation_status: d.validation_status,
    completed_trips: (completedTrips ?? []).filter((t) => t.driver_id === d.id).length,
  }));
}

/** Approuve ou suspend un chauffeur. */
export async function setDriverValidation(driverId: string, status: 'approved' | 'rejected' | 'suspended') {
  const { error } = await supabase.from('drivers').update({ validation_status: status }).eq('id', driverId);
  if (error) throw error;
}
