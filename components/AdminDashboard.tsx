'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { formatFCFA } from '@/lib/pricing';
import {
  ActiveTripRow,
  AdminMetrics,
  DriverDetail,
  FleetVehicle,
  checkIsAdmin,
  getActiveTrips,
  getAdminMetrics,
  getDriverDetails,
  getFleetOverview,
  scheduleMaintenance,
  sendFleetNotification,
  setDriverValidation,
  subscribeToFleetChanges,
} from '@/lib/admin';
import AuthGate from '@/components/AuthGate';
import RealMap from '@/components/RealMap';
import AdminFleetView from '@/components/admin/AdminFleetView';
import AdminDriversView from '@/components/admin/AdminDriversView';
import AdminAnalyticsView from '@/components/admin/AdminAnalyticsView';
import AdminSettingsView from '@/components/admin/AdminSettingsView';
import { ToastProvider, useToast } from '@/components/Toast';

type NavKey = 'dashboard' | 'map' | 'fleet' | 'drivers' | 'analytics' | 'settings';

const NAV_ITEMS: { key: NavKey; label: string; icon: JSX.Element }[] = [
  { key: 'dashboard', label: 'Tableau\nde bord', icon: <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" /> },
  { key: 'map', label: 'Supervision\nCarte', icon: <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Zm0 0v15m6-12v15" /> },
  { key: 'fleet', label: 'Flotte', icon: <path d="M3 13l2-6h14l2 6v6H3v-6Zm3 6v2m12-2v2M3 13h18M7 16h.01M17 16h.01" /> },
  { key: 'drivers', label: 'Chauffeurs', icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" /> },
  { key: 'analytics', label: 'Analyses', icon: <path d="M4 20V10M11 20V4M18 20v-7" /> },
  { key: 'settings', label: 'Paramètres', icon: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3-1.7-.6.4-1.8-1.4-1.4-1.8.4L15 7l-.6-1.9h-2L11.8 7l-1.8-.4-1.4 1.4.4 1.8L7.5 9.6l.4 1.8-.4 1.8L9.5 14l-.4 1.8 1.4 1.4 1.8-.4.6 1.9h2l.6-1.9 1.8.4 1.4-1.4-.4-1.8 1.7-.7Z" /> },
];

function NavIcon({ children }: { children: JSX.Element }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function AdminDashboardInner() {
  const pushToast = useToast();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [activeTrips, setActiveTrips] = useState<ActiveTripRow[]>([]);
  const [drivers, setDrivers] = useState<DriverDetail[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nav, setNav] = useState<NavKey>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [actionModal, setActionModal] = useState<'notif' | 'maint' | 'call' | null>(null);
  const [notifMessage, setNotifMessage] = useState('');
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifErr, setNotifErr] = useState<string | null>(null);
  const [maintSelected, setMaintSelected] = useState<string[]>([]);
  const [maintDate, setMaintDate] = useState('');
  const [maintNote, setMaintNote] = useState('');
  const [maintSaving, setMaintSaving] = useState(false);
  const [maintErr, setMaintErr] = useState<string | null>(null);

  const NAV_LABELS: Record<NavKey, string> = {
    dashboard: 'Tableau de bord',
    map: 'Supervision Carte',
    fleet: 'Flotte',
    drivers: 'Chauffeurs',
    analytics: 'Analyses',
    settings: 'Paramètres',
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refresh() {
    try {
      const [f, t, d, m] = await Promise.all([
        getFleetOverview(),
        getActiveTrips(),
        getDriverDetails(),
        getAdminMetrics(),
      ]);
      setFleet(f);
      setActiveTrips(t);
      setDrivers(d);
      setMetrics(m);
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

  // Rafraîchit périodiquement pour un effet "temps réel" sur la carte et les métriques.
  useEffect(() => {
    if (!isAdmin) return;
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [isAdmin]);

  // En complément du polling ci-dessus : mise à jour instantanée dès qu'un
  // véhicule change de statut ou de position GPS, pour que la carte de
  // supervision (onglet "Supervision Carte") reflète la flotte en direct.
  useEffect(() => {
    if (!isAdmin) return;
    const unsubscribe = subscribeToFleetChanges(refresh);
    return unsubscribe;
  }, [isAdmin]);

  async function sendNotification() {
    if (!notifMessage.trim() || !session?.user) return;
    setNotifSaving(true);
    setNotifErr(null);
    try {
      await sendFleetNotification(notifMessage.trim(), session.user.id, online.length);
      pushToast(`Notification envoyée à ${online.length} chauffeur${online.length !== 1 ? 's' : ''} en ligne`);
      setNotifMessage('');
      setActionModal(null);
    } catch (e: any) {
      setNotifErr(e?.message ?? "Échec de l'envoi.");
    } finally {
      setNotifSaving(false);
    }
  }

  function toggleMaintVehicle(id: string) {
    setMaintSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  }

  async function planMaintenance() {
    if (!session?.user || maintSelected.length === 0 || !maintDate) return;
    setMaintSaving(true);
    setMaintErr(null);
    try {
      await scheduleMaintenance(maintSelected, maintDate, session.user.id, maintNote.trim() || undefined);
      pushToast(`Maintenance planifiée pour ${maintSelected.length} véhicule${maintSelected.length !== 1 ? 's' : ''}`);
      setMaintSelected([]);
      setMaintDate('');
      setMaintNote('');
      setActionModal(null);
      await refresh();
    } catch (e: any) {
      setMaintErr(e?.message ?? 'Échec de la planification.');
    } finally {
      setMaintSaving(false);
    }
  }

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

  const online = fleet.filter((v) => v.status !== 'offline');
  const busyVehicles = fleet.filter((v) => v.status === 'busy');
  const availableVehicles = fleet.filter((v) => v.status === 'available');
  const offlineVehicles = fleet.filter((v) => v.status === 'offline');
  const occupancyRate = online.length > 0 ? Math.round((busyVehicles.length / online.length) * 1000) / 10 : 0;

  const byType = useMemo(() => {
    const types: Array<'berline' | 'van' | 'suv'> = ['berline', 'van', 'suv'];
    const total = fleet.length || 1;
    return types.map((t) => {
      const count = fleet.filter((v) => v.type === t).length;
      return { type: t, count, pct: Math.round((count / total) * 100) };
    });
  }, [fleet]);

  const typeColors: Record<string, string> = { berline: 'var(--copper-light)', van: 'var(--copper)', suv: 'var(--copper-dark)' };

  // Pins temps réel pour la carte de supervision : un point coloré par
  // véhicule géolocalisé, statut encodé par couleur (vert = en attente /
  // bleu = en course / gris = hors ligne, exclu de la carte car sans intérêt
  // opérationnel et potentiellement sans position récente).
  const STATUS_DOT_COLOR: Record<FleetVehicle['status'], string> = {
    available: '#35e6a0',
    busy: '#35d4ff',
    offline: '#8a7a6b',
  };
  const fleetPins = fleet
    .filter((v) => v.status !== 'offline' && v.last_lat != null && v.last_lng != null)
    .map((v) => ({
      position: { lat: v.last_lat as number, lng: v.last_lng as number },
      dot: {
        color: STATUS_DOT_COLOR[v.status],
        pulse: v.status === 'busy',
        label: v.plate,
      },
    }));
  const donutGradient = (() => {
    let acc = 0;
    const stops = byType.map((b) => {
      const from = acc;
      acc += b.pct;
      return `${typeColors[b.type]} ${from}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  })();

  // Alertes dérivées de données réelles : les incidents ne sont pas encore trackés en base,
  // donc on remonte ici les signaux concrets déjà disponibles (courses en attente, chauffeurs
  // suspendus, véhicules indisponibles) plutôt que des valeurs inventées.
  const alerts = useMemo(() => {
    const list: { level: 'crit' | 'warn'; title: string; sub: string }[] = [];
    drivers
      .filter((d) => d.validation_status === 'suspended')
      .forEach((d) => list.push({ level: 'crit', title: `${d.full_name ?? 'Chauffeur'} suspendu`, sub: 'Validation requise' }));
    if (offlineVehicles.length > 0) {
      list.push({ level: 'warn', title: `${offlineVehicles.length} véhicule(s) indisponible(s)`, sub: 'Hors ligne actuellement' });
    }
    activeTrips
      .filter((t) => t.status === 'accepted')
      .slice(0, 3)
      .forEach((t) =>
        list.push({
          level: 'warn',
          title: `Course en attente de départ`,
          sub: `${t.pickup_address ?? '—'} → ${t.dropoff_address ?? '—'}`,
        })
      );
    return list;
  }, [drivers, offlineVehicles, activeTrips]);

  const [alertFilter, setAlertFilter] = useState<'all' | 'crit' | 'warn'>('all');
  const visibleAlerts = useMemo(
    () => (alertFilter === 'all' ? alerts : alerts.filter((a) => a.level === alertFilter)),
    [alerts, alertFilter]
  );

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

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

  return (
    <div className="admin-shell">
      <div className="admin-mobile-topbar">
        <button className="admin-burger-btn" onClick={() => setMobileNavOpen(true)} aria-label="Ouvrir le menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h2>{NAV_LABELS[nav]}</h2>
        <span style={{ width: 42 }} />
      </div>

      {mobileNavOpen && <div className="admin-nav-overlay" onClick={() => setMobileNavOpen(false)} />}

      <div className={`admin-nav ${mobileNavOpen ? 'mobile-open' : ''}`}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`admin-nav-item ${nav === item.key ? 'active' : ''}`}
            onClick={() => {
              setNav(item.key);
              setMobileNavOpen(false);
            }}
          >
            <NavIcon>{item.icon}</NavIcon>
            <span style={{ whiteSpace: 'pre-line' }}>{item.label}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="top-error" style={{ position: 'static' }}>
          {error}
        </div>
      )}

      {(nav === 'dashboard' || nav === 'map') && (
        <>
          <div className="admin-main">
            <div className="admin-main-head">
              <h2>Carte interactive de la ville</h2>
              <div className="admin-status-banner">
                <span className="dot" />
                Supervision Totale de la Ville — N&apos;Djamena — {dateStr} — {timeStr}
              </div>
            </div>
            <div className="admin-map-wrap">
              <RealMap pitch={0} buildings3d={false} showRoute={false} pins={fleetPins} overviewZoom={12.3} />
              <div className="admin-map-overlay">
                <span className="heatmap-label">
                  {fleetPins.length} véhicule{fleetPins.length !== 1 ? 's' : ''} géolocalisé{fleetPins.length !== 1 ? 's' : ''} en direct
                </span>
                <div className="vehicle-positions">
                  <div className="veh-pos-row"><span className="veh-pos-dot" style={{ background: '#35e6a0' }} />En attente · {availableVehicles.length}</div>
                  <div className="veh-pos-row"><span className="veh-pos-dot" style={{ background: '#35d4ff' }} />En course · {busyVehicles.length}</div>
                  <div className="veh-pos-row"><span className="veh-pos-dot" style={{ background: '#8a7a6b' }} />Hors ligne · {offlineVehicles.length}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="admin-side">
            <div className="admin-panel">
              <h3>État de la Flotte</h3>
              <div className="fleet-bars">
                {[
                  { v: fleet.length, l: 'Total\nVéhicules' },
                  { v: online.length, l: 'En\nLigne' },
                  { v: busyVehicles.length, l: 'En\nCourse' },
                  { v: availableVehicles.length, l: 'En\nAttente' },
                  { v: offlineVehicles.length, l: 'Indis-\nponible' },
                ].map((b, i) => {
                  const max = Math.max(fleet.length, 1);
                  return (
                    <div key={i} className="fleet-bar-col">
                      <div className="fleet-bar-val">{b.v}</div>
                      <div className="fleet-bar" style={{ height: `${Math.max(6, (b.v / max) * 100)}%` }} />
                      <div className="fleet-bar-lbl" style={{ whiteSpace: 'pre-line' }}>{b.l}</div>
                    </div>
                  );
                })}
              </div>
              <div className="donut-row">
                <div className="donut" style={{ background: fleet.length ? donutGradient : 'rgba(255,255,255,0.08)' }} />
                <div className="donut-legend">
                  {byType.map((b) => (
                    <div key={b.type} className="li">
                      <span className="sw" style={{ background: typeColors[b.type] }} />
                      {b.pct}% {b.type === 'berline' ? 'Berline' : b.type === 'van' ? 'Vana' : 'Er SUV'}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="admin-panel">
              <h3>Performance Clé</h3>
              <div className="kpi-row">
                <div className="kpi-box">
                  <div className="kpi-label">TAUX D&apos;OCCUPATION</div>
                  <div className="kpi-value up">{occupancyRate}%</div>
                </div>
                <div className="kpi-box">
                  <div className="kpi-label">REVENUS (Temps réel)</div>
                  <div className="kpi-value">{metrics ? formatFCFA(metrics.revenueToday) : '—'}</div>
                </div>
                <div className="kpi-box">
                  <div className="kpi-label">TAUX D&apos;ANNULATION</div>
                  <div className="kpi-value down">{metrics ? metrics.cancellationRate : 0}%</div>
                </div>
              </div>
            </div>

            <div className="admin-panel">
              <h3>Alertes et Incidents</h3>
              <button
                className="alert-filter"
                onClick={() => setAlertFilter((f) => (f === 'all' ? 'crit' : f === 'crit' ? 'warn' : 'all'))}
              >
                ⚙ {alertFilter === 'all' ? 'Toutes les alertes' : alertFilter === 'crit' ? 'Critiques uniquement' : 'Avertissements uniquement'}
              </button>
              <div className="alert-list">
                {visibleAlerts.length === 0 && <div className="alert-empty">Aucune alerte actuellement.</div>}
                {visibleAlerts.map((a, i) => (
                  <div key={i} className="alert-row">
                    <span className={`adot ${a.level}`} />
                    <div className="atext">
                      <b>{a.title}</b>
                      <span>{a.sub}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="admin-actions">
            <h3>Actions Administratives</h3>
            <div className="admin-actions-grid">
              <button className="admin-action-btn" onClick={() => setNav('settings')}>GESTION DES TARIFS</button>
              <button className="admin-action-btn" onClick={() => setActionModal('notif')}>NOTIFICATION FLOTTE</button>
              <button className="admin-action-btn" onClick={() => setActionModal('maint')}>MAINTENANCE VÉHICULES</button>
              <button className="admin-action-btn" onClick={() => setActionModal('call')}>APPELS OPÉRATEURS</button>
            </div>
          </div>
        </>
      )}

      {nav === 'fleet' && (
        <div className="admin-list-view">
          <AdminFleetView fleet={fleet} drivers={drivers} busy={busy} onChanged={refresh} />
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
        </div>
      )}

      {nav === 'drivers' && <AdminDriversView drivers={drivers} busy={busy} onChanged={refresh} />}

      {nav === 'analytics' && <AdminAnalyticsView drivers={drivers} />}

      {nav === 'settings' && session && <AdminSettingsView session={session} />}

      {actionModal === 'notif' && (
        <div className="modal-overlay" onClick={() => setActionModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Notification flotte</h3>
            <p className="route-sub" style={{ marginBottom: 14 }}>
              Envoyée à {online.length} chauffeur{online.length !== 1 ? 's' : ''} en ligne actuellement.
            </p>
            <div className="field">
              <label>MESSAGE</label>
              <textarea
                rows={4}
                style={{ resize: 'none' }}
                placeholder="Écrivez votre message…"
                value={notifMessage}
                onChange={(e) => setNotifMessage(e.target.value)}
              />
            </div>
            {notifErr && <div className="auth-error">{notifErr}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setActionModal(null)}>Annuler</button>
              <button className="btn amber" disabled={notifSaving || !notifMessage.trim()} onClick={sendNotification}>
                {notifSaving ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal === 'maint' && (
        <div className="modal-overlay" onClick={() => setActionModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Maintenance véhicules</h3>
            {fleet.map((v) => (
              <div className="modal-list-row" key={v.id}>
                <input type="checkbox" checked={maintSelected.includes(v.id)} onChange={() => toggleMaintVehicle(v.id)} />
                <div style={{ flex: 1 }}>
                  <div className="driver-name">{v.brand} {v.model}</div>
                  <div className="route-sub">{v.plate}</div>
                </div>
              </div>
            ))}
            <div className="field" style={{ marginTop: 12 }}>
              <label>DATE PLANIFIÉE</label>
              <input type="date" value={maintDate} onChange={(e) => setMaintDate(e.target.value)} />
            </div>
            <div className="field">
              <label>NOTE (OPTIONNEL)</label>
              <input placeholder="Ex : vidange, contrôle technique…" value={maintNote} onChange={(e) => setMaintNote(e.target.value)} />
            </div>
            {maintErr && <div className="auth-error">{maintErr}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setActionModal(null)}>Annuler</button>
              <button className="btn amber" disabled={maintSaving || maintSelected.length === 0 || !maintDate} onClick={planMaintenance}>
                {maintSaving ? 'Planification…' : 'Planifier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal === 'call' && (
        <div className="modal-overlay" onClick={() => setActionModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Appels opérateurs</h3>
            {[
              { n: "Standard N'Djamena", p: '+235 22 51 00 00' },
              { n: 'Support technique', p: '+235 22 51 00 01' },
            ].map((o) => (
              <div className="modal-list-row" key={o.p}>
                <div style={{ flex: 1 }}>
                  <div className="driver-name">{o.n}</div>
                  <div className="route-sub">{o.p}</div>
                </div>
                <a
                  className="btn amber"
                  style={{ width: 'auto', padding: '10px 16px' }}
                  href={`tel:${o.p.replace(/\s/g, '')}`}
                  onClick={() => pushToast(`Appel vers ${o.n}`)}
                >
                  Appeler
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <ToastProvider>
      <AdminDashboardInner />
    </ToastProvider>
  );
}
