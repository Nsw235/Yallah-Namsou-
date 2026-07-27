import { supabase } from '@/lib/supabaseClient';
import { PricingRule, Trip, TripWithDriver, VehicleType } from '@/types/database';
import { DEMO_ROUTE } from '@/lib/pricing';

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
}): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert({
      passenger_id: params.passengerId,
      vehicle_type: params.vehicleType,
      pickup_lat: DEMO_ROUTE.pickup.lat,
      pickup_lng: DEMO_ROUTE.pickup.lng,
      pickup_address: DEMO_ROUTE.pickup.address,
      dropoff_lat: DEMO_ROUTE.dropoff.lat,
      dropoff_lng: DEMO_ROUTE.dropoff.lng,
      dropoff_address: DEMO_ROUTE.dropoff.address,
      estimated_price: params.estimatedPrice,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data as Trip;
}

/**
 * Cherche un chauffeur approuvé et disponible pour le type de véhicule demandé,
 * puis l'assigne à la course (équivalent de "un chauffeur accepte la course").
 *
 * NB : dans une vraie appli de production, cette étape se ferait côté chauffeur
 * (son propre appareil accepte la course) ou via une fonction serveur sécurisée.
 * Ici, pour la démo passager seul, le client assigne directement le chauffeur.
 */
export async function findAndAssignDriver(tripId: string, vehicleType: VehicleType) {
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, driver_id, plate, brand, model, status, type')
    .eq('type', vehicleType)
    .eq('status', 'available')
    .limit(1)
    .maybeSingle();

  if (vehicleError) throw vehicleError;
  if (!vehicle) {
    throw new Error('Aucun chauffeur disponible pour ce type de véhicule pour le moment.');
  }

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, rating_avg, validation_status')
    .eq('id', vehicle.driver_id)
    .eq('validation_status', 'approved')
    .single();
  if (driverError) throw driverError;

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .update({
      driver_id: driver.id,
      vehicle_id: vehicle.id,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .select()
    .single();
  if (tripError) throw tripError;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', driver.id)
    .single();
  if (profileError) throw profileError;

  return {
    trip: trip as Trip,
    driver: { ...driver, ...profile },
    vehicle,
  };
}

/** Passe la course en "en cours" (le passager est monté à bord). */
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

/** Termine la course, enregistre le prix final et crée l'enregistrement de paiement cash. */
export async function completeTrip(tripId: string, finalPrice: number): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      final_price: finalPrice,
    })
    .eq('id', tripId)
    .select()
    .single();
  if (error) throw error;

  // Le paiement espèces est enregistré "pending" : c'est le chauffeur qui
  // confirmera l'encaissement (policy RLS dédiée côté chauffeur).
  const { error: paymentError } = await supabase.from('payments').insert({
    trip_id: tripId,
    method: 'cash',
    amount: finalPrice,
    status: 'pending',
  });
  if (paymentError) throw paymentError;

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
