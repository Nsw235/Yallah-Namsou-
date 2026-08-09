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

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

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
        <button className="admin-burger-btn" onClick={handleLogout} aria-label="Déconnexion">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
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
        <button className="admin-nav-item admin-nav-item-logout" onClick={handleLogout} style={{ marginTop: 'auto' }}>
          <NavIcon>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </NavIcon>
          <span>Déconnexion</span>
        </button>
      </div>

      {error && (
        <div className="top-error" style={{ position: 'static' }}>
          {error}
        </div>
      )}

      {(nav === 'dashboard' || nav === 'map') && (
        <div>
          <div className="adm2-section" style={{ borderBottom: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="adm2-section-title">Vue d&apos;ensemble</p>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8.5, fontWeight: 600, color: '#5a9c6f', background: '#0e1f14', borderRadius: 4, padding: '3px 6px' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#5a9c6f' }} />LIVE
              </span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 9, color: '#736a5a' }}>N&apos;Djamena — {dateStr} — {timeStr}</p>
          </div>

          <div style={{ position: 'relative', height: 200 }}>
            <RealMap pitch={0} buildings3d={false} showRoute={false} pins={fleetPins} overviewZoom={12.3} />
            <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', gap: 6, pointerEvents: 'none' }}>
              <span style={{ flex: 1, fontSize: 8.5, fontWeight: 600, color: '#8fbfa0', background: 'rgba(14,31,20,0.9)', borderRadius: 5, padding: '4px 7px', textAlign: 'center' }}>
                {availableVehicles.length} attente
              </span>
              <span style={{ flex: 1, fontSize: 8.5, fontWeight: 600, color: '#9cc4f5', background: 'rgba(16,23,34,0.9)', borderRadius: 5, padding: '4px 7px', textAlign: 'center' }}>
                {busyVehicles.length} en course
              </span>
              <span style={{ flex: 1, fontSize: 8.5, fontWeight: 600, color: '#a89680', background: 'rgba(26,23,18,0.9)', borderRadius: 5, padding: '4px 7px', textAlign: 'center' }}>
                {offlineVehicles.length} hors ligne
              </span>
            </div>
          </div>

          <div className="adm2-hero" style={{ paddingTop: 12 }}>
            <div className="adm2-hero-top">
              <div>
                <p className="adm2-hero-label">REVENUS · AUJOURD&apos;HUI</p>
                <p className="adm2-hero-value">
                  {metrics ? formatFCFA(metrics.revenueToday).replace(' FCFA', '') : '—'} <span className="unit">FCFA</span>
                </p>
              </div>
            </div>
          </div>

          <div className="adm2-kpi-grid">
            <div className="adm2-kpi-cell">
              <p className="adm2-kpi-cell-label">OCCUPATION</p>
              <div className="adm2-kpi-cell-value">
                <span className="n">{occupancyRate}%</span>
                <span className="t" style={{ color: '#736a5a' }}>{busyVehicles.length}/{online.length} en ligne</span>
              </div>
            </div>
            <div className="adm2-kpi-cell">
              <p className="adm2-kpi-cell-label">ANNULATION</p>
              <div className="adm2-kpi-cell-value">
                <span className="n">{metrics ? metrics.cancellationRate : 0}%</span>
              </div>
            </div>
          </div>

          <div className="adm2-row-header">
            <p className="adm2-section-title" style={{ fontSize: 11 }}>Répartition de la flotte</p>
            <span style={{ fontSize: 9, color: '#736a5a' }}>{fleet.length} véhicule{fleet.length > 1 ? 's' : ''}</span>
          </div>
          <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {byType.map((b) => (
              <div key={b.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 66, fontSize: 10, color: '#c9c2b3', flexShrink: 0 }}>
                  {b.type === 'berline' ? 'Berline' : b.type === 'van' ? 'Van' : 'SUV'}
                </span>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#1a1712', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${b.pct}%`, background: typeColors[b.type] }} />
                </div>
                <span style={{ width: 30, fontSize: 9, fontFamily: 'var(--font-mono)', color: '#8a8171', textAlign: 'right', flexShrink: 0 }}>{b.pct}%</span>
              </div>
            ))}
          </div>

          <div className="adm2-row-header">
            <p className="adm2-section-title" style={{ fontSize: 11 }}>Alertes</p>
            <button
              onClick={() => setAlertFilter((f) => (f === 'all' ? 'crit' : f === 'crit' ? 'warn' : 'all'))}
              style={{ fontSize: 9, color: '#8a8171', background: 'none', border: 'none' }}
            >
              {alertFilter === 'all' ? 'Toutes' : alertFilter === 'crit' ? 'Critiques' : 'Avertissements'} ⌄
            </button>
          </div>
          <div className="adm2-list" style={{ paddingBottom: 8 }}>
            {visibleAlerts.length === 0 && <div className="adm2-empty">Aucune alerte actuellement.</div>}
            {visibleAlerts.map((a, i) => (
              <div key={i} className="adm2-toggle-row">
                <span className="adm2-row-dot" style={{ background: a.level === 'crit' ? '#c9645f' : '#d9a441' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="adm2-row-title">{a.title}</p>
                  <p className="adm2-row-sub">{a.sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="adm2-row-header" style={{ paddingBottom: 8 }}>
            <p className="adm2-section-title" style={{ fontSize: 11 }}>Actions</p>
          </div>
          <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="adm2-row" style={{ border: '0.5px solid #241f18', borderRadius: 8, justifyContent: 'center' }} onClick={() => setNav('settings')}>
              <span style={{ fontSize: 10, color: '#c9c2b3' }}>Gestion des tarifs</span>
            </button>
            <button className="adm2-row" style={{ border: '0.5px solid #241f18', borderRadius: 8, justifyContent: 'center' }} onClick={() => setActionModal('notif')}>
              <span style={{ fontSize: 10, color: '#c9c2b3' }}>Notification flotte</span>
            </button>
            <button className="adm2-row" style={{ border: '0.5px solid #241f18', borderRadius: 8, justifyContent: 'center' }} onClick={() => setActionModal('maint')}>
              <span style={{ fontSize: 10, color: '#c9c2b3' }}>Maintenance</span>
            </button>
            <button className="adm2-row" style={{ border: '0.5px solid #241f18', borderRadius: 8, justifyContent: 'center' }} onClick={() => setActionModal('call')}>
              <span style={{ fontSize: 10, color: '#c9c2b3' }}>Appels opérateurs</span>
            </button>
          </div>
        </div>
      )}

      {nav === 'fleet' && (
        <div>
          <AdminFleetView fleet={fleet} drivers={drivers} busy={busy} onChanged={refresh} />
          <div className="adm2-row-header" style={{ borderTop: '0.5px solid #1a1712' }}>
            <p className="adm2-section-title" style={{ fontSize: 11 }}>Courses en cours ({activeTrips.length})</p>
          </div>
          {activeTrips.length === 0 ? (
            <div className="adm2-empty">Aucune course en cours actuellement.</div>
          ) : (
            <div className="adm2-list" style={{ paddingBottom: 12 }}>
              {activeTrips.map((t) => (
                <div key={t.id} className="adm2-row" style={{ cursor: 'default' }}>
                  <span className="adm2-row-dot" style={{ background: t.status === 'in_progress' ? '#5a9c6f' : '#d9a441' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="adm2-row-title">{t.pickup_address} → {t.dropoff_address}</p>
                    <p className="adm2-row-sub">{t.passenger_name ?? 'Passager'} avec {t.driver_name ?? 'chauffeur'} · {t.vehicle_type.toUpperCase()}</p>
                  </div>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#8a8171', flexShrink: 0 }}>{formatFCFA(t.estimated_price)}</span>
                </div>
              ))}
            </div>
          )}
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
