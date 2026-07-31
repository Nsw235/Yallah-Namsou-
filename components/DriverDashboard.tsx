'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Compass, Star, ThumbsUp, Home, History, Wallet, User as UserIcon } from 'lucide-react';
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
  getPassengerName,
  getPendingTrips,
  setVehicleStatus,
  startSharingLocation,
  startTrip,
  submitRating,
  subscribeToTripChanges,
} from '@/lib/driver';
import AuthGate from '@/components/AuthGate';
import RealMap from '@/components/RealMap';

const VEHICLE_TYPES: VehicleType[] = ['berline', 'van', 'suv'];

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

export default function DriverDashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<MyDriverProfile | null>(null);
  const [vehicles, setVehicles] = useState<MyVehicle[]>([]);
  const [pending, setPending] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [summaryTrip, setSummaryTrip] = useState<Trip | null>(null);
  const [passengerName, setPassengerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newRequestAlert, setNewRequestAlert] = useState(false);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [ratingStars, setRatingStars] = useState(4);
  const [ratingTag, setRatingTag] = useState<'client_sympa' | 'aucun'>('aucun');
  const [comment, setComment] = useState('');
  const [bottomTab, setBottomTab] = useState<'accueil' | 'historique' | 'gains' | 'profil'>('accueil');
  const gpsStopFns = useRef<Record<string, () => void>>({});

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

  async function refreshAll(userId: string) {
    try {
      const { profile: p, driver, vehicles: v } = await getMyDriverData(userId);
      setProfile({ ...p, rating_avg: driver.rating_avg, validation_status: driver.validation_status });
      setVehicles(v);
      const [pendingTrips, activeTrip] = await Promise.all([getPendingTrips(), getMyActiveTrip(userId)]);
      setPending(pendingTrips);
      setActive(activeTrip);
      if (activeTrip?.passenger_id) {
        getPassengerName(activeTrip.passenger_id).then(setPassengerName);
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

  async function handleValidateSummary() {
    if (!summaryTrip || !session?.user) return;
    setBusy(true);
    setError(null);
    try {
      await submitRating(summaryTrip.id, session.user.id, ratingStars, comment || null, ratingTag);
      setSummaryTrip(null);
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'enregistrer l'évaluation.");
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0d0906]">
      <div className="absolute inset-0">
        <RealMap
          pitch={55}
          buildings3d
          driverPosition={driverPos}
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
        />
      </div>

      <div className="relative z-10 mx-3 mt-3 flex items-start justify-between rounded-2xl bg-[#1c1108]/85 px-4 py-3 backdrop-blur">
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${
            step === 'available' && online
              ? 'bg-[#2fae5c]/20 text-[#5be08a]'
              : step === 'available' && !online
                ? 'bg-white/10 text-[#c9bba8]'
                : 'bg-[#d99a1f]/20 text-[#f0c05a]'
          }`}
        >
          {step === 'available' ? (online ? 'En ligne' : 'Hors ligne') : step === 'summary' ? 'Disponible' : 'Occupé'}
        </span>

        <div className="flex flex-col items-center">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-[#e8c9a8] bg-[#e8c9a8]/20 text-sm font-extrabold text-[#e8c9a8]">
            {initials(profile?.full_name ?? null)}
          </div>
          <span className="mt-1 text-xs font-bold text-[#e8c9a8]">{profile?.full_name ?? 'Chauffeur'}</span>
        </div>

        {showCompass ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-[#e8c9a8]">
            <Compass size={20} />
          </span>
        ) : (
          <button
            onClick={handleToggleOnline}
            disabled={busy || step === 'accepted'}
            className={`relative h-7 w-12 flex-none rounded-full transition-colors ${online ? 'bg-[#2fae5c]' : 'bg-white/15'}`}
            aria-pressed={online}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                online ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        )}
      </div>

      {error && (
        <div className="relative z-10 mx-3 mt-2 rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-200">{error}</div>
      )}
      {newRequestAlert && (
        <div className="relative z-10 mx-3 mt-2 rounded-xl bg-[#e8c9a8]/15 px-3 py-2 text-xs font-bold text-[#e8c9a8]">
          🔔 Nouvelle course disponible !
        </div>
      )}

      {step === 'in_progress' && (
        <button
          onClick={openExternalNavigation}
          className="relative z-10 mx-3 mt-3 rounded-xl bg-[#2d6fe0] py-3 text-sm font-bold text-white"
        >
          🧭 Démarrer la navigation vers la destination
        </button>
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
            <span className="inline-block rounded-full bg-[#dff3e6] px-2.5 py-1 text-[11px] font-extrabold text-[#1c8a4a]">
              Course Acceptée - En route pour pickup
            </span>
            <TripCardBody trip={active} passengerName={passengerName} showDestinationLabel="Destination" />
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
            <span className="mb-1.5 inline-block rounded-full bg-[#2fae5c] px-2.5 py-1 text-[11px] font-extrabold text-white">
              En Course - Avec la cliente: {passengerName ?? '—'}
            </span>
            <TripCardBody trip={active} passengerName={passengerName} showDestinationLabel="Destination" />
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
              En Course - Avec la cliente: {passengerName ?? '—'}
            </span>

            <div className="mt-2 flex items-start gap-3">
              <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[#e8c9a8]/40 text-sm font-extrabold text-[#5a3a1c]">
                {initials(passengerName)}
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
                Valider et revenir à l&apos;accueil
              </button>
            </div>
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
        <div className="absolute inset-x-3 bottom-20 z-20 rounded-2xl bg-[#1c1108]/95 p-4 text-center text-sm text-[#e8c9a8]">
          Section « {bottomTab} » à venir.
          <button onClick={() => setBottomTab('accueil')} className="mt-2 block w-full text-xs text-[#c9bba8] underline">
            Retour à l&apos;accueil
          </button>
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
