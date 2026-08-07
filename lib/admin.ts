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
  driver_phone?: string | null;
  driver_avatar?: string | null;
  passenger_capacity?: number;
  last_lat: number | null;
  last_lng: number | null;
};

/** Vue d'ensemble de la flotte : chaque véhicule, son statut, son chauffeur. */
export async function getFleetOverview(): Promise<FleetVehicle[]> {
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, type, plate, brand, model, status, driver_id, passenger_capacity, last_lat, last_lng');
  if (error) throw error;
  if (!vehicles || vehicles.length === 0) return [];

  const driverIds = Array.from(new Set(vehicles.map((v) => v.driver_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, phone, avatar_url')
    .in('id', driverIds);
  if (profilesError) throw profilesError;

  return vehicles.map((v) => {
    const p = profiles?.find((pr) => pr.id === v.driver_id);
    return {
      ...v,
      driver_name: p?.full_name ?? null,
      driver_phone: p?.phone ?? null,
      driver_avatar: p?.avatar_url ?? null,
    };
  });
}

/** Change uniquement le statut d'un véhicule (ex: mise hors ligne manuelle par l'admin). */
export async function updateVehicleStatus(vehicleId: string, status: 'offline' | 'available' | 'busy') {
  const { error } = await supabase.from('vehicles').update({ status }).eq('id', vehicleId);
  if (error) throw error;
}

/**
 * Écoute en temps réel les changements sur `vehicles` (statut, position GPS)
 * ET sur `trips` (nouvelle course, changement de statut) pour que la
 * supervision admin (liste flotte + courses actives + carte) se mette à
 * jour sans recharger la page, y compris quand aucun véhicule ne bouge.
 */
export function subscribeToFleetChanges(onChange: () => void): () => void {
  const channel = supabase
    .channel('admin-fleet-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => onChange())
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
  patch: { plate?: string; brand?: string | null; model?: string | null; passenger_capacity?: number }
) {
  const { error } = await supabase.from('vehicles').update(patch).eq('id', vehicleId);
  if (error) throw error;
}

/**
 * Ajoute un nouveau véhicule à la flotte, assigné à un chauffeur existant.
 */
export async function createVehicle(input: {
  driver_id: string;
  type: 'berline' | 'van' | 'suv';
  plate: string;
  brand?: string | null;
  model?: string | null;
  passenger_capacity?: number;
}) {
  const { error } = await supabase.from('vehicles').insert({
    driver_id: input.driver_id,
    type: input.type,
    plate: input.plate,
    brand: input.brand ?? null,
    model: input.model ?? null,
    passenger_capacity: input.passenger_capacity ?? 4,
    status: 'available',
  });
  if (error) throw error;
}

/**
 * Retire un véhicule de la flotte (retrait "logique" : on ne supprime pas la
 * ligne, car des courses passées peuvent y faire référence). On s'appuie sur
 * la colonne `status` déjà présente en base plutôt que sur une colonne
 * `is_active` séparée (non déployée sur toutes les instances) : le véhicule
 * passe hors ligne et n'apparaît plus comme assignable à une course.
 */
export async function removeVehicle(vehicleId: string) {
  const { error } = await supabase.from('vehicles').update({ status: 'offline' }).eq('id', vehicleId);
  if (error) throw error;
}

export type VehicleTripHistoryRow = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string;
  estimated_price: number | null;
  final_price: number | null;
  requested_at: string;
  completed_at: string | null;
  passenger_name: string | null;
};

/** Historique des courses effectuées par un véhicule donné (les plus récentes d'abord). */
export async function getVehicleTripHistory(vehicleId: string, limit = 15): Promise<VehicleTripHistoryRow[]> {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, pickup_address, dropoff_address, status, estimated_price, final_price, requested_at, completed_at, passenger_id')
    .eq('vehicle_id', vehicleId)
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!trips || trips.length === 0) return [];

  const passengerIds = Array.from(new Set(trips.map((t) => t.passenger_id).filter(Boolean)));
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', passengerIds as string[]);
  if (profilesError) throw profilesError;

  return trips.map((t) => ({
    id: t.id,
    pickup_address: t.pickup_address,
    dropoff_address: t.dropoff_address,
    status: t.status,
    estimated_price: t.estimated_price,
    final_price: t.final_price,
    requested_at: t.requested_at,
    completed_at: t.completed_at,
    passenger_name: profiles?.find((p) => p.id === t.passenger_id)?.full_name ?? null,
  }));
}

/**
 * Envoie une notification à la flotte. Enregistrée en base (table
 * fleet_notifications) pour garder une trace et pouvoir la diffuser aux
 * apps chauffeur (via Realtime/push) dans un second temps.
 */
export async function sendFleetNotification(message: string, senderId: string, recipientCount: number) {
  const { error } = await supabase
    .from('fleet_notifications')
    .insert({ message, sent_by: senderId, recipient_count: recipientCount });
  if (error) throw error;
}

/**
 * Planifie une maintenance pour un ou plusieurs véhicules : enregistre la
 * planification et passe chaque véhicule hors ligne (il ne doit plus
 * recevoir de courses tant que la maintenance est en cours).
 */
export async function scheduleMaintenance(vehicleIds: string[], scheduledDate: string, adminId: string, note?: string) {
  if (vehicleIds.length === 0) throw new Error('Sélectionnez au moins un véhicule.');
  const { error: insertError } = await supabase
    .from('vehicle_maintenance')
    .insert(vehicleIds.map((vehicle_id) => ({ vehicle_id, scheduled_date: scheduledDate, created_by: adminId, note: note || null })));
  if (insertError) throw insertError;

  const { error: statusError } = await supabase.from('vehicles').update({ status: 'offline' }).in('id', vehicleIds);
  if (statusError) throw statusError;
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

/**
 * Met à jour le profil (nom, téléphone) et/ou les infos chauffeur (permis)
 * d'un chauffeur donné. Réservé au BackOffice admin.
 */
export async function updateDriverInfo(
  driverId: string,
  patch: { full_name?: string; phone?: string; license_number?: string | null }
) {
  const { full_name, phone, ...driverPatch } = patch;
  if (full_name !== undefined || phone !== undefined) {
    const profilePatch: Record<string, string> = {};
    if (full_name !== undefined) profilePatch.full_name = full_name;
    if (phone !== undefined) profilePatch.phone = phone;
    const { error } = await supabase.from('profiles').update(profilePatch).eq('id', driverId);
    if (error) throw error;
  }
  if (Object.keys(driverPatch).length > 0) {
    const { error } = await supabase.from('drivers').update(driverPatch).eq('id', driverId);
    if (error) throw error;
  }
}

/**
 * Change le mot de passe d'un chauffeur via la route serveur
 * /api/admin/driver-password (clé service_role, jamais exposée au client).
 */
export async function adminSetDriverPassword(driverId: string, newPassword: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Session invalide.');

  const res = await fetch('/api/admin/driver-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ driverId, newPassword }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? 'Échec du changement de mot de passe.');
}

/**
 * Crée un nouveau chauffeur (compte auth + profil + fiche chauffeur) via la
 * route serveur /api/admin/create-driver (clé service_role).
 */
export async function adminCreateDriver(input: {
  fullName: string;
  phone?: string;
  email: string;
  password: string;
  licenseNumber?: string;
}): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Session invalide.');

  const res = await fetch('/api/admin/create-driver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      password: input.password,
      licenseNumber: input.licenseNumber,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? 'Échec de la création du chauffeur.');
  return body.driverId as string;
}

/**
 * Upload la photo de profil d'un chauffeur (bucket "avatars") pour le
 * compte de l'admin. Nécessite une policy de storage autorisant le rôle
 * admin à écrire dans le dossier {driverId}/ du bucket.
 */
export async function adminUpdateDriverAvatar(driverId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${driverId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = `${pub.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', driverId);
  if (updateError) throw updateError;

  return url;
}

export type DriverDetail = {
  id: string;
  full_name: string | null;
  phone: string | null;
  license_number: string | null;
  avatar_url: string | null;
  rating_avg: number;
  validation_status: string;
  completed_trips: number;
  cancelled_trips: number;
  revenue_total: number;
  vehicles: FleetVehicle[];
};

/** Fiche complète de chaque chauffeur : profil, stats, véhicules assignés. */
export async function getDriverDetails(): Promise<DriverDetail[]> {
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('id, license_number, rating_avg, validation_status');
  if (error) throw error;
  if (!drivers || drivers.length === 0) return [];

  const ids = drivers.map((d) => d.id);

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, phone, avatar_url')
    .in('id', ids);
  if (profilesError) throw profilesError;

  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select('driver_id, status, estimated_price, final_price')
    .in('driver_id', ids);
  if (tripsError) throw tripsError;

  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, type, plate, brand, model, status, driver_id, passenger_capacity, last_lat, last_lng')
    .in('driver_id', ids);
  if (vehiclesError) throw vehiclesError;

  return drivers.map((d) => {
    const profile = profiles?.find((p) => p.id === d.id);
    const driverTrips = (trips ?? []).filter((t) => t.driver_id === d.id);
    const completed = driverTrips.filter((t) => t.status === 'completed');
    const cancelled = driverTrips.filter((t) => t.status === 'cancelled');

    return {
      id: d.id,
      full_name: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      license_number: d.license_number,
      avatar_url: profile?.avatar_url ?? null,
      rating_avg: d.rating_avg,
      validation_status: d.validation_status,
      completed_trips: completed.length,
      cancelled_trips: cancelled.length,
      revenue_total: completed.reduce((s, t) => s + Number(t.final_price ?? t.estimated_price ?? 0), 0),
      vehicles: (vehicles ?? [])
        .filter((v) => v.driver_id === d.id)
        .map((v) => ({
          ...v,
          driver_name: profile?.full_name ?? null,
          driver_phone: profile?.phone ?? null,
          driver_avatar: profile?.avatar_url ?? null,
        })),
    };
  });
}

export type DailyPoint = { date: string; revenue: number; trips: number; cancelled: number };

/** Série jour par jour (revenus/courses/annulations) sur les N derniers jours. */
export async function getAnalyticsSeries(days: number): Promise<DailyPoint[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const { data, error } = await supabase
    .from('trips')
    .select('status, estimated_price, final_price, requested_at')
    .gte('requested_at', start.toISOString());
  if (error) throw error;
  const rows = data ?? [];

  const points: DailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayRows = rows.filter((t) => (t.requested_at as string).slice(0, 10) === dateStr);
    const cancelled = dayRows.filter((t) => t.status === 'cancelled').length;
    const revenue = dayRows
      .filter((t) => ['accepted', 'in_progress', 'completed'].includes(t.status))
      .reduce((s, t) => s + Number(t.final_price ?? t.estimated_price ?? 0), 0);
    points.push({ date: dateStr, revenue, trips: dayRows.length, cancelled });
  }
  return points;
}

export type PaymentBreakdown = { method: string; total: number; count: number };

/** Répartition des paiements confirmés par méthode (cash / airtel / moov). */
export async function getPaymentBreakdown(): Promise<PaymentBreakdown[]> {
  const { data, error } = await supabase.from('payments').select('method, amount').eq('status', 'paid');
  if (error) throw error;

  const map = new Map<string, { total: number; count: number }>();
  (data ?? []).forEach((p) => {
    const cur = map.get(p.method) ?? { total: 0, count: 0 };
    cur.total += Number(p.amount ?? 0);
    cur.count += 1;
    map.set(p.method, cur);
  });
  return Array.from(map.entries()).map(([method, v]) => ({ method, ...v }));
}

/** Grille tarifaire (réexportée ici pour @/lib/admin, source de vérité : @/lib/rides). */
export { getPricingRules } from '@/lib/rides';

/** Met à jour un tarif (prise en charge, prix/km, multiplicateur heures de pointe). */
export async function updatePricingRule(
  id: string,
  patch: { base_fare: number; price_per_km: number; peak_multiplier: number }
) {
  const { error } = await supabase.from('pricing_rules').update(patch).eq('id', id);
  if (error) throw error;
}
