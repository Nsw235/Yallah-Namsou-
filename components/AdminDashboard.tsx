'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { formatFCFA } from '@/lib/pricing';
import {
  ActiveTripRow,
  DriverStatRow,
  FleetVehicle,
  checkIsAdmin,
  getActiveTrips,
  getDriverStats,
  getFleetOverview,
  setDriverValidation,
} from '@/lib/admin';
import AuthGate from '@/components/AuthGate';

export default function AdminDashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [activeTrips, setActiveTrips] = useState<ActiveTripRow[]>([]);
  const [drivers, setDrivers] = useState<DriverStatRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refresh() {
    try {
      const [f, t, d] = await Promise.all([getFleetOverview(), getActiveTrips(), getDriverStats()]);
      setFleet(f);
      setActiveTrips(t);
      setDrivers(d);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur de chargement.');
    }
  }

  useEffect(() => {
    if (!session?.user) return;
    checkIsAdmin(session.user.id)
      .then((ok) => {
        setIsAdmin(ok);
        if (ok) refresh();
      })
      .catch((e) => setError(e?.message ?? 'Erreur.'));
  }, [session?.user?.id]);

  async function handleValidation(driverId: string, status: 'approved' | 'rejected' | 'suspended') {
    setBusy(true);
    setError(null);
    try {
      await setDriverValidation(driverId, status);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined || (isAdmin === null && session)) {
    return <div className="driver-wrap"><div className="spinner" /></div>;
  }
  if (!session) return <div className="driver-wrap"><AuthGate onAuthed={() => {}} /></div>;
  if (isAdmin === false) {
    return (
      <div className="driver-wrap">
        <div className="driver-card">
          <h2>Accès refusé</h2>
          <p className="route-sub">Ce compte n&apos;a pas le rôle administrateur.</p>
        </div>
      </div>
    );
  }

  const busyCount = fleet.filter((v) => v.status === 'busy').length;
  const availableCount = fleet.filter((v) => v.status === 'available').length;

  return (
    <div className="driver-wrap">
      <div className="driver-card">
        <h1>Backoffice — Yalla Nimshi</h1>
        <p className="route-sub">
          {fleet.length} véhicule(s) · {availableCount} disponible(s) · {busyCount} en course
        </p>
      </div>

      {error && <div className="top-error">{error}</div>}

      <div className="driver-card">
        <h2>Courses en cours ({activeTrips.length})</h2>
        {activeTrips.length === 0 && <p className="route-sub">Aucune course en cours actuellement.</p>}
        {activeTrips.map((t) => (
          <div key={t.id} className="driver-list-row">
            <div>
              <div className="driver-name">{t.pickup_address} → {t.dropoff_address}</div>
              <div className="route-sub">
                {t.passenger_name ?? 'Passager'} avec {t.driver_name ?? 'chauffeur'} · {t.vehicle_type.toUpperCase()} · {formatFCFA(t.estimated_price)}
              </div>
            </div>
            <span className="star-badge">{t.status}</span>
          </div>
        ))}
      </div>

      <div className="driver-card">
        <h2>Flotte de véhicules</h2>
        {fleet.map((v) => (
          <div key={v.id} className="driver-list-row">
            <div>
              <div className="driver-name">{v.brand} {v.model} — {v.plate}</div>
              <div className="route-sub">{v.type.toUpperCase()} · chauffeur : {v.driver_name ?? '—'}</div>
            </div>
            <span className={`star-badge status-${v.status}`}>{v.status}</span>
          </div>
        ))}
      </div>

      <div className="driver-card">
        <h2>Chauffeurs</h2>
        {drivers.map((d) => (
          <div key={d.id} className="driver-list-row">
            <div>
              <div className="driver-name">{d.full_name ?? 'Chauffeur'}</div>
              <div className="route-sub">
                {Number(d.rating_avg).toFixed(1)} ★ · {d.completed_trips} course(s) · {d.validation_status}
              </div>
            </div>
            {d.validation_status !== 'approved' ? (
              <button className="btn cyan" style={{ width: 'auto', padding: '8px 14px' }} disabled={busy} onClick={() => handleValidation(d.id, 'approved')}>
                APPROUVER
              </button>
            ) : (
              <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px' }} disabled={busy} onClick={() => handleValidation(d.id, 'suspended')}>
                SUSPENDRE
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
