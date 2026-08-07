'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Compass,
  Star,
  ThumbsUp,
  Home,
  Radar as RadarIcon,
  BarChart3,
  User as UserIcon,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  RotateCcw,
  Flag,
  Circle,
  ChevronUp,
  Camera,
  Bell,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Trip, VehicleType } from '@/types/database';
import { CAR_MODEL_BY_TYPE, formatFCFA, haversineKm, VEHICLE_LABELS } from '@/lib/pricing';
import {
  DriverStats,
  MyDriverProfile,
  MyVehicle,
  acceptTrip,
  cancelTripAsDriver,
  finishTrip,
  getDriverStats,
  getMyActiveTrip,
  getMyDriverData,
  getMyTripHistory,
  getPassengerContact,
  getPendingTrips,
  setVehicleStatus,
  updateMyAvatar,
  startSharingLocation,
  startTrip,
  submitRating,
  subscribeToTripChanges,
} from '@/lib/driver';
import AuthGate from '@/components/AuthGate';
import RealMap, { type NavigationStep, type MapPin } from '@/components/RealMap';
import { isPushSupported, enablePushNotifications } from '@/lib/push';

const VEHICLE_TYPES: VehicleType[] = ['berline', 'van', 'suv'];
type BottomTab = 'home' | 'radar' | 'stats' | 'profil';

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

// Extrait une zone/quartier approximatif d'une adresse formattée
// ("Lieu, 6ème Arrondissement, N'Djaména, Tchad" -> "6ème Arrondissement"),
// utilisé pour donner une info honnête pendant le court masquage de la
// destination exacte sur les nouvelles courses.
function approxZone(address: string | null): string {
  if (!address) return 'zone à préciser';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : parts[0] ?? 'zone à préciser';
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
  // IDs des courses arrivées à l'instant : la destination exacte est encore
  // masquée le temps que les détails finissent de charger (~3s). Le prix,
  // la zone et la distance approx. restent visibles, et les deux boutons
  // (Refuser / Accepter) restent cliquables en permanence — on ne bloque
  // jamais le chauffeur, on affiche juste une info partielle honnête.
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [ratingStars, setRatingStars] = useState(4);
  const [ratingTag, setRatingTag] = useState<'client_sympa' | 'aucun'>('aucun');
  const [comment, setComment] = useState('');
  const [bottomTab, setBottomTab] = useState<BottomTab>('home');
  const [history, setHistory] = useState<Trip[]>([]);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pushState, setPushState] = useState<'off' | 'enabling' | 'on' | 'unsupported'>('off');
  const [navInfo, setNavInfo] = useState<NavigationStep | null>(null);
  const [tripCardExpanded, setTripCardExpanded] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

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

  // Statistiques + historique : chargés uniquement à l'ouverture de l'onglet
  // Statistiques, avec cache (staleTime côté lib/driver.ts) pour éviter de
  // re-requêter Supabase à chaque clic d'onglet.
  useEffect(() => {
    if (!session?.user) return;
    if (bottomTab !== 'stats' || statsLoaded) return;
    setStatsLoading(true);
    Promise.all([getDriverStats(session.user.id), getMyTripHistory(session.user.id)])
      .then(([s, h]) => {
        setStats(s);
        setHistory(h);
        setStatsLoaded(true);
      })
      .catch((e: any) => setError(e?.message ?? 'Impossible de charger les statistiques.'))
      .finally(() => setStatsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab, session?.user?.id]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !session?.user) return;
    if (!file.type.startsWith('image/')) {
      setAvatarError('Choisis une image (jpg, png…).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image trop lourde (5 Mo max).');
      return;
    }
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const url = await updateMyAvatar(session.user.id, file);
      setProfile((p) => (p ? { ...p, avatar_url: url } : p));
    } catch (err: any) {
      setAvatarError(err?.message ?? "Impossible d'envoyer la photo.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
  }

  async function handleEnablePush() {
    if (!isPushSupported()) {
      setPushState('unsupported');
      return;
    }
    setPushState('enabling');
    const result = await enablePushNotifications();
    setPushState(result.ok ? 'on' : 'off');
    if (!result.ok && result.reason !== 'denied') {
      setError("Impossible d'activer les notifications pour le moment.");
    }
  }

  // Supabase Realtime (WebSocket `trips`) : actif UNIQUEMENT sur l'onglet
  // Radar. La souscription est détruite dès qu'on quitte cet onglet, pour
  // économiser les quotas Supabase/Vercel.
  useEffect(() => {
    if (!session?.user) return;
    if (bottomTab !== 'radar') return;
    const userId = session.user.id;
    const unsubscribe = subscribeToTripChanges(({ eventType, trip }) => {
      if (eventType === 'INSERT' && trip.status === 'pending') {
        setNewRequestAlert(true);
        playNotificationBeep();
        window.setTimeout(() => setNewRequestAlert(false), 4000);

        setLoadingDetails((s) => new Set(s).add(trip.id));
        window.setTimeout(() => {
          setLoadingDetails((s) => {
            const next = new Set(s);
            next.delete(trip.id);
            return next;
          });
        }, 3000);
      }
      refreshAll(userId);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab, session?.user?.id]);

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
      setError('Aucun véhicule disponible pour ce type (passez en ligne).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptTrip(trip.id, session.user.id, v.id);
      if (!accepted) {
        setError('Trop tard : un autre chauffeur a déjà accepté cette course.');
      } else {
        setBottomTab('home'); // bascule sur la carte pour la navigation
      }
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
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await cancelTripAsDriver(active.id);
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
      setStatsLoaded(false); // les gains viennent de changer : on invalide le cache
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
          <h2 className="text-[15px] font-medium">Compte en attente de validation</h2>
          <p className="mt-1.5 text-[12.5px] text-[#a89680]">
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

  // Course la plus proche en premier.
  const sortedPending = driverPos
    ? [...shownPending].sort(
        (a, b) =>
          haversineKm(driverPos.lat, driverPos.lng, a.pickup_lat, a.pickup_lng) -
          haversineKm(driverPos.lat, driverPos.lng, b.pickup_lat, b.pickup_lng)
      )
    : shownPending;

  const showCompass = step === 'in_progress' || step === 'summary' || step === 'available';
  const displayTrip = summaryTrip ?? active;
  const elapsedMin =
    summaryTrip?.started_at && summaryTrip?.completed_at
      ? Math.max(1, Math.round((new Date(summaryTrip.completed_at).getTime() - new Date(summaryTrip.started_at).getTime()) / 60000))
      : null;

  const onTrip = step === 'accepted' || step === 'in_progress';
  const mapPitch = onTrip ? 75 : 32;
  const mapOverviewZoom = step === 'available' ? 12.5 : 15;
  const myVehicleType: VehicleType = myVehicle?.type ?? 'berline';
  const carModelUrl = CAR_MODEL_BY_TYPE[myVehicleType];

  // Onglet Radar : un "bonhomme" (avatar + nom + distance) par course en
  // attente, positionné sur son point de départ. La plus proche (première
  // du tri) est mise en évidence (contour vert + pulse).
  const radarPins: MapPin[] =
    bottomTab === 'radar'
      ? sortedPending.map((t, i) => ({
          position: { lat: t.pickup_lat, lng: t.pickup_lng },
          passenger: {
            initials: initials(t.passenger_profile?.full_name ?? null),
            name: t.passenger_profile?.full_name?.split(' ')[0] ?? 'Passager',
            distanceKm: driverPos ? haversineKm(driverPos.lat, driverPos.lng, t.pickup_lat, t.pickup_lng) : 0,
            highlight: i === 0,
          },
        }))
      : [];

  // Onglet HOME : carte plein écran, épurée. Aucune fenêtre modale
  // d'historique/gains ici — uniquement le suivi de la course en cours.
  const showMap = bottomTab === 'home' || bottomTab === 'radar';

  return (
    <div
      className="relative flex flex-col overflow-hidden bg-[#0d0906]"
      style={{ height: 'var(--app-vh, 100dvh)' }}
    >
      <div className="relative flex-1 overflow-hidden">
        {showMap && (
          <div className="absolute inset-0">
            <RealMap
              pitch={mapPitch}
              buildings3d
              driverPosition={driverPos}
              pins={radarPins}
              use3dCar={onTrip}
              carModelUrl={carModelUrl}
              overviewZoom={mapOverviewZoom}
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
        )}

        {/* ---------- ONGLET HOME ---------- */}
        {bottomTab === 'home' && (
          <>
            <div className="relative z-10 mt-4 ml-3.5 flex w-fit items-center gap-2 rounded-full border-[0.5px] border-[rgba(169,122,91,0.4)] bg-[rgba(13,9,6,0.72)] py-1.5 pl-1.5 pr-3 backdrop-blur-sm">
              <div
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 bg-[#3a2a1c] bg-cover bg-center text-[10px] font-medium text-[#e8c9a8]"
                style={{
                  borderColor: step === 'available' && online ? '#5be08a' : '#6b4a35',
                  backgroundImage: profile?.avatar_url ? `url(${profile.avatar_url})` : undefined,
                }}
              >
                {!profile?.avatar_url && initials(profile?.full_name ?? null)}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-[11px] font-medium text-[#f7e6d4]">{profile?.full_name ?? 'Chauffeur'}</span>
                <span
                  className="font-mono text-[9px] font-medium tracking-wide"
                  style={{
                    color:
                      step === 'available' && online
                        ? '#5be08a'
                        : step === 'available' && !online
                          ? '#7a6a58'
                          : '#e8c9a8',
                  }}
                >
                  {Number(profile?.rating_avg ?? 0).toFixed(1)} · {step === 'available' ? (online ? 'EN LIGNE' : 'HORS LIGNE') : step === 'summary' ? 'DISPONIBLE' : 'OCCUPÉ'}
                </span>
              </div>

              {step === 'available' && (
                <button
                  onClick={handleToggleOnline}
                  disabled={busy}
                  className="relative ml-1 h-[17px] w-[30px] flex-none rounded-full border-[0.5px] transition-colors duration-200"
                  style={{
                    borderColor: online ? '#5be08a' : '#6b4a35',
                    background: online ? '#1f4d33' : '#2a2118',
                  }}
                  aria-pressed={online}
                  aria-label="Basculer en ligne / hors ligne"
                >
                  <span
                    className="absolute top-[2px] h-3 w-3 rounded-full transition-all duration-200"
                    style={{ left: online ? 14 : 2, background: online ? '#5be08a' : '#e8c9a8' }}
                  />
                </button>
              )}
            </div>

            {showCompass && (
              <div className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#1c1108] text-[#e8c9a8] backdrop-blur">
                <Compass size={20} />
              </div>
            )}

            {step === 'available' && (
              <div className="relative z-10 mx-3 mt-3 flex w-fit items-center gap-1.5 rounded-full border-[0.5px] border-[rgba(169,122,91,0.35)] bg-[rgba(13,9,6,0.72)] px-3 py-1.5 text-[10px] font-medium text-[#e8c9a8] backdrop-blur-sm">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: online ? '#5be08a' : '#8a7358' }} />
                Vue d&apos;ensemble · N&apos;Djamena
              </div>
            )}

            {error && (
              <div className="relative z-10 mx-3 mt-2 border-[0.5px] border-[rgba(226,75,74,0.3)] px-3 py-2 text-[11px] text-[#e2807f]">{error}</div>
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

            <div className="absolute inset-x-0 bottom-0 z-10">
              {step === 'accepted' && active && (
                <div className="mx-3 mb-3 border-[0.5px] border-[rgba(169,122,91,0.28)] bg-[#14100c]">
                  <button
                    onClick={() => setTripCardExpanded((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 border-b-[0.5px] border-dashed border-[rgba(169,122,91,0.3)] px-3 py-2.5 text-left"
                  >
                    <span className="text-[9px] font-medium tracking-wide text-[#e8c9a8]">EN ROUTE VERS LE PASSAGER</span>
                    <ChevronUp size={13} className={`flex-none text-[#8a7358] transition-transform ${tripCardExpanded ? '' : 'rotate-180'}`} />
                  </button>
                  {!tripCardExpanded && (
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="truncate text-[11.5px] text-[#f7e6d4]">{active.pickup_address ?? 'Adresse de prise en charge'}</span>
                      <span className="ml-2 flex-none font-mono text-[13px] text-[#f7e6d4]">{formatFCFA(active.estimated_price)}</span>
                    </div>
                  )}
                  {tripCardExpanded && (
                    <div className="px-3 py-2.5">
                      <TripCardBody trip={active} passengerName={passengerContact?.full_name ?? null} showDestinationLabel="Destination" />
                      {passengerContact?.phone && (
                        <a
                          href={`tel:${passengerContact.phone}`}
                          className="mt-2 flex items-center justify-center gap-1.5 border-[0.5px] border-[rgba(169,122,91,0.28)] py-2 text-[10.5px] text-[#e8c9a8]"
                        >
                          Contacter · {passengerContact.phone}
                        </a>
                      )}
                    </div>
                  )}
                  <div className="flex border-t-[0.5px] border-[rgba(169,122,91,0.2)]">
                    <button
                      disabled={busy}
                      onClick={handleCancel}
                      className="flex flex-1 items-center justify-center gap-1.5 border-r-[0.5px] border-[rgba(169,122,91,0.2)] py-2.5 text-[10.5px] text-[#e2807f]"
                    >
                      ✕ Annuler
                    </button>
                    <button disabled={busy} onClick={handleArrive} className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[10.5px] text-[#e8c9a8]">
                      ✓ J&apos;arrive
                    </button>
                  </div>
                </div>
              )}

              {step === 'in_progress' && active && (
                <div className="mx-3 mb-3 border-[0.5px] border-[rgba(169,122,91,0.28)]">
                  <div className="bg-[#14100c]">
                    <button
                      onClick={() => setTripCardExpanded((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 border-b-[0.5px] border-dashed border-[rgba(169,122,91,0.3)] px-3 py-2.5 text-left"
                    >
                      <span className="text-[9px] font-medium tracking-wide text-[#e8c9a8]">
                        AVEC {(passengerContact?.full_name ?? 'LA CLIENTE').toUpperCase()}
                      </span>
                      <ChevronUp size={13} className={`flex-none text-[#8a7358] transition-transform ${tripCardExpanded ? '' : 'rotate-180'}`} />
                    </button>
                    {!tripCardExpanded && (
                      <div className="flex items-center justify-between px-3 py-2.5">
                        <span className="truncate text-[11.5px] text-[#f7e6d4]">→ {active.dropoff_address ?? 'Destination'}</span>
                        <span className="ml-2 flex-none font-mono text-[13px] text-[#f7e6d4]">{formatFCFA(active.estimated_price)}</span>
                      </div>
                    )}
                    {tripCardExpanded && (
                      <div className="px-3 py-2.5">
                        <TripCardBody trip={active} passengerName={passengerContact?.full_name ?? null} showDestinationLabel="Destination" />
                        {passengerContact?.phone && (
                          <a
                            href={`tel:${passengerContact.phone}`}
                            className="mt-2 flex items-center justify-center gap-1.5 border-[0.5px] border-[rgba(169,122,91,0.28)] py-2 text-[10.5px] text-[#e8c9a8]"
                          >
                            Contacter · {passengerContact.phone}
                          </a>
                        )}
                        <button onClick={openExternalNavigation} className="mt-2 w-full text-center text-[10px] text-[#8a7358] underline">
                          Ouvrir dans Maps (secours hors-ligne)
                        </button>
                      </div>
                    )}
                  </div>
                  <button disabled={busy} onClick={handleFinish} className="w-full bg-[#efd9b8] py-3 text-[12.5px] font-medium text-[#3c2a1a]">
                    Terminer la course
                  </button>
                </div>
              )}

              {step === 'summary' && summaryTrip && (
                <div className="mx-3 mb-3 border-[0.5px] border-[rgba(169,122,91,0.28)]">
                  <div className="border-b-[0.5px] border-dashed border-[rgba(169,122,91,0.3)] bg-[#14100c] px-3 py-2.5">
                    <span className="text-[9px] font-medium tracking-wide text-[#e8c9a8]">COURSE TERMINÉE</span>
                    <div className="mt-1 text-[10.5px] text-[#a89680]">
                      Avec {passengerContact?.full_name ?? '—'} · {elapsedMin ?? '—'} min · {summaryTrip.distance_km?.toFixed(1) ?? '—'} km
                    </div>
                  </div>

                  <div className="bg-[#14100c] px-3 py-2.5">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => setRatingStars(n)} aria-label={`${n} étoiles`}>
                          <Star size={16} color="#e8c9a8" fill={n <= ratingStars ? '#e8c9a8' : 'none'} />
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Commentaire facultatif…"
                      className="mt-2 w-full border-[0.5px] border-[rgba(169,122,91,0.28)] bg-transparent px-2.5 py-2 text-[11.5px] text-[#f7e6d4] outline-none placeholder:text-[#6b5c48]"
                      rows={2}
                    />
                    <button
                      onClick={() => setRatingTag((t) => (t === 'client_sympa' ? 'aucun' : 'client_sympa'))}
                      className={`mt-2 flex w-full items-center justify-center gap-1.5 border-[0.5px] py-2 text-[10.5px] ${
                        ratingTag === 'client_sympa' ? 'border-[#a97a5b] text-[#e8c9a8]' : 'border-[rgba(169,122,91,0.2)] text-[#8a7358]'
                      }`}
                    >
                      <ThumbsUp size={12} /> Client sympa (bonus)
                    </button>
                  </div>

                  <div className="flex items-center justify-between bg-[#efd9b8] px-3 py-2.5">
                    <span className="font-mono text-base text-[#3c2a1a]">{formatFCFA(summaryTrip.final_price)}</span>
                    <button disabled={busy} onClick={handleValidateSummary} className="bg-[#3c2a1a] px-3.5 py-2 text-[10.5px] font-medium text-[#efd9b8]">
                      {autoValidateCountdown !== null ? `Valider (${autoValidateCountdown}s)` : 'Valider et repartir'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ---------- ONGLET RADAR ---------- */}
        {bottomTab === 'radar' && (
          <>
            <div className="relative z-10 mx-3 mt-4 flex items-center justify-between border-[0.5px] border-[rgba(169,122,91,0.28)] bg-[rgba(13,9,6,0.85)] px-3.5 py-2.5 backdrop-blur-sm">
              <span className="text-[13px] font-medium tracking-wide text-[#e8c9a8]">Courses disponibles</span>
              <span className="flex items-center gap-1.5 font-mono text-[9px] text-[#5be08a]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5be08a]" /> TEMPS RÉEL
              </span>
            </div>

            {error && (
              <div className="relative z-10 mx-3 mt-2 border-[0.5px] border-[rgba(226,75,74,0.3)] px-3 py-2 text-[11px] text-[#e2807f]">{error}</div>
            )}
            {newRequestAlert && (
              <div className="relative z-10 mx-3 mt-2 flex items-center gap-2 rounded-xl border-[0.5px] border-[#5be08a] bg-[rgba(13,9,6,0.88)] px-3 py-2 text-[11px] text-[#f7e6d4]">
                <Bell size={14} className="flex-none text-[#5be08a]" />
                Nouvelle course disponible
              </div>
            )}

            {/* Effet visuel radar (concentrique) centré sur la carte */}
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="absolute rounded-full border border-[#a97a5b]/30"
                  style={{
                    width: 90 + i * 70,
                    height: 90 + i * 70,
                    animation: `yn-radar-pulse 2.4s ease-out ${i * 0.5}s infinite`,
                  }}
                />
              ))}
              <span className="absolute h-2 w-2 rounded-full bg-[#e8c9a8]" />
            </div>
            <style>{`
              @keyframes yn-radar-pulse {
                0% { opacity: 0.55; transform: scale(0.6); }
                100% { opacity: 0; transform: scale(1); }
              }
            `}</style>

            <div className="absolute inset-x-0 bottom-0 z-10">
              <div className="flex gap-2.5 overflow-x-auto px-3 pb-2" style={{ scrollSnapType: 'x mandatory' }}>
                {sortedPending.length === 0 && (
                  <div className="w-full border-[0.5px] border-[rgba(169,122,91,0.28)] bg-[#14100c] p-4 text-center text-xs text-[#8a7358]">
                    Aucune course en attente pour le moment.
                  </div>
                )}
                {sortedPending.map((t, i) => (
                  <div key={t.id} className="flex w-[calc(100vw-24px)] max-w-[420px] flex-none" style={{ scrollSnapAlign: 'start' }}>
                    <div
                      className="w-[3px] flex-none"
                      style={{ background: 'repeating-linear-gradient(180deg,#6b4a35 0 4px,transparent 4px 8px)' }}
                    />
                    <div className={`flex-1 border-[0.5px] border-l-0 p-2.5 ${i === 0 ? 'border-[#a97a5b] bg-[#241a13]' : 'border-[rgba(169,122,91,0.28)] bg-[#14100c]'}`}>
                      {loadingDetails.has(t.id) && (
                        <div className="mb-1 border-[0.5px] border-[#378ADD]/40 bg-[#042C53]/60 px-2 py-0.5 text-center text-[8px] font-medium text-[#B5D4F4]">
                          Nouvelle course · détails en cours de chargement
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-medium tracking-wide text-[#a97a5b]">
                          MANIFESTE {i === 0 ? '· PLUS PROCHE' : ''}
                        </span>
                        {driverPos && (
                          <span className="ml-auto font-mono text-[9px] text-[#8a7358]">
                            {haversineKm(driverPos.lat, driverPos.lng, t.pickup_lat, t.pickup_lng).toFixed(1)} KM
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex flex-col gap-[3px]">
                        <div className="flex items-center gap-1.5">
                          <Circle size={7} className="shrink-0 fill-[#a97a5b] text-[#a97a5b]" />
                          <span className="truncate text-[11.5px] leading-tight text-[#f7e6d4]">
                            {t.pickup_address ?? 'Départ'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Flag size={10} className="shrink-0 text-[#8a7358]" />
                          <span className="truncate text-[11.5px] leading-tight text-[#f7e6d4]">
                            {loadingDetails.has(t.id)
                              ? `${approxZone(t.dropoff_address)} (adresse exacte à venir…)`
                              : t.dropoff_address ?? 'Destination'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[10.5px] text-[#8a7358]">{t.passenger_profile?.full_name ?? 'Passager'} · {VEHICLE_LABELS[t.vehicle_type]}</span>
                        <span className="font-mono text-[13px] font-medium text-[#f7e6d4]">{formatFCFA(t.estimated_price)}</span>
                      </div>

                      <div className="mt-2 flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => handleDismiss(t.id)}
                          aria-label="Refuser"
                          className="flex flex-1 items-center justify-center gap-1 rounded-full border border-[#E24B4A] bg-[#3a1010] py-[7px] text-[11px] font-medium text-[#F09595] disabled:opacity-50"
                        >
                          <span className="text-xs leading-none">✕</span> Refuser
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => handleAccept(t)}
                          aria-label="Accepter"
                          className="flex flex-1 items-center justify-center gap-1 rounded-full border border-[#639922] bg-[#152e04] py-[7px] text-[11px] font-medium text-[#C0DD97] disabled:opacity-50"
                        >
                          <span className="text-xs leading-none">✓</span> Accepter
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ---------- ONGLET STATISTIQUES ---------- */}
        {bottomTab === 'stats' && (
          <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-[#0d0906] p-3.5 text-sm text-[#e8c9a8]">
            <h2 className="mb-3 flex-none border-b-[0.5px] border-dashed border-[rgba(169,122,91,0.3)] pb-2.5 text-[13px] font-medium tracking-wide">
              Synthèse des gains
            </h2>
            <div className="flex-1 overflow-y-auto">
              {statsLoading && <div className="py-8 text-center text-xs text-[#8a7358]">Chargement…</div>}

              {!statsLoading && stats && (
                <div className="flex flex-col border-b-[0.5px] border-[rgba(169,122,91,0.28)] pb-1">
                  {[
                    { label: "Aujourd'hui", value: stats.today_earnings, count: stats.today_count },
                    { label: 'Cette semaine', value: stats.week_earnings, count: stats.week_count },
                    { label: 'Total', value: stats.total_earnings, count: stats.total_count },
                  ].map((c) => (
                    <div key={c.label} className="flex items-center justify-between border-b-[0.5px] border-[rgba(169,122,91,0.15)] py-2.5">
                      <div>
                        <div className="text-[11px] text-[#a89680]">{c.label}</div>
                        <div className="text-[9.5px] text-[#6b5c48]">{c.count} course{c.count > 1 ? 's' : ''}</div>
                      </div>
                      <div className="font-mono text-base text-[#e8c9a8]">{formatFCFA(c.value)}</div>
                    </div>
                  ))}
                </div>
              )}

              {!statsLoading && (
                <>
                  <h3 className="mb-1.5 mt-3 text-[11px] font-medium tracking-wide text-[#e8c9a8]">
                    Historique des courses ({history.length})
                  </h3>
                  {history.length === 0 ? (
                    <div className="border-[0.5px] border-[rgba(169,122,91,0.2)] p-4 text-center text-xs text-[#8a7358]">
                      Aucune course terminée pour le moment.
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {history.map((t) => (
                        <div key={t.id} className="border-b-[0.5px] border-[rgba(169,122,91,0.15)] py-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-[#8a7358]">
                              {t.completed_at ? new Date(t.completed_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </span>
                            <span className="text-[9.5px] text-[#8a7358]">{VEHICLE_LABELS[t.vehicle_type]}</span>
                          </div>
                          <div className="mt-1 text-[12px] text-[#f7e6d4]">{t.pickup_address ?? 'Départ'} → {t.dropoff_address ?? 'Destination'}</div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-[10.5px] text-[#8a7358]">{t.distance_km ? `${t.distance_km.toFixed(1)} km` : ''}</span>
                            <span className="font-mono text-[12.5px] text-[#e8c9a8]">{formatFCFA(t.final_price)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ---------- ONGLET PROFIL ---------- */}
        {bottomTab === 'profil' && (
          <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-[#0d0906] p-3.5 text-sm text-[#e8c9a8]">
            <h2 className="mb-3 flex-none border-b-[0.5px] border-dashed border-[rgba(169,122,91,0.3)] pb-2.5 text-[13px] font-medium tracking-wide">
              Mon profil
            </h2>
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 border-b-[0.5px] border-[rgba(169,122,91,0.15)] pb-3">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    aria-label="Changer la photo de profil"
                    className="relative h-14 w-14 flex-none"
                  >
                    <div
                      className="h-14 w-14 rounded-full border-[1.5px] border-[#6b4a35] bg-[#3a2a1c] bg-cover bg-center text-[13px] text-[#e8c9a8]"
                      style={{ backgroundImage: profile?.avatar_url ? `url(${profile.avatar_url})` : undefined }}
                    >
                      {!profile?.avatar_url && (
                        <div className="flex h-full w-full items-center justify-center">{initials(profile?.full_name ?? null)}</div>
                      )}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#14100c] bg-[#a97a5b]">
                      <Camera size={11} className="text-[#241a13]" />
                    </div>
                    {avatarUploading && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e8c9a8] border-t-transparent" />
                      </div>
                    )}
                  </button>
                  <div>
                    <div className="text-[12.5px] text-[#f7e6d4]">{profile?.full_name ?? 'Chauffeur'}</div>
                    <div className="text-[10.5px] text-[#8a7358]">{profile?.phone ?? '—'}</div>
                    <div className="mt-0.5 text-[9.5px] text-[#6b5c48]">Touche la photo pour la changer</div>
                  </div>
                </div>
                {avatarError && <div className="text-[10.5px] text-[#e2807f]">{avatarError}</div>}

                <div className="border-b-[0.5px] border-[rgba(169,122,91,0.15)] pb-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8a7358]">Note moyenne</span>
                    <span className="flex items-center gap-1 font-mono text-[#e8c9a8]">
                      <Star size={12} fill="#e8c9a8" color="#e8c9a8" /> {profile?.rating_avg?.toFixed(1) ?? '—'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-[#8a7358]">Statut du compte</span>
                    <span className="text-[#e8c9a8]">
                      {profile?.validation_status === 'approved' ? 'Validé' : profile?.validation_status ?? '—'}
                    </span>
                  </div>
                </div>

                {vehicles.length > 0 && (
                  <div className="border-b-[0.5px] border-[rgba(169,122,91,0.15)] pb-3">
                    <div className="mb-1.5 text-[10.5px] text-[#8a7358]">Mon véhicule</div>
                    {vehicles.map((v) => (
                      <div key={v.id} className="flex items-center justify-between py-1 text-[11px]">
                        <span className="text-[#f7e6d4]">
                          {v.brand ?? ''} {v.model ?? ''} · {VEHICLE_LABELS[v.type]}
                        </span>
                        <span className="font-mono text-[#8a7358]">{v.plate}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleEnablePush}
                  disabled={pushState === 'enabling' || pushState === 'on'}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 border-[0.5px] border-[rgba(169,122,91,0.4)] py-2.5 text-[11.5px] text-[#e8c9a8]"
                >
                  <Bell size={13} />
                  {pushState === 'on'
                    ? 'Notifications activées'
                    : pushState === 'enabling'
                    ? 'Activation…'
                    : pushState === 'unsupported'
                    ? 'Non disponible sur ce navigateur'
                    : 'Activer les notifications'}
                </button>
                {pushState === 'unsupported' && (
                  <p className="text-[9.5px] text-[#6b5c48]">
                    Sur iPhone : ajoute d&apos;abord l&apos;app à l&apos;écran d&apos;accueil (partager → Sur l&apos;écran d&apos;accueil), puis reviens ici.
                  </p>
                )}

                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="mt-1 w-full border-[0.5px] border-[rgba(226,75,74,0.4)] py-2.5 text-[11.5px] text-[#e2807f]"
                >
                  {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <nav className="relative z-20 flex flex-none items-stretch justify-around border-t-[0.5px] border-[rgba(169,122,91,0.2)] bg-[#1c1108] py-1 pb-[calc(env(safe-area-inset-bottom,0px)+4px)]">
        {(
          [
            { key: 'home', label: 'Home', icon: Home },
            { key: 'radar', label: 'Radar', icon: RadarIcon },
            { key: 'stats', label: 'Statistiques', icon: BarChart3 },
            { key: 'profil', label: 'Profil', icon: UserIcon },
          ] as { key: BottomTab; label: string; icon: typeof Home }[]
        ).map(({ key, label, icon: Icon }) => {
          const activeTab = bottomTab === key;
          return (
            <button key={key} onClick={() => setBottomTab(key)} aria-label={label} className="flex flex-1 flex-col items-center gap-1 py-1.5">
              <Icon size={15} color={activeTab ? '#e8c9a8' : '#6b5c48'} />
              <span className="text-[8.5px]" style={{ color: activeTab ? '#e8c9a8' : '#6b5c48' }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
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
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <div className="text-[12px] text-[#f7e6d4]">{trip.pickup_address ?? 'Adresse de prise en charge'}</div>
        <div className="text-[10px] text-[#8a7358]">({VEHICLE_LABELS[trip.vehicle_type]})</div>
        <div className="mt-0.5 font-mono text-[13px] text-[#f7e6d4]">{formatFCFA(trip.estimated_price)}</div>
        <div className="mt-1 flex gap-1">
          {VEHICLE_TYPES.map((vt) => (
            <span
              key={vt}
              className={`px-1.5 py-0.5 text-[9px] ${
                vt === trip.vehicle_type ? 'bg-[#3a2a1c] text-[#e8c9a8]' : 'text-[#6b5c48]'
              }`}
            >
              {VEHICLE_LABELS[vt]}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-[1.5px] border-[#6b4a35] text-[9.5px] text-[#e8c9a8]">
            {initials(passengerName)}
          </div>
          <span className="text-[12px] text-[#f7e6d4]">{passengerName ?? '—'}</span>
        </div>
        <div className="mt-1 text-[10px] text-[#8a7358]">{showDestinationLabel}</div>
        <div className="text-[10px] text-[#a89680]">{trip.dropoff_address ?? '—'}</div>
      </div>
    </div>
  );
}
