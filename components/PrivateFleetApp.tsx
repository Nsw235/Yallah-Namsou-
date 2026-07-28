'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { PricingRule, Trip, VehicleType } from '@/types/database';
import {
  DEMO_ROUTE,
  VEHICLE_EMOJI,
  VEHICLE_LABELS,
  estimatePrice,
  formatFCFA,
  haversineKm,
} from '@/lib/pricing';
import {
  completeTrip,
  createTrip,
  findAndAssignDriver,
  getPricingRules,
  rateTrip,
  startTrip,
} from '@/lib/rides';
import AuthGate from '@/components/AuthGate';
import Header from '@/components/Header';
import MapBackground from '@/components/MapBackground';
import HistoryModal from '@/components/HistoryModal';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type DriverInfo = {
  id: string;
  full_name: string | null;
  phone: string | null;
  rating_avg: number;
};

type VehicleInfo = {
  plate: string;
  brand: string | null;
  model: string | null;
};

const DISTANCE_KM = haversineKm(
  DEMO_ROUTE.pickup.lat,
  DEMO_ROUTE.pickup.lng,
  DEMO_ROUTE.dropoff.lat,
  DEMO_ROUTE.dropoff.lng
);

export default function PrivateFleetApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [step, setStep] = useState<Step>(1);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [vehicle, setVehicle] = useState<VehicleType>('berline');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null);
  const [rating, setRating] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Session Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Grille tarifaire
  useEffect(() => {
    getPricingRules().then(setPricingRules).catch((e) => setError(e.message));
  }, []);

  function priceFor(type: VehicleType): number | null {
    const rule = pricingRules.find((r) => r.vehicle_type === type);
    if (!rule) return null;
    return estimatePrice(rule, DISTANCE_KM);
  }

  function resetToBooking() {
    setStep(1);
    setTrip(null);
    setDriver(null);
    setVehicleInfo(null);
    setRating(0);
    setError(null);
  }

  async function handleConfirmTrip() {
    if (!session?.user) return;
    setBusy(true);
    setError(null);
    try {
      const price = priceFor(vehicle);
      if (price == null) throw new Error('Grille tarifaire indisponible pour ce véhicule.');
      const newTrip = await createTrip({
        passengerId: session.user.id,
        vehicleType: vehicle,
        estimatedPrice: price,
      });
      setTrip(newTrip);
      setStep(3);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de créer la course.');
    } finally {
      setBusy(false);
    }
  }

  // Recherche de chauffeur dès l'entrée sur l'écran 3
  useEffect(() => {
    if (step !== 3 || !trip) return;
    let cancelled = false;
    const start = Date.now();
    (async () => {
      try {
        const result = await findAndAssignDriver(trip.id, trip.vehicle_type);
        const elapsed = Date.now() - start;
        const minDelay = Math.max(0, 2200 - elapsed); // confort visuel de l'animation sonar
        setTimeout(() => {
          if (cancelled) return;
          setDriver({
            id: result.driver.id,
            full_name: (result.driver as any).full_name,
            phone: (result.driver as any).phone,
            rating_avg: result.driver.rating_avg,
          });
          setVehicleInfo({
            plate: result.vehicle.plate,
            brand: result.vehicle.brand,
            model: result.vehicle.model,
          });
          setTrip(result.trip);
          setStep(4);
        }, minDelay);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Aucun chauffeur disponible pour le moment.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, trip?.id]);

  async function handleReady() {
    if (!trip) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await startTrip(trip.id);
      setTrip(updated);
      setStep(5);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de démarrer la course.');
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    if (!trip) return;
    setBusy(true);
    setError(null);
    try {
      const finalPrice = trip.estimated_price ?? 0;
      const updated = await completeTrip(trip.id, finalPrice);
      setTrip(updated);
      setStep(6);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de terminer la course.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRate(n: number) {
    setRating(n);
    if (!trip || !session?.user) return;
    try {
      await rateTrip(trip.id, session.user.id, n);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible d\u2019enregistrer la note.');
    }
  }

  if (session === undefined) {
    return (
      <div className="wrap-outer">
        <div className="device" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="wrap-outer">
        <div className="device">
          <div className="notch" />
          <AuthGate onAuthed={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <div className="wrap-outer">
      <div className="device">
        <div className="notch" />
        <div className="stepper">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <i key={i} className={i < step ? 'done' : i === step ? 'active' : ''} />
          ))}
        </div>

        {error && <div className="top-error">{error}</div>}

        {step === 1 && (
          <Screen1
            vehicle={vehicle}
            onSelect={setVehicle}
            priceFor={priceFor}
            onSearch={() => setStep(2)}
            onOptions={() => setShowHistory(true)}
          />
        )}

        {step === 2 && (
          <Screen2
            vehicle={vehicle}
            price={priceFor(vehicle)}
            busy={busy}
            onConfirm={handleConfirmTrip}
            onOptions={() => setShowHistory(true)}
          />
        )}

        {step === 3 && <Screen3 onOptions={() => setShowHistory(true)} />}

        {step === 4 && driver && vehicleInfo && trip && (
          <Screen4
            driver={driver}
            vehicleInfo={vehicleInfo}
            trip={trip}
            busy={busy}
            onReady={handleReady}
            onOptions={() => setShowHistory(true)}
          />
        )}

        {step === 5 && driver && trip && (
          <Screen5 driver={driver} trip={trip} onFinish={handleFinish} busy={busy} />
        )}

        {step === 6 && driver && trip && (
          <Screen6
            driver={driver}
            trip={trip}
            rating={rating}
            onRate={handleRate}
            onDone={resetToBooking}
          />
        )}

        {showHistory && session.user && (
          <HistoryModal passengerId={session.user.id} onClose={() => setShowHistory(false)} />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 1 — Sélection véhicule                                          */
/* ---------------------------------------------------------------------- */
function Screen1({
  vehicle,
  onSelect,
  priceFor,
  onSearch,
  onOptions,
}: {
  vehicle: VehicleType;
  onSelect: (v: VehicleType) => void;
  priceFor: (v: VehicleType) => number | null;
  onSearch: () => void;
  onOptions: () => void;
}) {
  const types: { key: VehicleType; cls: string }[] = [
    { key: 'berline', cls: 'amber' },
    { key: 'prestige', cls: 'cyan' },
    { key: 'suv', cls: 'emerald' },
  ];
  return (
    <div className="screen fade">
      <MapBackground
        routeColor="#e8c9a8"
        routePath="M100,420 L100,480 L300,480 L300,300"
      >
        <div style={{ position: 'absolute', top: 296, left: 295, width: 14, height: 14, borderRadius: '50% 50% 50% 0', background: '#ff5f5f', transform: 'rotate(-45deg)', boxShadow: '0 0 8px #ff5f5f' }} />
        <div style={{ position: 'absolute', top: 416, left: 96, width: 14, height: 14, borderRadius: '50% 50% 50% 0', background: '#e8c9a8', transform: 'rotate(-45deg)', boxShadow: '0 0 8px #e8c9a8' }} />
      </MapBackground>
      <Header onOptionsClick={onOptions} />
      <RouteCard />
      <div className="sheet glass">
        <div className="vehicles">
          {types.map((t) => (
            <div
              key={t.key}
              className={`vcard ${t.cls} ${vehicle === t.key ? 'selected' : ''}`}
              onClick={() => onSelect(t.key)}
            >
              <span className="vimg">{VEHICLE_EMOJI[t.key]}</span>
              <div className="vname">{VEHICLE_LABELS[t.key]}</div>
              <div className="vprice">{formatFCFA(priceFor(t.key))}</div>
            </div>
          ))}
        </div>
        <button className="btn amber" onClick={onSearch}>RECHERCHER</button>
        <div className="home-indicator" />
      </div>
    </div>
  );
}

function RouteCard() {
  return (
    <div className="route-card glass fade">
      <div className="route-row">
        <div className="route-line">
          <div className="route-dot start" />
          <div className="route-dash" />
          <div className="route-dot end" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="route-label">DÉPART</div>
          <div className="route-addr">{DEMO_ROUTE.pickup.label}</div>
          <div className="route-sub">{DEMO_ROUTE.pickup.address}</div>
          <div style={{ height: 10 }} />
          <div className="route-label">DESTINATION</div>
          <div className="route-addr">{DEMO_ROUTE.dropoff.label}</div>
          <div className="route-sub">{DEMO_ROUTE.dropoff.address}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 2 — Confirmation catégorie                                       */
/* ---------------------------------------------------------------------- */
function Screen2({
  vehicle,
  price,
  busy,
  onConfirm,
  onOptions,
}: {
  vehicle: VehicleType;
  price: number | null;
  busy: boolean;
  onConfirm: () => void;
  onOptions: () => void;
}) {
  return (
    <div className="screen fade">
      <MapBackground routeColor="#e8c9a8" routePath="M100,420 L100,480 L300,480 L300,300" />
      <Header onOptionsClick={onOptions} />
      <RouteCard />
      <div className="sheet glass">
        <div className="veh-hero"><span className="big">{VEHICLE_EMOJI[vehicle]}</span></div>
        <div className="confirm-title">{VEHICLE_LABELS[vehicle]} SÉLECTIONNÉE</div>
        <div className="confirm-sub">Standard, 4 places — {formatFCFA(price)}</div>
        <div className="pay-box">
          <span>💵</span>
          <div>
            <div className="lbl">PAIEMENT EN ESPÈCES UNIQUEMENT</div>
            <div className="sub">Paiement à la fin de la course au chauffeur.</div>
          </div>
        </div>
        <button className="btn cyan" onClick={onConfirm} disabled={busy}>
          {busy ? 'CONFIRMATION…' : 'CONFIRMER LA COURSE (ESPÈCES)'}
        </button>
        <div className="home-indicator" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 3 — Recherche de chauffeur                                       */
/* ---------------------------------------------------------------------- */
function Screen3({ onOptions }: { onOptions: () => void }) {
  return (
    <div className="screen fade">
      <MapBackground />
      <Header onOptionsClick={onOptions} />
      <div className="title-banner glass" style={{ top: 160 }}>
        <div className="route-label">DESTINATION</div>
        <div className="route-addr">{DEMO_ROUTE.dropoff.label}</div>
        <div className="route-sub">{DEMO_ROUTE.dropoff.address}</div>
      </div>
      <div className="sonar-wrap">
        <div className="sonar-ring" />
        <div className="sonar-ring" />
        <div className="sonar-ring" />
        <div className="sonar-core" />
        <div className="car-ghost" style={{ top: 20, left: 20 }}>🚗</div>
        <div className="car-ghost" style={{ top: 210, left: 230 }}>🚗</div>
        <div className="car-ghost" style={{ top: 230, left: 30 }}>🚗</div>
      </div>
      <div className="sheet glass" style={{ paddingTop: 16 }}>
        <div className="search-sheet">
          <div className="spinner" />
          <div className="search-text">RECHERCHE D&apos;UN CHAUFFEUR<br />PRIVATE FLEET...</div>
        </div>
        <div className="home-indicator" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 4 — Chauffeur trouvé                                             */
/* ---------------------------------------------------------------------- */
function Screen4({
  driver,
  vehicleInfo,
  trip,
  busy,
  onReady,
  onOptions,
}: {
  driver: DriverInfo;
  vehicleInfo: VehicleInfo;
  trip: Trip;
  busy: boolean;
  onReady: () => void;
  onOptions: () => void;
}) {
  return (
    <div className="screen fade">
      <MapBackground routeColor="#e8c9a8" routePath="M300,300 L300,480 L100,480">
        <div style={{ position: 'absolute', top: 400, left: 230, fontSize: 34, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.6))', transform: 'scaleX(-1)' }}>🚗</div>
      </MapBackground>
      <Header onOptionsClick={onOptions} />
      <div className="title-banner glass">
        <h2>CHAUFFEUR ARRIVE</h2>
        <div className="sub-route">📍 {DEMO_ROUTE.pickup.label} → {DEMO_ROUTE.dropoff.label}</div>
      </div>
      <div className="sheet glass">
        <div className="driver-row">
          <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
          <div className="driver-info">
            <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
            <div className="driver-eta">Arrive en : Moins d&apos;une minute</div>
            <div className="driver-meta">
              <span className="star-badge">{Number(driver.rating_avg).toFixed(1)} ★</span>
            </div>
          </div>
          <div>
            <div className="plate">
              <div className="plate-top">TCHAD</div>
              <div className="plate-body">{vehicleInfo.plate}</div>
            </div>
            <div className="car-model">{vehicleInfo.model ?? vehicleInfo.brand}</div>
          </div>
        </div>
        <div className="pay-confirmed">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 700 }}>PAIEMENT EN ESPÈCES</div>
            <div className="amt">{formatFCFA(trip.estimated_price)}</div>
          </div>
          <div className="check-circle">✓</div>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => alert(`Appel vers ${driver.full_name ?? 'le chauffeur'} (${driver.phone ?? 'numéro indisponible'})`)}>
            📞 APPELER
          </button>
          <button className="btn cyan" onClick={onReady} disabled={busy}>JE SUIS PRÊT</button>
        </div>
        <div className="home-indicator" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 5 — Course en cours                                              */
/* ---------------------------------------------------------------------- */
function Screen5({
  driver,
  trip,
  onFinish,
  busy,
}: {
  driver: DriverInfo;
  trip: Trip;
  onFinish: () => void;
  busy: boolean;
}) {
  return (
    <div className="screen fade">
      <div className="split">
        <div className="split-left">
          <div className="split-header" style={{ left: 0, right: '50%' }}>EN COURSE</div>
          <div className="split-content">
            <div className="driver-row" style={{ marginBottom: 6 }}>
              <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
              <div className="driver-info">
                <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
                <div className="driver-meta">
                  <span className="star-badge">{Number(driver.rating_avg).toFixed(1)} ★</span>
                </div>
              </div>
            </div>
          </div>
          <div className="brand-tag">◐ mapbox</div>
        </div>
        <div className="split-divider" />
        <div className="split-right">
          <div className="split-header" style={{ left: '50%', right: 0 }}>SUIVI DU TRAJET</div>
          <div className="mini-map">
            <MapBackground
              viewBox="0 0 200 280"
              routeColor="#e8c9a8"
              routePath="M150,20 L150,140 L40,140 L40,260"
            />
          </div>
          <div className="split-content" style={{ paddingTop: 300 }}>
            <div className="fare-box">
              <div className="fare-row"><span className="k">DESTINATION</span><span className="v">{DEMO_ROUTE.dropoff.label}</span></div>
              <div className="fare-row"><span className="k">Prix (espèces)</span><span className="v">{formatFCFA(trip.estimated_price)}</span></div>
            </div>
          </div>
        </div>
      </div>
      <Header />
      <button
        className="navbtn"
        style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}
        onClick={onFinish}
        disabled={busy}
      >
        Terminer la course →
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 6 — Course terminée + notation                                   */
/* ---------------------------------------------------------------------- */
function Screen6({
  driver,
  trip,
  rating,
  onRate,
  onDone,
}: {
  driver: DriverInfo;
  trip: Trip;
  rating: number;
  onRate: (n: number) => void;
  onDone: () => void;
}) {
  return (
    <div className="screen fade">
      <MapBackground routeColor="#e8c9a8" routePath="M300,300 L300,480 L100,480">
        <div style={{ position: 'absolute', top: 296, left: 295, fontSize: 20 }}>🏁</div>
        <div style={{ position: 'absolute', top: 400, left: 230, fontSize: 34, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.6))', transform: 'scaleX(-1)' }}>🚗</div>
      </MapBackground>
      <Header />
      <div className="title-banner glass"><h2>COURSE TERMINÉE</h2></div>
      <div className="sheet glass">
        <div className="driver-row">
          <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
          <div className="driver-info">
            <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
            <div className="driver-eta" style={{ color: 'var(--text-dim)', fontWeight: 600 }}>Paiement : En Espèces</div>
          </div>
          <div className="check-circle">✓</div>
        </div>
        <div className="pay-confirmed" style={{ marginTop: 0 }}>
          <div className="amt">{formatFCFA(trip.final_price ?? trip.estimated_price)}</div>
          <div className="check-circle">✓</div>
        </div>
        <div className="stars">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} className={`star ${rating >= i ? 'active' : ''}`} onClick={() => onRate(i)}>★</button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => onRate(rating || 5)}>
            ⭐ NOTER {driver.full_name?.split(' ')[0]?.toUpperCase() ?? ''}
          </button>
          <button className="btn emerald" onClick={onDone}>TERMINER</button>
        </div>
        <div className="home-indicator" />
      </div>
    </div>
  );
}
