'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Compass,
  Star,
  ThumbsUp,
  Home,
  History,
  Wallet,
  User as UserIcon,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  CornerUpLeft,
  CornerUpRight,
  RotateCcw,
  Flag,
  ChevronUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Trip, VehicleType } from '@/types/database';
import { formatFCFA, haversineKm, VEHICLE_LABELS } from '@/lib/pricing';
import {
  MyDriverProfile,
  MyVehicle,
  acceptTrip,
  cancelTripAsDriver,
  finishTrip,
  getMyActiveTrip,
  getMyDriverData,
  getMyTripHistory,
  getPassengerContact,
  getPendingTrips,
  setVehicleStatus,
  startSharingLocation,
  startTrip,
  submitRating,
  subscribeToTripChanges,
} from '@/lib/driver';
import AuthGate from '@/components/AuthGate';
import RealMap, { type NavigationStep } from '@/components/RealMap';

const VEHICLE_TYPES: VehicleType[] = ['berline', 'van', 'suv'];

/** Modèle 3D (.glb) à afficher pour le véhicule du chauffeur, selon son type. */
const CAR_MODEL_BY_TYPE: Record<VehicleType, string> = {
  berline: '/models/berline.glb',
  van: '/models/van.glb',
  suv: '/models/suv.glb',
};

function playNotificationBeep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // silencieux si l'audio est bloqué
  }
}

function initials(name: string | null) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Icône de manœuvre pour la bannière de guidage, selon le type/modificateur Mapbox Directions. */
function ManeuverIcon({ type, modifier, size = 18 }: { type: string; modifier?: string; size?: number }) {
  if (type === 'arrive') return <Flag size={size} />;
  if (type === 'roundabout' || type === 'rotary') return <RotateCcw size={size} />;
  if (modifier?.includes('uturn')) return <RotateCcw size={size} />;
  if (modifier?.includes('left')) return modifier === 'slight left' ? <ArrowUp size={size} /> : <CornerUpLeft size={size} />;
  if (modifier?.includes('right')) return modifier === 'slight right' ? <ArrowUp size={size} /> : <CornerUpRight size={size} />;
  return <ArrowUp size={size} />;
}

/** "230 m" ou "1.4 km" selon la distance restante jusqu'à la prochaine manœuvre. */
function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
}

export default function DriverDashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<MyDriverProfile | null>(null);
  const [vehicles, setVehicles] = useState<MyVehicle[]>([]);
  const [pending, setPending] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [summaryTrip, setSummaryTrip] = useState<Trip | null>(null);
  const [passengerContact, setPassengerContact] = useState<{ full_name: string | null; phone: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newRequestAlert, setNewRequestAlert] = useState(false);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [ratingStars, setRatingStars] = useState(4);
  const [ratingTag, setRatingTag] = useState<'client_sympa' | 'aucun'>('aucun');
  const [comment, setComment] = useState('');
  const [bottomTab, setBottomTab] = useState<'accueil' | 'historique' | 'gains' | 'profil'>('accueil');
  const [history, setHistory] = useState<Trip[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [navInfo, setNavInfo] = useState<NavigationStep | null>(null);
  const [tripCardExpanded, setTripCardExpanded] = useState(false);

  useEffect(() => {
    setTripCardExpanded(false);
  }, [active?.id]);
  const [autoValidateCountdown, setAutoValidateCountdown] = useState<number | null>(null);
  const gpsStopFns = useRef<Record<string, () => void>>({});
  const summaryFormRef = useRef({ ratingStars, ratingTag, comment });
  const autoValidateIntervalRef = useRef<number | null>(null);

  const AUTO_VALIDATE_SECONDS = 6;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      Object.values(gpsStopFns.current).forEach((stop) => stop());
      gpsStopFns.current = {};
    };
  }, []);

  useEffect(() => {
    summaryFormRef.current = { ratingStars, ratingTag, comment };
  }, [ratingStars, ratingTag, comment]);

  useEffect(() => {
    if (!summaryTrip || !session?.user) {
      setAutoValidateCountdown(null);
      return;
    }
    const trip = summaryTrip;
    const userId = session.user.id;
    setAutoValidateCountdown(AUTO_VALIDATE_SECONDS);
    const interval = window.setInterval(() => {
      setAutoValidateCountdown((s) => {
        if (s === null) return null;
        if (s <= 1) {
          window.clearInterval(interval);
          void validateSummary(trip, userId);
          return null;
        }
        return s - 1;
      });
    }, 1000);
    autoValidateIntervalRef.current = interval;
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryTrip?.id, session?.user?.id]);

  async function refreshAll(userId: string) {
    try {
      const { profile: p, driver, vehicles: v } = await getMyDriverData(userId);
      setProfile({ ...p, rating_avg: driver.rating_avg, validation_status: driver.validation_status });
      setVehicles(v);
      const [pendingTrips, activeTrip] = await Promise.all([getPendingTrips(), getMyActiveTrip(userId)]);
      setPending(pendingTrips);
      setActive(activeTrip);
      if (activeTrip?.passenger_id) {
        getPassengerContact(activeTrip.passenger_id).then(setPassengerContact);
      }

      v.forEach((veh) => {
        if (veh.status !== 'offline' && !gpsStopFns.current[veh.id]) {
          gpsStopFns.current[veh.id] = startSharingLocation(veh.id, setDriverPos);
        }
      });
    } catch (e: any) {
      setError(e?.message ?? 'Erreur de chargement.');
    }
  }

  useEffect(() => {
    if (session?.user) refreshAll(session.user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return;
    if ((bottomTab === 'historique' || bottomTab === 'gains') && !historyLoaded) {
      setHistoryLoading(true);
      getMyTripHistory(session.user.id)
        .then((trips) => {
          setHistory(trips);
          setHistoryLoaded(true);
        })
        .catch((e: any) => setError(e?.message ?? "Impossible de charger l'historique."))
        .finally(() => setHistoryLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab, session?.user?.id]);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
  }

  useEffect(() => {
    if (!session?.user) return;
    const userId = session.user.id;
    const unsubscribe = subscribeToTripChanges(({ eventType, trip }) => {
      if (eventType === 'INSERT' && trip.status === 'pending') {
        setNewRequestAlert(true);
        playNotificationBeep();
        window.setTimeout(() => setNewRequestAlert(false), 4000);
      }
      refreshAll(userId);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const myVehicle = vehicles[0];
  const online = myVehicle?.status !== 'offline';

  async function handleToggleOnline() {
    if (!myVehicle) return;
    setBusy(true);
    try {
      const next = myVehicle.status === 'offline' ? 'available' : 'offline';
      await setVehicleStatus(myVehicle.id, next);
      if (session?.user) await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de changer le statut.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(trip: Trip) {
    if (!session?.user) return;
    const v = vehicles.find((x) => x.type === trip.vehicle_type && x.status === 'available');
    if (!v) {
      setError("Aucun véhicule disponible pour ce type (passez en ligne).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptTrip(trip.id, session.user.id, v.id);
      if (!accepted) setError('Trop tard : un autre chauffeur a déjà accepté cette course.');
      await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'accepter cette course.");
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss(tripId: string) {
    setDismissed((d) => [...d, tripId]);
  }

  async function handleArrive() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await startTrip(active.id);
      if (session?.user) await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de démarrer la course.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!active || !active.vehicle_id) return;
    setBusy(true);
    setError(null);
    try {
      await cancelTripAsDriver(active.id, active.vehicle_id);
      if (session?.user) await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'annuler la course.");
    } finally {
      setBusy(false);
    }
  }

  function openExternalNavigation() {
    if (!active) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${active.dropoff_lat},${active.dropoff_lng}`;
    window.open(url, '_blank');
  }

  async function handleFinish() {
    if (!active || !active.vehicle_id) return;
    setBusy(true);
    setError(null);
    try {
      const distanceKm = haversineKm(active.pickup_lat, active.pickup_lng, active.dropoff_lat, active.dropoff_lng);
      const finished = await finishTrip(active.id, active.vehicle_id, active.estimated_price ?? 0, distanceKm);
      setSummaryTrip(finished);
      setRatingStars(4);
      setRatingTag('aucun');
      setComment('');
      if (session?.user) await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de terminer la course.');
    } finally {
      setBusy(false);
    }
  }

  async function validateSummary(trip: Trip, userId: string) {
    setBusy(true);
    setError(null);
    try {
      const { ratingStars: rs, ratingTag: rt, comment: c } = summaryFormRef.current;
      await submitRating(trip.id, userId, rs, c || null, rt);
      setSummaryTrip(null);
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'enregistrer l'évaluation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleValidateSummary() {
    if (autoValidateIntervalRef.current !== null) {
      window.clearInterval(autoValidateIntervalRef.current);
      autoValidateIntervalRef.current = null;
    }
    setAutoValidateCountdown(null); // annule le décompte : validation manuelle immédiate
    if (!summaryTrip || !session?.user) return;
    await validateSummary(summaryTrip, session.user.id);
  }

  if (session === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#1c1108]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#e8c9a8] border-t-transparent" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-dvh bg-[#1c1108]">
        <AuthGate onAuthed={() => {}} />
      </div>
    );
  }
  if (profile && profile.validation_status !== 'approved') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#1c1108] p-6 text-center text-[#f2e9dd]">
        <div>
          <h2 className="text-lg font-extrabold">Compte en attente de validation</h2>
          <p className="mt-1 text-sm text-[#c9bba8]">
            Votre compte chauffeur doit être approuvé par un administrateur avant de recevoir des courses.
          </p>
        </div>
      </div>
    );
  }

  const step: 'available' | 'accepted' | 'in_progress' | 'summary' = summaryTrip
    ? 'summary'
    : active?.status === 'accepted'
      ? 'accepted'
      : active?.status === 'in_progress'
        ? 'in_progress'
        : 'available';

  const shownPending = pending.filter((t) => !dismissed.includes(t.id));
  const showCompass = step === 'in_progress' || step === 'summary';
  const displayTrip = summaryTrip ?? active;
  const elapsedMin =
    summaryTrip?.started_at && summaryTrip?.completed_at
      ? Math.max(1, Math.round((new Date(summaryTrip.completed_at).getTime() - new Date(summaryTrip.started_at).getTime()) / 60000))
      : null;

  // Vue "ciel visible" très inclinée (75°) + voiture 3D uniquement pendant la
  // course (aller chercher le client ou avec le client à bord). Le reste du
  // temps (Accueil, résumé de fin de course), une vue plus classique suffit.
  const onTrip = step === 'accepted' || step === 'in_progress';
  const mapPitch = onTrip ? 75 : 45;
  const myVehicleType: VehicleType = myVehicle?.type ?? 'berline';
  const carModelUrl = CAR_MODEL_BY_TYPE[myVehicleType];

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0d0906]">
      <div className="absolute inset-0">
        <RealMap
          pitch={mapPitch}
          buildings3d
          driverPosition={driverPos}
          use3dCar={onTrip}
          carModelUrl={carModelUrl}
          pickup={step === 'accepted' && active ? { lat: active.pickup_lat, lng: active.pickup_lng } : undefined}
          dropoff={
            (step === 'in_progress' || step === 'summary') && displayTrip
              ? { lat: displayTrip.dropoff_lat, lng: displayTrip.dropoff_lng }
              : step === 'accepted' && active
                ? { lat: active.pickup_lat, lng: active.pickup_lng }
                : undefined
          }
          showRoute={step === 'accepted' || step === 'in_progress'}
          routeColor="#4d9fff"
          onNavigationUpdate={onTrip ? setNavInfo : undefined}
        />
      </div>

      <div className="relative z-10 mt-3 ml-3 flex w-fit items-center gap-2.5 rounded-2xl bg-[#1c1108]/85 px-3 py-2 backdrop-blur">
        <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full border-2 border-[#e8c9a8] bg-[#e8c9a8]/20 text-xs font-extrabold text-[#e8c9a8]">
          {initials(profile?.full_name ?? null)}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-bold text-[#e8c9a8]">{profile?.full_name ?? 'Chauffeur'}</span>
          <span
            className={`text-[10px] font-extrabold ${
              step === 'available' && online
                ? 'text-[#5be08a]'
                : step === 'available' && !online
                  ? 'text-[#c9bba8]'
                  : 'text-[#f0c05a]'
            }`}
          >
            ● {step === 'available' ? (online ? 'En ligne' : 'Hors ligne') : step === 'summary' ? 'Disponible' : 'Occupé'}
          </span>
        </div>

        {step === 'available' && (
          <button
            onClick={handleToggleOnline}
            disabled={busy}
            className={`relative ml-1 h-6 w-11 flex-none rounded-full transition-colors ${online ? 'bg-[#2fae5c]' : 'bg-white/15'}`}
            aria-pressed={online}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200"
              style={{ left: online ? 22 : 2 }}
            />
          </button>
        )}
      </div>

      {showCompass && (
        <div className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#1c1108]/85 text-[#e8c9a8] backdrop-blur">
          <Compass size={20} />
        </div>
      )}

      {error && (
        <div className="relative z-10 mx-3 mt-2 rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-200">{error}</div>
      )}
      {newRequestAlert && (
        <div className="relative z-10 mx-3 mt-2 rounded-xl bg-[#e8c9a8]/15 px-3 py-2 text-xs font-bold text-[#e8c9a8]">
          🔔 Nouvelle course disponible !
        </div>
      )}

      {navInfo && onTrip && (
        <div className="relative z-10 mx-3 mt-3 flex items-center gap-2.5 rounded-2xl bg-[#2d6fe0] px-4 py-2.5 text-white">
          <ManeuverIcon type={navInfo.type} modifier={navInfo.modifier} size={20} />
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-bold text-white/80">{formatDistance(navInfo.distanceMeters)}</span>
            <span className="text-xs font-extrabold">{navInfo.instruction}</span>
          </div>
        </div>
      )}

      <div className="flex-1" />

      <div className="relative z-10">
        {step === 'available' && (
          <div className="flex gap-3 overflow-x-auto px-3 pb-3" style={{ scrollSnapType: 'x mandatory' }}>
            {shownPending.length === 0 && (
              <div className="w-full rounded-2xl bg-[#f5efe3] p-4 text-center text-sm text-[#6b6459]">
                Aucune course en attente pour le moment.
              </div>
            )}
            {shownPending.map((t) => (
              <div key={t.id} className="w-64 flex-none rounded-2xl bg-[#f5efe3] p-3" style={{ scrollSnapAlign: 'start' }}>
                <span className="inline-block rounded-full bg-[#dff3e6] px-2.5 py-1 text-[11px] font-extrabold text-[#1c8a4a]">
                  En Attente
                </span>
                <div className="mt-2 text-sm font-extrabold text-[#1c1108]">{t.pickup_address ?? 'Adresse de prise en charge'}</div>
                <div className="text-xs text-[#6b6459]">→ {t.dropoff_address ?? 'Destination'}</div>
                <div className="mt-1 text-lg font-extrabold text-[#1c1108]">{formatFCFA(t.estimated_price)}</div>
                <div className="mt-1.5 flex gap-1">
                  {VEHICLE_TYPES.map((vt) => (
                    <span
                      key={vt}
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        vt === t.vehicle_type ? 'bg-[#e8c9a8] text-[#5a3a1c]' : 'bg-[#e4dccb] text-[#8a8378]'
                      }`}
                    >
                      {VEHICLE_LABELS[vt]}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button disabled={busy} onClick={() => handleAccept(t)} className="flex-1 rounded-xl bg-[#2fae5c] py-2.5 text-sm font-extrabold text-white">
                    Accepter
                  </button>
                  <button disabled={busy} onClick={() => handleDismiss(t.id)} className="flex-1 rounded-xl bg-[#cfc7b8] py-2.5 text-sm font-extrabold text-[#6b6459]">
                    Refuser
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 'accepted' && active && (
          <div className="mx-3 mb-3 rounded-2xl bg-[#f5efe3] p-3">
            <button
              onClick={() => setTripCardExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="inline-block rounded-full bg-[#dff3e6] px-2.5 py-1 text-[11px] font-extrabold text-[#1c8a4a]">
                En route pour pickup
              </span>
              <ChevronUp size={16} className={`flex-none text-[#8a8378] transition-transform ${tripCardExpanded ? '' : 'rotate-180'}`} />
            </button>
            {!tripCardExpanded && (
              <div className="mt-1.5 flex items-center justify-between">
                <span className="truncate text-sm font-extrabold text-[#1c1108]">{active.pickup_address ?? 'Adresse de prise en charge'}</span>
                <span className="ml-2 flex-none text-sm font-extrabold text-[#1c1108]">{formatFCFA(active.estimated_price)}</span>
              </div>
            )}
            {tripCardExpanded && (
              <>
                <TripCardBody trip={active} passengerName={passengerContact?.full_name ?? null} showDestinationLabel="Destination" />
                {passengerContact?.phone && (
                  <a
                    href={`tel:${passengerContact.phone}`}
                    className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#2d6fe0] py-2 text-xs font-extrabold text-white"
                  >
                    Contacter le client · {passengerContact.phone}
                  </a>
                )}
              </>
            )}
            <div className="mt-2 flex gap-2">
              <button disabled={busy} onClick={handleCancel} className="flex-1 rounded-xl bg-[#e0453f] py-2.5 text-sm font-extrabold text-white">
                Annuler la course
              </button>
              <button disabled={busy} onClick={handleArrive} className="flex-1 rounded-xl bg-[#2fae5c] py-2.5 text-sm font-extrabold text-white">
                J&apos;arrive
              </button>
            </div>
          </div>
        )}

        {step === 'in_progress' && active && (
          <div className="mx-3 mb-3 rounded-2xl bg-[#f5efe3] p-3">
            <button
              onClick={() => setTripCardExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="inline-block rounded-full bg-[#2fae5c] px-2.5 py-1 text-[11px] font-extrabold text-white">
                Avec {passengerContact?.full_name ?? 'la cliente'}
              </span>
              <ChevronUp size={16} className={`flex-none text-[#8a8378] transition-transform ${tripCardExpanded ? '' : 'rotate-180'}`} />
            </button>
            {!tripCardExpanded && (
              <div className="mt-1.5 flex items-center justify-between">
                <span className="truncate text-sm font-extrabold text-[#1c1108]">→ {active.dropoff_address ?? 'Destination'}</span>
                <span className="ml-2 flex-none text-sm font-extrabold text-[#1c1108]">{formatFCFA(active.estimated_price)}</span>
              </div>
            )}
            {tripCardExpanded && (
              <>
                <TripCardBody trip={active} passengerName={passengerContact?.full_name ?? null} showDestinationLabel="Destination" />
                {passengerContact?.phone && (
                  <a
                    href={`tel:${passengerContact.phone}`}
                    className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#2d6fe0] py-2 text-xs font-extrabold text-white"
                  >
                    Contacter le client · {passengerContact.phone}
                  </a>
                )}
                <button onClick={openExternalNavigation} className="mt-2 w-full text-center text-[11px] font-bold text-[#6b6459] underline">
                  Ouvrir dans Maps (secours hors-ligne)
                </button>
              </>
            )}
            <button disabled={busy} onClick={handleFinish} className="mt-2 w-full rounded-xl bg-[#2fae5c] py-3 text-sm font-extrabold text-white">
              Terminer la course
            </button>
            <div className="mt-1 text-center text-[11px] text-[#8a8378]">Glisser pour terminer</div>
          </div>
        )}

        {step === 'summary' && summaryTrip && (
          <div className="mx-3 mb-3 rounded-2xl bg-[#f5efe3] p-3">
            <div className="rounded-xl bg-[#2fae5c] py-2 text-center text-sm font-extrabold text-white">Résumé de Course</div>
            <span className="mt-1.5 inline-block rounded-full bg-[#2fae5c] px-2.5 py-1 text-[11px] font-extrabold text-white">
              En Course - Avec la cliente: {passengerContact?.full_name ?? '—'}
            </span>

            <div className="mt-2 flex items-start gap-3">
              <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[#e8c9a8]/40 text-sm font-extrabold text-[#5a3a1c]">
                {initials(passengerContact?.full_name ?? null)}
              </div>
              <div className="flex-1">
                <div className="text-sm font-extrabold text-[#1c1108]">Course de {elapsedMin ?? '—'} min</div>
                <div className="text-sm text-[#1c1108]">Distance: {summaryTrip.distance_km?.toFixed(1) ?? '—'} km</div>
                <div className="text-sm font-extrabold text-[#1c1108]">Total: {formatFCFA(summaryTrip.final_price)}</div>
              </div>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRatingStars(n)} aria-label={`${n} étoiles`}>
                    <Star size={16} fill={n <= ratingStars ? '#e8b53a' : 'none'} color="#e8b53a" />
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaires facultatifs..."
              className="mt-2 w-full rounded-lg border border-[#e4d7bf] bg-white px-2.5 py-2 text-xs text-[#1c1108] outline-none"
              rows={2}
            />

            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setRatingTag((t) => (t === 'client_sympa' ? 'aucun' : 'client_sympa'))}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-extrabold ${
                  ratingTag === 'client_sympa' ? 'bg-[#e8c9a8] text-[#5a3a1c]' : 'bg-[#e4dccb] text-[#6b6459]'
                }`}
              >
                <ThumbsUp size={13} /> Client Sympa (+bonus)
              </button>
              <button disabled={busy} onClick={handleValidateSummary} className="flex-1 rounded-xl bg-[#2fae5c] py-2.5 text-xs font-extrabold text-white">
                {autoValidateCountdown !== null
                  ? `Valider maintenant (${autoValidateCountdown}s)`
                  : "Valider et revenir à l'accueil"}
              </button>
            </div>
            {autoValidateCountdown !== null && (
              <div className="mt-1.5 text-center text-[11px] text-[#8a8378]">
                Retour automatique en ligne dans {autoValidateCountdown}s…
              </div>
            )}
          </div>
        )}
      </div>

      <nav className="relative z-10 flex items-stretch justify-around bg-[#1c1108] pb-[env(safe-area-inset-bottom,0px)]">
        {(
          [
            { key: 'accueil', label: 'Accueil', icon: Home },
            { key: 'historique', label: 'Historique', icon: History },
            { key: 'gains', label: 'Gains', icon: Wallet },
            { key: 'profil', label: 'Profil', icon: UserIcon },
          ] as { key: typeof bottomTab; label: string; icon: typeof Home }[]
        ).map(({ key, label, icon: Icon }) => {
          const activeTab = bottomTab === key;
          return (
            <button key={key} onClick={() => setBottomTab(key)} className="flex flex-1 flex-col items-center gap-1 py-2.5">
              <Icon size={18} color={activeTab ? '#e8c9a8' : '#8a7d6c'} />
              <span className="text-[9px] font-bold" style={{ color: activeTab ? '#e8c9a8' : '#8a7d6c' }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {bottomTab !== 'accueil' && (
        <div className="absolute inset-x-3 bottom-20 top-20 z-20 flex flex-col overflow-hidden rounded-2xl bg-[#1c1108]/95 p-4 text-sm text-[#e8c9a8]">
          <div className="mb-3 flex flex-none items-center justify-between">
            <h2 className="text-base font-extrabold">
              {bottomTab === 'historique' ? 'Historique des courses' : bottomTab === 'gains' ? 'Mes gains' : 'Mon profil'}
            </h2>
            <button onClick={() => setBottomTab('accueil')} className="text-xs text-[#c9bba8] underline">
              Fermer
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {(bottomTab === 'historique' || bottomTab === 'gains') && historyLoading && (
              <div className="py-8 text-center text-xs text-[#c9bba8]">Chargement…</div>
            )}

            {bottomTab === 'historique' && !historyLoading && (
              <>
                {history.length === 0 ? (
                  <div className="rounded-2xl bg-white/5 p-4 text-center text-xs text-[#c9bba8]">
                    Aucune course terminée pour le moment.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {history.map((t) => (
                      <div key={t.id} className="rounded-2xl bg-white/5 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-[#c9bba8]">
                            {t.completed_at ? new Date(t.completed_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </span>
                          <span className="rounded-md bg-[#e8c9a8]/15 px-2 py-0.5 text-[10px] font-bold text-[#e8c9a8]">
                            {VEHICLE_LABELS[t.vehicle_type]}
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-white">{t.pickup_address ?? 'Départ'}</div>
                        <div className="text-xs text-[#c9bba8]">→ {t.dropoff_address ?? 'Destination'}</div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-xs text-[#c9bba8]">{t.distance_km ? `${t.distance_km.toFixed(1)} km` : ''}</span>
                          <span className="text-sm font-extrabold text-[#5be08a]">{formatFCFA(t.final_price)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {bottomTab === 'gains' && !historyLoading && (
              <>
                {(() => {
                  const now = new Date();
                  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const startOfWeek = new Date(startOfToday);
                  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

                  const sum = (trips: Trip[]) => trips.reduce((acc, t) => acc + (t.final_price ?? 0), 0);
                  const withDate = history.filter((t) => t.completed_at);
                  const today = withDate.filter((t) => new Date(t.completed_at as string) >= startOfToday);
                  const week = withDate.filter((t) => new Date(t.completed_at as string) >= startOfWeek);

                  const cards = [
                    { label: "Aujourd'hui", value: sum(today), count: today.length },
                    { label: 'Cette semaine', value: sum(week), count: week.length },
                    { label: 'Total', value: sum(history), count: history.length },
                  ];

                  return (
                    <div className="flex flex-col gap-2">
                      {cards.map((c) => (
                        <div key={c.label} className="rounded-2xl bg-white/5 p-3">
                          <div className="text-xs font-bold text-[#c9bba8]">{c.label}</div>
                          <div className="mt-1 text-xl font-extrabold text-[#5be08a]">{formatFCFA(c.value)}</div>
                          <div className="text-[11px] text-[#c9bba8]">{c.count} course{c.count > 1 ? 's' : ''}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}

            {bottomTab === 'profil' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
                  <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 border-[#e8c9a8] bg-[#e8c9a8]/20 text-sm font-extrabold text-[#e8c9a8]">
                    {initials(profile?.full_name ?? null)}
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-white">{profile?.full_name ?? 'Chauffeur'}</div>
                    <div className="text-xs text-[#c9bba8]">{profile?.phone ?? '—'}</div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#c9bba8]">Note moyenne</span>
                    <span className="flex items-center gap-1 font-extrabold text-[#e8b53a]">
                      <Star size={13} fill="#e8b53a" color="#e8b53a" /> {profile?.rating_avg?.toFixed(1) ?? '—'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[#c9bba8]">Statut du compte</span>
                    <span className="font-extrabold text-[#5be08a]">
                      {profile?.validation_status === 'approved' ? 'Validé' : profile?.validation_status ?? '—'}
                    </span>
                  </div>
                </div>

                {vehicles.length > 0 && (
                  <div className="rounded-2xl bg-white/5 p-3">
                    <div className="mb-1.5 text-xs font-bold text-[#c9bba8]">Mon véhicule</div>
                    {vehicles.map((v) => (
                      <div key={v.id} className="flex items-center justify-between py-1 text-xs">
                        <span className="text-white">
                          {v.brand ?? ''} {v.model ?? ''} · {VEHICLE_LABELS[v.type]}
                        </span>
                        <span className="text-[#c9bba8]">{v.plate}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="mt-1 w-full rounded-xl bg-[#e0453f]/90 py-2.5 text-sm font-extrabold text-white"
                >
                  {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TripCardBody({
  trip,
  passengerName,
  showDestinationLabel,
}: {
  trip: Trip;
  passengerName: string | null;
  showDestinationLabel: string;
}) {
  return (
    <div className="mt-2 flex items-start gap-3">
      <div className="flex-1">
        <div className="text-sm font-extrabold text-[#1c1108]">{trip.pickup_address ?? 'Adresse de prise en charge'}</div>
        <div className="text-xs text-[#6b6459]">({VEHICLE_LABELS[trip.vehicle_type]})</div>
        <div className="mt-0.5 text-base font-extrabold text-[#1c1108]">{formatFCFA(trip.estimated_price)}</div>
        <div className="mt-1 flex gap-1">
          {VEHICLE_TYPES.map((vt) => (
            <span
              key={vt}
              className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                vt === trip.vehicle_type ? 'bg-[#e8c9a8] text-[#5a3a1c]' : 'bg-[#e4dccb] text-[#8a8378]'
              }`}
            >
              {VEHICLE_LABELS[vt]}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#e8c9a8]/40 text-xs font-extrabold text-[#5a3a1c]">
            {initials(passengerName)}
          </div>
          <span className="text-sm font-extrabold text-[#1c1108]">{passengerName ?? '—'}</span>
        </div>
        <div className="mt-1 text-[11px] font-bold text-[#1c1108]">{showDestinationLabel}</div>
        <div className="text-[11px] text-[#6b6459]">{trip.dropoff_address ?? '—'}</div>
      </div>
    </div>
  );
}
