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
  Pencil,
  X,
  Check,
  KeyRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { checkIsAdmin } from '@/lib/admin';
import AuthGate from '@/components/AuthGate';
import { MOCK_STATS } from '@/components/legacy/mockData';
import {
  getFleetOverview,
  subscribeToFleetChanges,
  updateVehicle,
  type FleetVehicle,
} from '@/lib/admin';
import { CAR_MODEL_BY_TYPE } from '@/lib/pricing';
import type { VehicleType } from '@/types/database';
import RealMap, { type MapPin as MapPinData, type RealMapHandle } from '@/components/RealMap';

type NavKey = 'flotte' | 'carte' | 'stats' | 'parametres';

const STATUS_DOT: Record<FleetVehicle['status'], string> = {
  busy: '#e8c9a8',
  available: '#c9a06a',
  offline: '#d85a30',
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
  const [editingVehicle, setEditingVehicle] = useState<FleetVehicle | null>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  // Ref vers l'instance RealMap : le recentrage passe par map.flyTo()/fitBounds()
  // (voir RealMap.recenter()) au lieu de remonter le composant via une `key`,
  // ce qui plantait le contexte WebGL.
  const mapRef = useRef<RealMapHandle>(null);

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
  const geolocatedFleet = fleet.filter((v) => v.last_lat != null && v.last_lng != null);

  if (session === undefined || (isAdmin === null && session)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0a0b0d]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#a97a5b] border-t-transparent" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-dvh bg-[#0a0b0d]">
        <AuthGate onAuthed={() => {}} />
      </div>
    );
  }
  if (isAdmin === false) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0a0b0d] p-6 text-center">
        <div>
          <h2 className="text-lg font-extrabold text-[#f2e9dd]">Accès refusé</h2>
          <p className="mt-1 text-sm text-[#9aa0aa]">Ce compte n&apos;a pas le rôle administrateur.</p>
          <button onClick={handleLogout} className="mt-4 rounded-xl bg-gradient-to-b from-[#e8c9a8] to-[#a97a5b] px-4 py-2 text-sm font-bold text-[#241a13]">
            Déconnexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0b0d] font-sans text-[#f2f3f5]">
      {error && <div className="bg-[#d85a30]/15 p-2 text-center text-xs text-[#ffb3b3]">{error}</div>}

      <div className="flex-1 overflow-y-auto pb-4">
        {/* Header */}
        <div className="px-3 pt-3">
          <div className="relative rounded-2xl border border-[rgba(176,141,87,0.28)] bg-[rgba(20,22,26,0.75)] px-4 py-3.5 backdrop-blur-xl">
            <button
              onClick={handleLogout}
              aria-label="Déconnexion"
              className="absolute right-3 top-3 text-[#e8c9a8]"
            >
              <LogOut size={18} />
            </button>
            <h1 className="max-w-[85%] text-xl font-extrabold leading-tight text-[#f2f3f5]">
              Yallah Namsou
              <br />
              <span className="text-[#e8c9a8]">• Supervision Totale</span>
            </h1>
            <div className="mt-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-[#9aa0aa]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7ee787]" />
                {dateStr} {timeStr}
              </span>
              <span className="flex items-center gap-1 text-xs font-bold text-[#e8c9a8]">
                <ArrowUpDown size={13} /> Filtrer/Trier
              </span>
            </div>
          </div>
        </div>

        {/* Colonnes Flotte / Stats+Paramètres */}
        <div className="flex gap-2 px-3 pt-2">
          {/* Flotte */}
          <div ref={flotteRef} className="flex flex-[0.95] flex-col gap-2">
            <button className="rounded-xl bg-gradient-to-b from-[#e8c9a8] to-[#a97a5b] py-2.5 text-xs font-extrabold text-[#241a13] shadow-[0_0_18px_rgba(169,122,91,0.35)]">
              <span className="inline-flex items-center gap-1">
                <Plus size={14} /> Ajouter un véhicule
              </span>
            </button>

            {fleetError && <div className="rounded-lg bg-[#d85a30]/15 px-2 py-1 text-[10px] text-[#ffb3b3]">{fleetError}</div>}
            {fleet.length === 0 && !fleetError && (
              <div className="rounded-xl border border-[rgba(176,141,87,0.28)] bg-[rgba(20,22,26,0.6)] px-3 py-4 text-center text-[10px] text-[#9aa0aa]">
                Aucun véhicule enregistré.
              </div>
            )}
            {fleet.map((v) => (
              <div key={v.id} className="rounded-xl border border-[rgba(176,141,87,0.28)] bg-[rgba(20,22,26,0.6)] px-3 py-2.5">
                <div className="flex justify-between text-[10px] text-[#9aa0aa]">
                  <span>Plaque: {v.plate}</span>
                  <span>STATUS:</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-extrabold text-[#f2f3f5]">
                    <Car size={15} className="text-[#e8c9a8]" /> {v.brand ?? ''} {v.model ?? v.type.toUpperCase()}
                  </span>
                  <span className="text-[11px] font-extrabold" style={{ color: STATUS_DOT[v.status] }}>
                    ● {STATUS_LABEL[v.status]}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#9aa0aa]">
                  <User size={10} /> Chauffeur: {(v.driver_name ?? '—').toUpperCase()}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button className="flex flex-1 items-center justify-center gap-1 rounded-full bg-[rgba(169,122,91,0.14)] py-1.5 text-[10px] font-extrabold text-[#e8c9a8]">
                    <MapPin size={11} /> LOCALISER
                  </button>
                  <button
                    onClick={() => setEditingVehicle(v)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-full border border-[rgba(176,141,87,0.35)] py-1.5 text-[10px] font-extrabold text-[#e8c9a8]"
                  >
                    <Pencil size={11} /> MODIFIER
                  </button>
                </div>
              </div>
            ))}
            <p className="px-1 text-[9.5px] leading-snug text-[#6b7078]">
              Le mot de passe et les détails du véhicule d&apos;un chauffeur ne sont modifiables
              que depuis ce BackOffice — pas depuis son propre tableau de bord.
            </p>
          </div>

          {/* Stats + Paramètres */}
          <div className="flex flex-[1.05] flex-col rounded-2xl border border-[rgba(176,141,87,0.28)] bg-[rgba(20,22,26,0.6)] p-3">
            <div ref={statsRef}>
              <h2 className="text-sm font-extrabold text-[#f2f3f5]">Stats &amp; Analytics</h2>
              <p className="mb-2 text-[10px] text-[#9aa0aa]">Aujourd&apos;hui ({dateStr.slice(0, 5)})</p>

              <div className="flex justify-between text-center">
                <Kpi label="Total Courses:" value={String(MOCK_STATS.totalCourses)} />
                <Kpi label="Revenus:" value={`${MOCK_STATS.revenue} FCFA`} />
                <Kpi label="Courses/Heure:" value={String(MOCK_STATS.coursesPerHour)} />
              </div>

              <h3 className="mt-3 text-[11px] font-bold text-[#f2f3f5]">Courses par Type (Derniers 7 Jours)</h3>
              <div className="mt-1.5 flex gap-1">
                <div className="flex h-16 flex-col justify-between text-right text-[9px] text-[#6b7078]">
                  <span>{maxVal}</span>
                  <span>{Math.round((maxVal * 3) / 4)}</span>
                  <span>{Math.round(maxVal / 2)}</span>
                  <span>{Math.round(maxVal / 4)}</span>
                  <span>0</span>
                </div>
                <div className="flex h-16 flex-1 items-end gap-1.5 border-l border-[rgba(176,141,87,0.28)] pl-1.5">
                  {MOCK_STATS.byType.map((b, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t bg-gradient-to-t from-[#a97a5b] to-[#e8c9a8]"
                      style={{ height: `${Math.max(6, (b.value / maxVal) * 100)}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-2.5 flex gap-1.5">
                <button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[rgba(169,122,91,0.14)] py-1.5 text-[10px] font-bold text-[#e8c9a8]">
                  Aujourd&apos;hui <ChevronDown size={12} />
                </button>
                <button className="flex flex-[1.2] items-center justify-center gap-1 rounded-lg bg-[rgba(169,122,91,0.14)] py-1.5 text-[10px] font-bold text-[#e8c9a8]">
                  <Download size={12} /> Exporter CSV/PDF
                </button>
              </div>
            </div>

            <div ref={paramsRef} className="mt-3 border-t border-[rgba(176,141,87,0.28)] pt-2.5">
              <h2 className="mb-1 text-xs font-extrabold text-[#f2f3f5]">Section Paramètres &amp; Contrôles</h2>

              <SettingsRow icon={<Bell size={13} />} title="Alertes &amp; Notifications" action="Gérer les Alertes" />
              <SettingsRow icon={<MapIcon size={13} />} title="Gestion de la Carte" toggle />
              <SettingsRow icon={<UserCog size={13} />} title="Profil &amp; Sécurité (admin)" action="Changer MDP / Logs" />
              <SettingsRow icon={<LifeBuoy size={13} />} title="Soutien Technique" action="Contacter Support" />

              <button
                onClick={handleLogout}
                className="mt-1 flex w-full items-center justify-between border-t border-[rgba(176,141,87,0.28)] py-1.5 pt-2 text-left"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#d85a30]">
                  <LogOut size={13} /> Déconnexion
                </span>
                <ChevronRight size={13} className="text-[#d85a30]" />
              </button>
            </div>
          </div>
        </div>

        {/* Carte — vue d'ensemble de la ville pour la supervision de flotte :
            pitch plat + zoom large (comme côté chauffeur hors course) pour
            voir tous les véhicules géolocalisés en un coup d'œil. */}
        <div ref={carteRef} className="px-3 pt-2">
          <div className="mb-2 flex gap-1.5">
            {(
              [
                ['available', 'En attente'],
                ['busy', 'En course'],
                ['offline', 'Hors ligne'],
              ] as [FleetVehicle['status'], string][]
            ).map(([key, label]) => {
              const count = fleet.filter((v) => v.status === key).length;
              return (
                <div
                  key={key}
                  className="flex-1 rounded-xl border-[0.5px] border-[rgba(176,141,87,0.25)] bg-[rgba(20,22,26,0.9)] px-2 py-2 text-center"
                >
                  <div className="text-sm font-extrabold" style={{ color: STATUS_DOT[key] }}>
                    {count}
                  </div>
                  <div className="text-[9px] font-bold text-[#9aa0aa]">{label}</div>
                </div>
              );
            })}
          </div>

          <div
            className={
              mapFullscreen
                ? 'fixed inset-0 z-50 bg-[#0a0b0d]'
                : 'relative h-[62dvh] overflow-hidden rounded-2xl border border-[rgba(176,141,87,0.28)] bg-[#121418]'
            }
          >
            <RealMap
              ref={mapRef}
              pitch={22}
              overviewZoom={12.5}
              buildings3d
              pins={geolocatedFleet.map<MapPinData>((v) => ({
                position: { lat: v.last_lat as number, lng: v.last_lng as number },
                car3d: { modelUrl: CAR_MODEL_BY_TYPE[v.type as VehicleType] },
              }))}
            />
            <span className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-lg border-[1.5px] border-[rgba(176,141,87,0.5)] bg-[rgba(10,11,13,0.85)] px-3.5 py-1.5 text-xs font-extrabold text-[#e8c9a8]">
              YALLAH NAMSOU · VUE D&apos;ENSEMBLE
            </span>

            {/* Légende + contrôles : vraie ligne flex (justify-between) plutôt que
                deux blocs absolus superposés indépendamment — la légende peut
                rétrécir/passer à la ligne (flex-wrap, min-w-0) sans jamais
                chevaucher le groupe de boutons, qui lui ne rétrécit pas (shrink-0). */}
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
              <div className="pointer-events-none flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border-[0.5px] border-[rgba(176,141,87,0.25)] bg-[rgba(10,11,13,0.85)] px-3 py-2 text-[9px] font-bold text-[#e8c9a8]">
                {(['available', 'busy', 'offline'] as FleetVehicle['status'][]).map((key) => (
                  <span key={key} className="flex items-center gap-1 whitespace-nowrap">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_DOT[key] }} />
                    {STATUS_LABEL[key]}
                  </span>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => mapRef.current?.recenter()}
                  className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-b from-[#e8c9a8] to-[#a97a5b] px-3.5 text-xs font-extrabold text-[#241a13]"
                >
                  <Crosshair size={13} /> Recentrer
                </button>
                <button
                  aria-label={mapFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                  onClick={() => setMapFullscreen((f) => !f)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(176,141,87,0.35)] bg-[rgba(10,11,13,0.85)] text-[#e8c9a8]"
                >
                  {mapFullscreen ? <X size={16} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="flex items-stretch justify-around border-t border-[rgba(176,141,87,0.2)] bg-[#0a0b0d] pb-[env(safe-area-inset-bottom,0px)]">
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
              <Icon size={18} color={active ? '#e8c9a8' : '#6b7078'} />
              <span className="text-[9px] font-bold" style={{ color: active ? '#e8c9a8' : '#6b7078' }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {editingVehicle && (
        <VehicleEditModal
          vehicle={editingVehicle}
          onClose={() => setEditingVehicle(null)}
          onSaved={() => setEditingVehicle(null)}
        />
      )}
    </div>
  );
}

function VehicleEditModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: FleetVehicle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plate, setPlate] = useState(vehicle.plate ?? '');
  const [brand, setBrand] = useState(vehicle.brand ?? '');
  const [model, setModel] = useState(vehicle.model ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      await updateVehicle(vehicle.id, { plate, brand: brand || null, model: model || null });
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-t-3xl border border-[rgba(176,141,87,0.28)] bg-[#0f1114] p-5 pb-[calc(24px+env(safe-area-inset-bottom,0px))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[#f2f3f5]">
            Véhicule de {vehicle.driver_name ?? 'chauffeur'}
          </h3>
          <button onClick={onClose} className="text-[#9aa0aa]">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Plaque d'immatriculation" value={plate} onChange={setPlate} />
          <Field label="Marque" value={brand} onChange={setBrand} />
          <Field label="Modèle" value={model} onChange={setModel} />
        </div>

        {err && <div className="mt-3 text-xs text-[#ffb3b3]">{err}</div>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e8c9a8] to-[#a97a5b] py-3 text-sm font-extrabold text-[#241a13] disabled:opacity-50"
        >
          <Check size={15} /> {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>

        <div className="mt-4 border-t border-[rgba(176,141,87,0.2)] pt-4">
          <p className="mb-2 text-[10.5px] leading-snug text-[#9aa0aa]">
            Réinitialisation du mot de passe chauffeur : nécessite l&apos;email associé au compte
            (à connecter à un flux d&apos;administration Supabase côté serveur, avec la clé service role).
          </p>
          <button
            disabled
            title="Nécessite l'email du chauffeur et un appel côté serveur (service role Supabase)"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(176,141,87,0.3)] py-2.5 text-xs font-bold text-[#e8c9a8] opacity-50"
          >
            <KeyRound size={13} /> Réinitialiser le mot de passe
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10.5px] font-bold uppercase tracking-wide text-[#9aa0aa]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-[rgba(176,141,87,0.35)] bg-[rgba(169,122,91,0.06)] px-3.5 py-2.5 text-sm text-[#f2f3f5] outline-none focus:border-[#a97a5b]"
      />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8.5px] text-[#9aa0aa]">{label}</div>
      <div className="text-[15px] font-extrabold text-[#f2f3f5]">{value}</div>
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
      <span className="flex flex-1 items-center gap-1.5 text-[10px] text-[#f2f3f5]">
        <span className="text-[#e8c9a8]">{icon}</span>
        <span dangerouslySetInnerHTML={{ __html: title }} />
      </span>
      {toggle ? (
        <button
          onClick={() => setChecked((c) => !c)}
          className={`relative h-3.5 w-6 flex-none rounded-full transition-colors ${checked ? 'bg-[#a97a5b]' : 'bg-[rgba(255,255,255,0.12)]'}`}
          aria-pressed={checked}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${checked ? 'translate-x-3' : 'translate-x-0.5'}`}
          />
        </button>
      ) : (
        <span className="flex items-center gap-0.5 text-[9px] text-[#e8c9a8]">
          {action} <ChevronRight size={11} />
        </span>
      )}
    </div>
  );
}
