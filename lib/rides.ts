import { supabase } from '@/lib/supabaseClient';
import { PaymentMethod, PricingRule, Trip, TripWithDriver, VehicleType } from '@/types/database';
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

/** Assigne le chauffeur choisi par le passager à la course. */
export async function assignDriver(tripId: string, driverId: string, vehicleId: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({
      driver_id: driverId,
      vehicle_id: vehicleId,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .select()
    .single();
  if (error) throw error;
  return data as Trip;
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

/**
 * Termine la course, enregistre le prix final et crée l'enregistrement de
 * paiement pour la méthode choisie par le passager (cash, Airtel Money ou
 * Moov Money). Le paiement est toujours créé "pending" :
 *  - cash        -> confirmé par le chauffeur (encaissement) via confirmCashPayment
 *  - mobile money -> confirmé par le passager (transfert effectué de son côté)
 *                    via confirmMobilePayment, une fois le transfert réalisé.
 */
export async function completeTrip(
  tripId: string,
  finalPrice: number,
  method: PaymentMethod = 'cash',
  providerReference?: string
): Promise<Trip> {
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

  const { error: paymentError } = await supabase.from('payments').insert({
    trip_id: tripId,
    method,
    amount: finalPrice,
    status: 'pending',
    provider_reference: providerReference ?? null,
  });
  if (paymentError) throw paymentError;

  return data as Trip;
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
