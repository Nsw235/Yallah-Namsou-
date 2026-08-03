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
  avatar_url: string | null;
  rating_avg: number;
  validation_status: string;
};

/** Profil chauffeur + ses véhicules. */
export async function getMyDriverData(userId: string) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, phone, avatar_url')
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
    profile: profile as { full_name: string | null; phone: string | null; avatar_url: string | null },
    driver: driver as { rating_avg: number; validation_status: string },
    vehicles: (vehicles ?? []) as MyVehicle[],
  };
}

/**
 * Upload la photo de profil du chauffeur vers le bucket "avatars" (chemin
 * {userId}/avatar.{ext}) et met à jour profiles.avatar_url avec l'URL
 * publique (suffixée d'un cache-buster pour forcer le rafraîchissement
 * visuel immédiat après remplacement).
 */
export async function updateMyAvatar(userId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = `${pub.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
  if (updateError) throw updateError;

  return url;
}

/** Change le statut d'un véhicule (en ligne / hors ligne / en course). */
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
  const trips = (data ?? []) as Trip[];
  if (trips.length === 0) return trips;

  // RLS sur `profiles` n'autorise un chauffeur à lire le profil d'un passager
  // qu'une fois la course acceptée : pour les courses "pending" (avant
  // acceptation), on passe par cette fonction security definer, qui n'expose
  // que le nom (jamais le téléphone) et seulement pour des courses réellement pending.
  const { data: names, error: namesError } = await supabase.rpc('get_passenger_names_for_pending_trips', {
    trip_ids: trips.map((t) => t.id),
  });
  if (namesError) {
    // Ne bloque pas l'affichage des courses si les noms échouent à charger.
    return trips.map((t) => ({ ...t, passenger_profile: null }));
  }
  const byId = new Map<string, { full_name: string | null }>(
    (names ?? []).map((n: any) => [n.passenger_id as string, { full_name: n.full_name as string | null }])
  );
  return trips.map((t) => ({ ...t, passenger_profile: byId.get(t.passenger_id) ?? null }));
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

/**
 * Le chauffeur tente d'accepter une course en attente. Premier arrivé,
 * premier servi : l'UPDATE ne peut réussir que si la course est encore
 * "pending" et sans chauffeur (contrainte imposée par la policy RLS
 * `trips_accept_by_approved_driver`). Si un autre chauffeur a été plus
 * rapide, aucune ligne n'est retournée -> on le signale à l'appelant.
 */
export async function acceptTrip(tripId: string, driverId: string, vehicleId: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from('trips')
    .update({ driver_id: driverId, vehicle_id: vehicleId, status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', tripId)
    .eq('status', 'pending')
    .is('driver_id', null)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return null; // course déjà prise par un autre chauffeur

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

/** Consulte le paiement associé à une course (méthode choisie par le passager). */
export async function getTripPayment(tripId: string): Promise<{ method: string; status: string } | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('method, status')
    .eq('trip_id', tripId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Nom et téléphone du passager d'une course, affichés sur les cartes chauffeur. */
export async function getPassengerContact(passengerId: string): Promise<{ full_name: string | null; phone: string | null } | null> {
  const { data, error } = await supabase.from('profiles').select('full_name, phone').eq('id', passengerId).single();
  if (error) return null;
  return data ?? null;
}

/** Nom du passager d'une course, affiché sur les cartes chauffeur. */
export async function getPassengerName(passengerId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('full_name').eq('id', passengerId).single();
  if (error) return null;
  return data?.full_name ?? null;
}

/** Le chauffeur annule une course qu'il a acceptée (avant le départ). */
export async function cancelTripAsDriver(tripId: string, vehicleId: string) {
  const { error } = await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
  if (error) throw error;
  await setVehicleStatus(vehicleId, 'available');
}

/** Termine la course, fixe le prix final, la distance parcourue et libère le véhicule. */
export async function finishTrip(
  tripId: string,
  vehicleId: string,
  finalPrice: number,
  distanceKm?: number | null
): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      final_price: finalPrice,
      distance_km: distanceKm ?? null,
    })
    .eq('id', tripId)
    .select()
    .single();
  if (error) throw error;

  await supabase.from('payments').update({ amount: finalPrice }).eq('trip_id', tripId);
  await setVehicleStatus(vehicleId, 'available');
  return data as Trip;
}

/** Le chauffeur note le passager après le résumé de course (étoiles + commentaire + tag bonus). */
export async function submitRating(
  tripId: string,
  ratedBy: string,
  rating: number,
  comment: string | null,
  tag: 'client_sympa' | 'aucun' | null
) {
  const { error } = await supabase
    .from('ratings')
    .insert({ trip_id: tripId, rated_by: ratedBy, rating, comment, tag });
  if (error) throw error;
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

/**
 * Écoute en temps réel (Supabase Realtime) les courses de la table `trips`.
 * Utilisé par le tableau de bord chauffeur pour être notifié instantanément
 * d'une nouvelle demande "pending", ou de la disparition d'une course prise
 * par un collègue (mise à jour de la liste sans recharger la page).
 */
export function subscribeToTripChanges(
  onChange: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; trip: Trip }) => void
): () => void {
  const channel = supabase
    .channel('driver-trips-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, (payload) => {
      const trip = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Trip;
      onChange({ eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', trip });
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Démarre le partage GPS temps réel du chauffeur : suit sa position via
 * navigator.geolocation.watchPosition et la pousse dans public.vehicles
 * (last_lat/last_lng), lue en Realtime côté passager pendant la course.
 * Retourne une fonction d'arrêt à appeler au démontage ou en passant hors-ligne.
 */
export function startSharingLocation(
  vehicleId: string,
  onPosition?: (pos: { lat: number; lng: number }) => void
): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return () => {};

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onPosition?.({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      supabase
        .from('vehicles')
        .update({
          last_lat: pos.coords.latitude,
          last_lng: pos.coords.longitude,
          updated_at: new Date().toISOString(),
        })
        .eq('id', vehicleId)
        .then(() => {});
    },
    () => {
      // géolocalisation refusée ou indisponible : on ignore silencieusement
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
