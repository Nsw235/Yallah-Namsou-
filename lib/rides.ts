import { supabase } from '@/lib/supabaseClient';
import {
  PaymentMethod,
  PricingRule,
  Trip,
  TripMessage,
  TripMessageSenderRole,
  TripWithDriver,
  VehicleType,
} from '@/types/database';
import { GeoResult } from '@/lib/geocode';
import { sendPushNotification } from '@/lib/push';

/** Récupère la grille tarifaire (une ligne par type de véhicule). */
export async function getPricingRules(): Promise<PricingRule[]> {
  const { data, error } = await supabase.from('pricing_rules').select('*');
  if (error) throw error;
  return data as PricingRule[];
}

export type AvailableVehicle = {
  id: string;
  type: VehicleType;
  last_lat: number | null;
  last_lng: number | null;
};

/**
 * Véhicules actuellement "available" (en ligne, sans course), avec position
 * GPS connue. Utilisé pour afficher les voitures dispos sur la carte du
 * passager avant même qu'il ait choisi sa destination.
 */
export async function getAvailableVehicles(): Promise<AvailableVehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, type, last_lat, last_lng')
    .eq('status', 'available')
    .not('last_lat', 'is', null)
    .not('last_lng', 'is', null);
  if (error) throw error;
  return (data ?? []) as AvailableVehicle[];
}

/** Écoute en temps réel les véhicules dispos (position, statut) pour la carte passager. */
export function subscribeToAvailableVehicles(onChange: () => void): () => void {
  const channel = supabase
    .channel('passenger-available-vehicles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => onChange())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Crée une nouvelle course "pending" + son paiement associé, avec la méthode
 * choisie par le passager AVANT le départ (comme dans le vrai flux Uber).
 * La course est immédiatement visible de tous les chauffeurs disponibles du
 * bon type de véhicule via Supabase Realtime.
 */
export async function createTrip(params: {
  passengerId: string;
  vehicleType: VehicleType;
  estimatedPrice: number;
  pickup: GeoResult;
  dropoff: GeoResult;
  paymentMethod: PaymentMethod;
  paymentPhone?: string;
}): Promise<Trip> {
  const { data: trip, error } = await supabase
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

  const { error: paymentError } = await supabase.from('payments').insert({
    trip_id: trip.id,
    method: params.paymentMethod,
    amount: params.estimatedPrice,
    status: 'pending',
    provider_reference: params.paymentPhone ?? null,
  });
  if (paymentError) throw paymentError;

  // Notifie tous les chauffeurs en ligne dont le véhicule correspond au type
  // demandé — best-effort, ne bloque jamais la création de la course.
  const { data: availableDrivers } = await supabase
    .from('vehicles')
    .select('driver_id')
    .eq('status', 'available')
    .eq('type', params.vehicleType);
  const driverIds = Array.from(new Set((availableDrivers ?? []).map((v) => v.driver_id).filter(Boolean)));
  sendPushNotification(driverIds, 'Nouvelle course disponible', `${params.pickup.address ?? 'Départ'} → ${params.dropoff.address ?? 'Destination'}`, '/chauffeur');

  return trip as Trip;
}

/** Annule une course encore en attente (avant qu'un chauffeur ne l'accepte). */
export async function cancelTrip(tripId: string) {
  const { error } = await supabase.rpc('cancel_my_pending_trip', { p_trip_id: tripId });
  if (error) throw error;
}

/**
 * Force une vérification immédiate des courses "pending" dont le délai de
 * recherche est dépassé (elles sont alors annulées automatiquement côté
 * serveur). Un job planifié (pg_cron) le fait déjà toutes les 20 secondes ;
 * cet appel est un filet de sécurité côté client, déclenché quand le
 * compte à rebours affiché à l'écran arrive à zéro, pour ne pas dépendre
 * uniquement du timing du job.
 */
export async function expireStaleTrips() {
  const { error } = await supabase.rpc('expire_stale_trips');
  if (error) throw error;
}

/**
 * Retrouve la course en cours du passager (pending/accepted/in_progress),
 * s'il y en a une. Utilisé au chargement de l'app pour reverrouiller
 * automatiquement l'écran sur cette course après un rafraîchissement de
 * page, un crash de l'onglet, ou une réouverture de l'app — le passager ne
 * doit jamais pouvoir "perdre" une course en cours en rechargeant.
 */
export async function getActiveTripForPassenger(passengerId: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('passenger_id', passengerId)
    .in('status', ['pending', 'accepted', 'in_progress'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Trip) ?? null;
}

/** Charge une course par son id (pour rafraîchir l'état après un événement realtime). */
export async function getTrip(tripId: string): Promise<Trip> {
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) throw error;
  return data as Trip;
}

/** Infos chauffeur + véhicule assigné à une course (une fois acceptée). */
export async function getDriverAndVehicle(driverId: string, vehicleId: string) {
  const [{ data: profile, error: profileError }, { data: driver, error: driverError }, { data: vehicle, error: vehicleError }] =
    await Promise.all([
      supabase.from('profiles').select('full_name, phone').eq('id', driverId).single(),
      supabase.from('drivers').select('rating_avg').eq('id', driverId).single(),
      supabase.from('vehicles').select('id, plate, brand, model, last_lat, last_lng').eq('id', vehicleId).single(),
    ]);
  if (profileError) throw profileError;
  if (driverError) throw driverError;
  if (vehicleError) throw vehicleError;

  return {
    driver: {
      id: driverId,
      full_name: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      rating_avg: driver?.rating_avg ?? 5,
    },
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
      current_lat: vehicle.last_lat as number | null,
      current_lng: vehicle.last_lng as number | null,
    },
  };
}

/**
 * Écoute en temps réel une course précise (id connu) : le passager est
 * notifié instantanément quand un chauffeur l'accepte, démarre le trajet,
 * ou le termine — sans avoir à recharger la page.
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
 * Écoute en temps réel la position GPS du véhicule assigné (mise à jour par
 * le chauffeur via startSharingLocation) pour l'afficher en direct côté
 * passager (écrans "chauffeur arrive" / "en course").
 */
export function subscribeToVehicleLocation(
  vehicleId: string,
  onUpdate: (pos: { lat: number; lng: number }) => void
): () => void {
  const channel = supabase
    .channel(`vehicle-location-${vehicleId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'vehicles', filter: `id=eq.${vehicleId}` },
      (payload) => {
        const v = payload.new as { last_lat: number | null; last_lng: number | null };
        if (v.last_lat != null && v.last_lng != null) {
          onUpdate({ lat: v.last_lat, lng: v.last_lng });
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Le passager confirme avoir effectué le transfert Airtel Money / Moov Money. */
export async function confirmMobilePayment(tripId: string, method: 'airtel_money' | 'moov_money') {
  const { error } = await supabase
    .from('payments')
    .update({ status: 'paid' })
    .eq('trip_id', tripId)
    .eq('method', method);
  if (error) throw error;
}

/** Enregistre la note laissée par le passager pour cette course. */
export async function rateTrip(tripId: string, ratedBy: string, rating: number) {
  const { error } = await supabase.from('ratings').insert({ trip_id: tripId, rated_by: ratedBy, rating });
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

/* ------------------------------------------------------------------------ */
/* Messagerie in-app (course active)                                        */
/* ------------------------------------------------------------------------ */

/** Historique des messages échangés sur une course, du plus ancien au plus récent. */
export async function getTripMessages(tripId: string): Promise<TripMessage[]> {
  const { data, error } = await supabase
    .from('trip_messages')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TripMessage[];
}

/**
 * Envoie un message in-app sur la course. `senderRole` doit correspondre au
 * rôle réel de l'expéditeur sur cette course précise (vérifié aussi côté
 * base par la policy RLS trip_messages_insert_participants).
 */
export async function sendTripMessage(
  tripId: string,
  senderId: string,
  senderRole: TripMessageSenderRole,
  body: string
): Promise<TripMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message vide.');
  const { data, error } = await supabase
    .from('trip_messages')
    .insert({ trip_id: tripId, sender_id: senderId, sender_role: senderRole, body: trimmed })
    .select('*')
    .single();
  if (error) throw error;
  return data as TripMessage;
}

/**
 * Écoute en temps réel les nouveaux messages d'une course — utilisée des
 * deux côtés (passager et chauffeur) pour afficher la conversation en
 * direct sans recharger, sur le même principe que subscribeToTrip.
 */
export function subscribeToTripMessages(
  tripId: string,
  onMessage: (message: TripMessage) => void
): () => void {
  const channel = supabase
    .channel(`trip-messages-${tripId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` },
      (payload) => onMessage(payload.new as TripMessage)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
