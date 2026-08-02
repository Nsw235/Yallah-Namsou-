'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Plus,
  Car,
  MapPin,
  User,
  Bell,
  Map as MapIcon,
  UserCog,
  LifeBuoy,
  ChevronRight,
  LogOut,
  ArrowUpDown,
  Download,
  ChevronDown,
  Maximize2,
  Crosshair,
  BarChart3,
  Settings as SettingsIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { checkIsAdmin } from '@/lib/admin';
import AuthGate from '@/components/AuthGate';
import { MOCK_STATS } from '@/components/legacy/mockData';
import { getFleetOverview, subscribeToFleetChanges, type FleetVehicle } from '@/lib/admin';
import { CAR_MODEL_BY_TYPE } from '@/lib/pricing';
import type { VehicleType } from '@/types/database';
import RealMap, { type MapPin as MapPinData } from '@/components/RealMap';

type NavKey = 'flotte' | 'carte' | 'stats' | 'parametres';

const STATUS_DOT: Record<FleetVehicle['status'], string> = {
  busy: '#2fae5c',
  available: '#d99a1f',
  offline: '#d1443f',
};
const STATUS_LABEL: Record<FleetVehicle['status'], string> = {
  busy: 'En Course',
  available: 'En Attente',
  offline: 'Indisponible',
};

export default function SupervisionOverview() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<NavKey>('flotte');
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [fleetError, setFleetError] = useState<string | null>(null);

  const flotteRef = useRef<HTMLDivElement>(null);
  const carteRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const paramsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    checkIsAdmin(session.user.id)
      .then((ok) => setIsAdmin(ok))
      .catch((e) => setError(e?.message ?? 'Erreur.'));
  }, [session?.user?.id]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    function load() {
      getFleetOverview()
        .then((rows) => {
          if (!cancelled) setFleet(rows);
        })
        .catch((e) => setFleetError(e?.message ?? "Impossible de charger la flotte."));
    }
    load();
    const unsubscribe = subscribeToFleetChanges(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isAdmin]);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  function goTo(key: NavKey) {
    setNav(key);
    const map: Record<NavKey, React.RefObject<HTMLDivElement>> = {
      flotte: flotteRef,
      carte: carteRef,
      stats: statsRef,
      parametres: paramsRef,
    };
    map[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const maxVal = Math.max(...MOCK_STATS.byType.map((b) => b.value), 1);

  if (session === undefined || (isAdmin === null && session)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7f0e4]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#7a3a1c] border-t-transparent" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-dvh bg-[#f7f0e4]">
        <AuthGate onAuthed={() => {}} />
      </div>
    );
  }
  if (isAdmin === false) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7f0e4] p-6 text-center">
        <div>
          <h2 className="text-lg font-extrabold text-[#1c1108]">Accès refusé</h2>
          <p className="mt-1 text-sm text-[#6b6459]">Ce compte n&apos;a pas le rôle administrateur.</p>
          <button onClick={handleLogout} className="mt-4 rounded-xl bg-[#7a3a1c] px-4 py-2 text-sm font-bold text-white">
            Déconnexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#f7f0e4] font-sans">
      {error && <div className="bg-red-100 p-2 text-center text-xs text-red-700">{error}</div>}

      <div className="flex-1 overflow-y-auto pb-4">
        {/* Header */}
        <div className="px-3 pt-3">
          <div className="relative rounded-2xl border border-[#e4d7bf] bg-[#fbf7ef] px-4 py-3.5">
            <button
              onClick={handleLogout}
              aria-label="Déconnexion"
              className="absolute right-3 top-3 text-[#8a5a2c]"
            >
              <LogOut size={18} />
            </button>
            <h1 className="max-w-[85%] text-xl font-extrabold leading-tight text-[#1c1108]">
              Yallah Namsou
              <br />• Supervision Totale
            </h1>
            <div className="mt-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-[#5a5348]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2fae5c]" />
                {dateStr} {timeStr}
              </span>
              <span className="flex items-center gap-1 text-xs font-bold text-[#8a5a2c]">
                <ArrowUpDown size={13} /> Filtrer/Trier
              </span>
            </div>
          </div>
        </div>

        {/* Colonnes Flotte / Stats+Paramètres */}
        <div className="flex gap-2 px-3 pt-2">
          {/* Flotte */}
          <div ref={flotteRef} className="flex flex-[0.95] flex-col gap-2">
            <button className="rounded-xl bg-[#7a3a1c] py-2.5 text-xs font-extrabold text-white">
              <span className="inline-flex items-center gap-1">
                <Plus size={14} /> Add New Vehicle
              </span>
            </button>

            {fleetError && <div className="rounded-lg bg-red-100 px-2 py-1 text-[10px] text-red-700">{fleetError}</div>}
            {fleet.length === 0 && !fleetError && (
              <div className="rounded-xl border border-[#e4d7bf] bg-[#fbf7ef] px-3 py-4 text-center text-[10px] text-[#8a8378]">
                Aucun véhicule enregistré.
              </div>
            )}
            {fleet.map((v) => (
              <div key={v.id} className="rounded-xl border border-[#e4d7bf] bg-[#fbf7ef] px-3 py-2.5">
                <div className="flex justify-between text-[10px] text-[#8a8378]">
                  <span>Plaque: {v.plate}</span>
                  <span>STATUS:</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-extrabold text-[#1c1108]">
                    <Car size={15} className="text-[#8a5a2c]" /> {v.brand ?? ''} {v.model ?? v.type.toUpperCase()}
                  </span>
                  <span className="text-[11px] font-extrabold" style={{ color: STATUS_DOT[v.status] }}>
                    ● {STATUS_LABEL[v.status]}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#6b6459]">
                  <User size={10} /> Chauffeur: {(v.driver_name ?? '—').toUpperCase()}
                </div>
                <button className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-full bg-[#f0dfc4] py-1.5 text-[10px] font-extrabold text-[#7a3a1c]">
                  <MapPin size={11} /> LOCALISER
                </button>
              </div>
            ))}
          </div>

          {/* Stats + Paramètres */}
          <div className="flex flex-[1.05] flex-col rounded-2xl border border-[#e4d7bf] bg-[#fbf7ef] p-3">
            <div ref={statsRef}>
              <h2 className="text-sm font-extrabold text-[#1c1108]">Stats &amp; Analytics</h2>
              <p className="mb-2 text-[10px] text-[#8a8378]">Aujourd&apos;hui ({dateStr.slice(0, 5)})</p>

              <div className="flex justify-between text-center">
                <Kpi label="Total Courses:" value={String(MOCK_STATS.totalCourses)} />
                <Kpi label="Revenus:" value={`${MOCK_STATS.revenue}€`} />
                <Kpi label="Courses/Heure:" value={String(MOCK_STATS.coursesPerHour)} />
              </div>

              <h3 className="mt-3 text-[11px] font-bold text-[#1c1108]">Courses par Type (Derniers 7 Jours)</h3>
              <div className="mt-1.5 flex gap-1">
                <div className="flex h-16 flex-col justify-between text-right text-[9px] text-[#a39c8f]">
                  <span>{maxVal}</span>
                  <span>{Math.round((maxVal * 3) / 4)}</span>
                  <span>{Math.round(maxVal / 2)}</span>
                  <span>{Math.round(maxVal / 4)}</span>
                  <span>0</span>
                </div>
                <div className="flex h-16 flex-1 items-end gap-1.5 border-l border-[#e4d7bf] pl-1.5">
                  {MOCK_STATS.byType.map((b, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t bg-[#7a3a1c]"
                      style={{ height: `${Math.max(6, (b.value / maxVal) * 100)}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-2.5 flex gap-1.5">
                <button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#f0dfc4] py-1.5 text-[10px] font-bold text-[#7a3a1c]">
                  Aujourd&apos;hui <ChevronDown size={12} />
                </button>
                <button className="flex flex-[1.2] items-center justify-center gap-1 rounded-lg bg-[#f0dfc4] py-1.5 text-[10px] font-bold text-[#7a3a1c]">
                  <Download size={12} /> Exporter CSV/PDF
                </button>
              </div>
            </div>

            <div ref={paramsRef} className="mt-3 border-t border-[#e4d7bf] pt-2.5">
              <h2 className="mb-1 text-xs font-extrabold text-[#1c1108]">Section Paramètres &amp; Contrôles</h2>

              <SettingsRow icon={<Bell size={13} />} title="Alertes &amp; Notifications" action="Gérer les Alertes" />
              <SettingsRow icon={<MapIcon size={13} />} title="Gestion de la Carte" toggle />
              <SettingsRow icon={<UserCog size={13} />} title="Profil &amp; Sécurité" action="Changer MDP / Logs" />
              <SettingsRow icon={<LifeBuoy size={13} />} title="Soutien Technique" action="Contacter Support" />

              <button
                onClick={handleLogout}
                className="mt-1 flex w-full items-center justify-between border-t border-[#e4d7bf] py-1.5 pt-2 text-left"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#c0342e]">
                  <LogOut size={13} /> Déconnexion
                </span>
                <ChevronRight size={13} className="text-[#c0342e]" />
              </button>
            </div>
          </div>
        </div>

        {/* Carte */}
        <div ref={carteRef} className="px-3 pt-2">
          <div className="relative h-64 overflow-hidden rounded-2xl bg-[#e2ddcf]">
            <RealMap
              pitch={75}
              buildings3d
              pins={fleet
                .filter((v) => v.last_lat != null && v.last_lng != null)
                .map<MapPinData>((v) => ({
                  position: { lat: v.last_lat as number, lng: v.last_lng as number },
                  car3d: { modelUrl: CAR_MODEL_BY_TYPE[v.type as VehicleType] },
                }))}
            />
            {fleet
              .filter((v) => v.last_lat != null && v.last_lng != null)
              .map((v, i) => (
                <span
                  key={v.id}
                  className="pointer-events-none absolute z-10 rounded-full px-2 py-1 text-[9px] font-extrabold text-white"
                  style={{
                    background: STATUS_DOT[v.status],
                    top: `${10 + i * 30}%`,
                    left: i % 2 === 0 ? '6%' : undefined,
                    right: i % 2 === 1 ? '6%' : undefined,
                  }}
                >
                  ● {STATUS_LABEL[v.status]}
                </span>
              ))}
            <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border-[1.5px] border-[#1c1108] bg-white px-3.5 py-1.5 text-xs font-extrabold text-[#1c1108]">
              TAHBI
            </span>
            <button
              aria-label="Plein écran"
              className="absolute bottom-2.5 left-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[#1c1108] bg-white text-[#1c1108]"
            >
              <Maximize2 size={14} />
            </button>
            <button
              aria-label="Géolocaliser"
              className="absolute bottom-14 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#7a3a1c]"
            >
              <Crosshair size={16} />
            </button>
            <button className="absolute bottom-2.5 right-2.5 z-10 rounded-full bg-[#7a3a1c] px-4 py-1.5 text-xs font-extrabold text-white">
              Recenter
            </button>
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="flex items-stretch justify-around bg-black pb-[env(safe-area-inset-bottom,0px)]">
        {(
          [
            { key: 'flotte', label: 'Flotte', icon: Car },
            { key: 'carte', label: 'Carte', icon: MapPin },
            { key: 'stats', label: 'Stats', icon: BarChart3 },
            { key: 'parametres', label: 'Paramètres', icon: SettingsIcon },
          ] as { key: NavKey; label: string; icon: typeof Car }[]
        ).map(({ key, label, icon: Icon }) => {
          const active = nav === key;
          return (
            <button key={key} onClick={() => goTo(key)} className="flex flex-1 flex-col items-center gap-1 py-2.5">
              <Icon size={18} color={active ? '#a9662f' : '#8a8378'} />
              <span className="text-[9px] font-bold" style={{ color: active ? '#a9662f' : '#8a8378' }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8.5px] text-[#8a8378]">{label}</div>
      <div className="text-[15px] font-extrabold text-[#1c1108]">{value}</div>
    </div>
  );
}

function SettingsRow({
  icon,
  title,
  action,
  toggle,
}: {
  icon: React.ReactNode;
  title: string;
  action?: string;
  toggle?: boolean;
}) {
  const [checked, setChecked] = useState(true);
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex flex-1 items-center gap-1.5 text-[10px] text-[#1c1108]">
        <span className="text-[#8a5a2c]">{icon}</span>
        <span dangerouslySetInnerHTML={{ __html: title }} />
      </span>
      {toggle ? (
        <button
          onClick={() => setChecked((c) => !c)}
          className={`relative h-3.5 w-6 flex-none rounded-full transition-colors ${checked ? 'bg-[#7a3a1c]' : 'bg-[#e4d7bf]'}`}
          aria-pressed={checked}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${checked ? 'translate-x-3' : 'translate-x-0.5'}`}
          />
        </button>
      ) : (
        <span className="flex items-center gap-0.5 text-[9px] text-[#a67a45]">
          {action} <ChevronRight size={11} />
        </span>
      )}
    </div>
  );
}
