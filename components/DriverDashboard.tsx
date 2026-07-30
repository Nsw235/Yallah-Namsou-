'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { Trip } from '@/types/database';
import { formatFCFA } from '@/lib/pricing';
import {
  MyDriverProfile,
  MyVehicle,
  acceptTrip,
  confirmCashPayment,
  finishTrip,
  getMyActiveTrip,
  getMyDriverData,
  getMyTripHistory,
  getPendingTrips,
  getTripPayment,
  setVehicleStatus,
  startSharingLocation,
  startTrip,
  subscribeToTripChanges,
} from '@/lib/driver';
import AuthGate from '@/components/AuthGate';
import RealMap from '@/components/RealMap';

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
    // silencieux si l'audio est bloqué par le navigateur
  }
}

export default function DriverDashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<MyDriverProfile | null>(null);
  const [vehicles, setVehicles] = useState<MyVehicle[]>([]);
  const [pending, setPending] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [history, setHistory] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newRequestAlert, setNewRequestAlert] = useState(false);
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
      const [pendingTrips, activeTrip, hist] = await Promise.all([
        getPendingTrips(),
        getMyActiveTrip(userId),
        getMyTripHistory(userId),
      ]);
      setPending(pendingTrips);
      setActive(activeTrip);
      setHistory(hist);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur de chargement.');
    }
  }

  useEffect(() => {
    if (session?.user) refreshAll(session.user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Écoute temps réel : nouvelle course "pending" -> notification + rafraîchissement
  // instantané des listes, sans attendre une action manuelle du chauffeur.
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

  async function handleToggleVehicle(v: MyVehicle) {
    setBusy(true);
    setError(null);
    try {
      const next = v.status === 'offline' ? 'available' : 'offline';
      await setVehicleStatus(v.id, next);
      if (next === 'available') {
        gpsStopFns.current[v.id]?.();
        gpsStopFns.current[v.id] = startSharingLocation(v.id);
      } else {
        gpsStopFns.current[v.id]?.();
        delete gpsStopFns.current[v.id];
      }
      if (session?.user) await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de changer le statut.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(trip: Trip) {
    if (!session?.user) return;
    const myVehicle = vehicles.find((v) => v.type === trip.vehicle_type && v.status === 'available');
    if (!myVehicle) {
      setError("Aucun de vos véhicules disponibles ne correspond à cette course (passez-le 'en ligne').");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptTrip(trip.id, session.user.id, myVehicle.id);
      if (!accepted) {
        setError('Trop tard : un autre chauffeur a déjà accepté cette course.');
      }
      await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'accepter cette course.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
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

  async function handleFinish() {
    if (!active || !active.vehicle_id) return;
    setBusy(true);
    setError(null);
    try {
      await finishTrip(active.id, active.vehicle_id, active.estimated_price ?? 0);
      const payment = await getTripPayment(active.id);
      if (payment?.method === 'cash') {
        await confirmCashPayment(active.id);
      }
      if (session?.user) await refreshAll(session.user.id);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de terminer la course.');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) return <div className="driver-wrap"><div className="spinner" /></div>;
  if (!session) return <div className="driver-wrap"><AuthGate onAuthed={() => {}} /></div>;

  if (profile && profile.validation_status !== 'approved') {
    return (
      <div className="driver-wrap">
        <div className="driver-card">
          <h2>Compte en attente de validation</h2>
          <p className="route-sub">Votre compte chauffeur doit être approuvé par un administrateur avant de recevoir des courses.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="driver-wrap">
      <div className="driver-card">
        <h1>Espace chauffeur</h1>
        <p className="route-sub">{profile?.full_name ?? 'Chauffeur'} — {Number(profile?.rating_avg ?? 5).toFixed(1)} ★</p>
        <p className="route-sub">{history.length} course(s) effectuée(s)</p>
      </div>

      {error && <div className="top-error">{error}</div>}
      {newRequestAlert && (
        <div className="driver-card" style={{ borderColor: 'var(--amber, #e8c9a8)' }}>
          🔔 Nouvelle course disponible !
        </div>
      )}

      <div className="driver-card">
        <h2>Mes véhicules</h2>
        {vehicles.length === 0 && <p className="route-sub">Aucun véhicule assigné.</p>}
        {vehicles.map((v) => (
          <div key={v.id} className="driver-list-row">
            <div>
              <div className="driver-name">{v.brand} {v.model} — {v.plate}</div>
              <div className="route-sub">{v.type.toUpperCase()} · statut : {v.status}</div>
            </div>
            <button
              className={`btn ${v.status === 'offline' ? 'amber' : 'ghost'}`}
              style={{ width: 'auto', padding: '8px 14px' }}
              disabled={busy || v.status === 'busy'}
              onClick={() => handleToggleVehicle(v)}
            >
              {v.status === 'offline' ? 'PASSER EN LIGNE' : 'PASSER HORS LIGNE'}
            </button>
          </div>
        ))}
      </div>

      {active ? (
        <div className="driver-trip-shell">
          <RealMap
            pitch={50}
            buildings3d
            pickup={{ lat: active.pickup_lat, lng: active.pickup_lng }}
            dropoff={{ lat: active.dropoff_lat, lng: active.dropoff_lng }}
            showRoute
            routeColor="#e8c9a8"
          />
          <div className="driver-trip-overlay">
            <div className="driver-trip-title">N&apos;Djamena</div>

            <div className="trip-top-row">
              <div className="trip-status-card glass">
                <div className="trip-status-pill">
                  <span className="pdot" />
                  {active.status === 'accepted' ? 'PASSAGER EN ATTENTE' : 'COURSE EN COURS'}
                </div>
                <div className="route-label">RÉCUPÉRATION À</div>
                <div className="route-addr" style={{ fontSize: 14 }}>{active.pickup_address ?? '—'}</div>
              </div>
              <div className="trip-detail-card glass">
                <div className="trip-eta-label">ETA CLIENT</div>
                <div className="trip-eta-val">—</div>
                <div className="trip-client-label">COURSE ESTIMÉE</div>
                <div className="trip-client-val">{formatFCFA(active.estimated_price)}</div>
              </div>
            </div>

            <div className="trip-metrics-panel glass copper-texture">
              <div className="trip-metrics-grid">
                <div className="metric-box">
                  <div>
                    <div className="mk">TEMPS D&apos;ITINÉRAIRE</div>
                    <div className="mv">Fluide</div>
                  </div>
                  <span>📈</span>
                </div>
                <div className="metric-box">
                  <div>
                    <div className="mk">STATUT</div>
                    <div className="mv">{active.status === 'accepted' ? 'Accepté' : 'En course'}</div>
                  </div>
                  <span>⏱</span>
                </div>
                <div className="metric-box">
                  <div>
                    <div className="mk">TRAFIC SUR ITINÉRAIRE</div>
                    <div className="mv">Fluide</div>
                  </div>
                  <span>🚦</span>
                </div>
                <div className="metric-box">
                  <div>
                    <div className="mk">PROCHAINE ÉTAPE</div>
                    <div className="mv">Suivre la route principale</div>
                  </div>
                  <span>🧭</span>
                </div>
              </div>
              <div className="trip-action-row">
                {active.status === 'accepted' ? (
                  <>
                    <button className="btn done" disabled style={{ flex: 1 }}>ARRIVÉ SUR SITE</button>
                    <button className="btn amber" disabled={busy} onClick={handleStart} style={{ flex: 1 }}>DÉMARRER LA COURSE</button>
                  </>
                ) : (
                  <button className="btn amber" disabled={busy} onClick={handleFinish} style={{ flex: 1 }}>TERMINER LA COURSE</button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="driver-card">
          <h2>Courses en attente</h2>
          {pending.length === 0 && <p className="route-sub">Aucune course en attente pour le moment.</p>}
          {pending.map((t) => (
            <div key={t.id} className="driver-list-row">
              <div>
                <div className="driver-name">{t.pickup_address} → {t.dropoff_address}</div>
                <div className="route-sub">{t.vehicle_type.toUpperCase()} · {formatFCFA(t.estimated_price)}</div>
              </div>
              <button className="btn cyan" style={{ width: 'auto', padding: '8px 14px' }} disabled={busy} onClick={() => handleAccept(t)}>
                ACCEPTER
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
