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
  last_lat: number | null;
  last_lng: number | null;
};

/** Vue d'ensemble de la flotte : chaque véhicule, son statut, son chauffeur. */
export async function getFleetOverview(): Promise<FleetVehicle[]> {
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, type, plate, brand, model, status, driver_id, last_lat, last_lng');
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

/**
 * Écoute en temps réel les changements sur `vehicles` (statut, position GPS)
 * pour que la supervision admin (liste flotte + carte) se mette à jour sans
 * recharger la page.
 */
export function subscribeToFleetChanges(onChange: () => void): () => void {
  const channel = supabase
    .channel('admin-fleet-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => onChange())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
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

export type AdminMetrics = {
  revenueToday: number; // FCFA, somme des courses acceptées/en cours/terminées aujourd'hui
  cancellationRate: number; // % de courses annulées aujourd'hui
  tripsToday: number;
};

/** Métriques du jour pour le panneau "Performance Clé" du backoffice. */
export async function getAdminMetrics(): Promise<AdminMetrics> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: trips, error } = await supabase
    .from('trips')
    .select('status, estimated_price, final_price, requested_at')
    .gte('requested_at', startOfDay.toISOString());
  if (error) throw error;

  const rows = trips ?? [];
  const tripsToday = rows.length;
  const cancelled = rows.filter((t) => t.status === 'cancelled').length;
  const revenueToday = rows
    .filter((t) => ['accepted', 'in_progress', 'completed'].includes(t.status))
    .reduce((sum, t) => sum + Number(t.final_price ?? t.estimated_price ?? 0), 0);

  return {
    tripsToday,
    cancellationRate: tripsToday > 0 ? Math.round((cancelled / tripsToday) * 1000) / 10 : 0,
    revenueToday,
  };
}

/** Approuve ou suspend un chauffeur. */
export async function setDriverValidation(driverId: string, status: 'approved' | 'rejected' | 'suspended') {
  const { error } = await supabase.from('drivers').update({ validation_status: status }).eq('id', driverId);
  if (error) throw error;
}

/**
 * Met à jour les informations d'un véhicule (plaque, marque, modèle).
 * Réservé au BackOffice admin : les chauffeurs n'ont pas accès à cette
 * mutation depuis leur propre interface (lecture seule côté DriverDashboard).
 */
export async function updateVehicle(
  vehicleId: string,
  patch: { plate?: string; brand?: string | null; model?: string | null }
) {
  const { error } = await supabase.from('vehicles').update(patch).eq('id', vehicleId);
  if (error) throw error;
}

/**
 * Déclenche l'envoi d'un email de réinitialisation de mot de passe à un
 * chauffeur. Réservé au BackOffice admin : seul l'admin peut initier ce flux
 * pour un chauffeur (le chauffeur ne peut pas changer son mot de passe
 * lui-même depuis son propre tableau de bord).
 */
export async function resetDriverPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}
