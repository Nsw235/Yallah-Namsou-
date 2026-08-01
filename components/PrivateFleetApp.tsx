'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { PaymentMethod, PricingRule, Trip, VehicleType } from '@/types/database';
import {
  PAYMENT_METHOD_LABELS,
  VEHICLE_ICON,
  VEHICLE_LABELS,
  estimatePrice,
  formatFCFA,
  haversineKm,
} from '@/lib/pricing';
import {
  cancelTrip,
  confirmMobilePayment,
  createTrip,
  getAvailableVehicles,
  getDriverAndVehicle,
  getPricingRules,
  rateTrip,
  subscribeToAvailableVehicles,
  subscribeToTrip,
  subscribeToVehicleLocation,
  type AvailableVehicle,
} from '@/lib/rides';
import { GeoResult, searchAddress } from '@/lib/geocode';
import AuthGate from '@/components/AuthGate';
import Header from '@/components/Header';
import RealMap from '@/components/RealMap';
import HistoryModal from '@/components/HistoryModal';
import PaymentModal from '@/components/PaymentModal';
import AccountMenu from '@/components/AccountMenu';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type DriverInfo = {
  id: string;
  full_name: string | null;
  phone: string | null;
  rating_avg: number;
};

type VehicleInfo = {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
};

export default function PrivateFleetApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [step, setStep] = useState<Step>(1);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [vehicle, setVehicle] = useState<VehicleType>('berline');
  const [pickup, setPickup] = useState<GeoResult | null>(null);
  const [dropoff, setDropoff] = useState<GeoResult | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null);
  const [rating, setRating] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentPhone, setPaymentPhone] = useState<string | undefined>(undefined);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [mobilePaymentConfirmed, setMobilePaymentConfirmed] = useState(false);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [availableVehicles, setAvailableVehicles] = useState<AvailableVehicle[]>([]);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const submittingTrip = useRef(false);

  const distanceKm = useMemo(() => {
    if (!pickup || !dropoff) return null;
    return haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  }, [pickup, dropoff]);

  // Session Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Grille tarifaire (chargée seulement une fois la session confirmée,
  // sinon la RLS Supabase renvoie 0 ligne silencieusement avant que le token soit prêt)
  useEffect(() => {
    if (!session) return;
    getPricingRules().then(setPricingRules).catch((e) => setError(e.message));
  }, [session]);

  // Voitures dispos affichées sur la carte avant même le choix d'une adresse.
  useEffect(() => {
    if (!session) return;
    function load() {
      getAvailableVehicles()
        .then(setAvailableVehicles)
        .catch(() => {});
    }
    load();
    const unsubscribe = subscribeToAvailableVehicles(load);
    return unsubscribe;
  }, [session]);

  function priceFor(type: VehicleType): number | null {
    if (distanceKm == null) return null;
    const rule = pricingRules.find((r) => r.vehicle_type === type);
    if (!rule) return null;
    return estimatePrice(rule, distanceKm);
  }

  function resetToBooking() {
    setStep(1);
    setTrip(null);
    setDriver(null);
    setVehicleInfo(null);
    setRating(0);
    setError(null);
    setPaymentMethod('cash');
    setPaymentPhone(undefined);
    setMobilePaymentConfirmed(false);
    setDriverPos(null);
    setSheetExpanded(false);
  }

  async function handleConfirmTrip() {
    if (!session?.user || !pickup || !dropoff) return;
    if (submittingTrip.current) return;
    submittingTrip.current = true;
    setBusy(true);
    setError(null);
    try {
      const price = priceFor(vehicle);
      if (price == null) throw new Error('Grille tarifaire indisponible pour ce véhicule.');
      const newTrip = await createTrip({
        passengerId: session.user.id,
        vehicleType: vehicle,
        estimatedPrice: price,
        pickup,
        dropoff,
        paymentMethod,
        paymentPhone,
      });
      setTrip(newTrip);
      setStep(3);
    } catch (e: any) {
      // Une requête en double (relance réseau, double-clic) peut échouer après
      // qu'une autre a déjà réussi et fait avancer l'écran : on n'affiche
      // jamais une erreur obsolète par-dessus un écran déjà passé à l'étape 3.
      setStep((current) => {
        if (current === 2) {
          setError(
            e?.message?.includes('row-level security')
              ? "La demande n'a pas pu être envoyée, réessayez."
              : e?.message ?? 'Impossible de créer la course.'
          );
        }
        return current;
      });
    } finally {
      submittingTrip.current = false;
      setBusy(false);
    }
  }

  // Écran 3 : la course est diffusée en temps réel à tous les chauffeurs
  // disponibles du bon type de véhicule. On attend qu'un chauffeur
  // l'accepte (Realtime UPDATE sur trips.driver_id), premier arrivé premier servi.
  useEffect(() => {
    if (step !== 3 || !trip) return;
    const unsubscribe = subscribeToTrip(trip.id, async (updated) => {
      setTrip(updated);
      if (updated.status === 'accepted' && updated.driver_id && updated.vehicle_id) {
        try {
          const { driver: d, vehicle: v } = await getDriverAndVehicle(updated.driver_id, updated.vehicle_id);
          setDriver(d);
          setVehicleInfo(v);
          setStep(4);
        } catch (e: any) {
          setError(e?.message ?? "Impossible de charger les infos du chauffeur.");
        }
      }
    });
    return unsubscribe;
  }, [step, trip?.id]);

  async function handleCancelSearch() {
    if (!trip) return;
    setBusy(true);
    try {
      await cancelTrip(trip.id);
      resetToBooking();
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'annuler la course.");
    } finally {
      setBusy(false);
    }
  }

  // Position GPS en direct du chauffeur assigné (écrans 4 "chauffeur arrive" et 5 "en course")
  useEffect(() => {
    if ((step !== 4 && step !== 5) || !trip?.vehicle_id) {
      setDriverPos(null);
      return;
    }
    setDriverPos(null);
    const unsubscribe = subscribeToVehicleLocation(trip.vehicle_id, setDriverPos);
    return unsubscribe;
  }, [step, trip?.vehicle_id]);

  // Écrans 4 et 5 : suit aussi les changements de statut poussés par le
  // chauffeur (in_progress, completed) pour rester synchronisé sans action
  // du passager.
  useEffect(() => {
    if ((step !== 4 && step !== 5) || !trip) return;
    const unsubscribe = subscribeToTrip(trip.id, (updated) => {
      setTrip(updated);
      if (updated.status === 'in_progress') setStep(5);
      if (updated.status === 'completed') setStep(6);
    });
    return unsubscribe;
  }, [step, trip?.id]);

  async function handleConfirmMobilePayment() {
    if (!trip || (paymentMethod !== 'airtel_money' && paymentMethod !== 'moov_money')) return;
    setBusy(true);
    setError(null);
    try {
      await confirmMobilePayment(trip.id, paymentMethod);
      setMobilePaymentConfirmed(true);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de confirmer le paiement.');
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
      setError(e?.message ?? "Impossible d'enregistrer la note.");
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
          <AuthGate onAuthed={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <div className="wrap-outer">
      <div className="device">
        {error && <div className="top-error">{error}</div>}

        {step === 1 && (
          <Screen1
            vehicle={vehicle}
            onSelect={setVehicle}
            priceFor={priceFor}
            pickup={pickup}
            dropoff={dropoff}
            onPickupChange={setPickup}
            onDropoffChange={setDropoff}
            onSearch={() => setStep(2)}
            onOptions={() => setShowHistory(true)}
            onMenu={() => setShowMenu(true)}
            availableVehicles={availableVehicles}
            sheetExpanded={sheetExpanded}
            onExpandSheet={() => setSheetExpanded(true)}
          />
        )}

        {step === 2 && pickup && dropoff && (
          <Screen2
            vehicle={vehicle}
            price={priceFor(vehicle)}
            pickup={pickup}
            dropoff={dropoff}
            busy={busy}
            paymentMethod={paymentMethod}
            onChangePayment={() => setShowPaymentModal(true)}
            onConfirm={handleConfirmTrip}
            onOptions={() => setShowHistory(true)}
            onMenu={() => setShowMenu(true)}
          />
        )}

        {step === 3 && trip && (
          <Screen3
            trip={trip}
            busy={busy}
            onCancel={handleCancelSearch}
            onOptions={() => setShowHistory(true)}
            onMenu={() => setShowMenu(true)}
          />
        )}

        {step === 4 && driver && vehicleInfo && trip && (
          <Screen4
            driver={driver}
            vehicleInfo={vehicleInfo}
            trip={trip}
            busy={busy}
            paymentMethod={paymentMethod}
            driverPos={driverPos}
            onOptions={() => setShowHistory(true)}
            onMenu={() => setShowMenu(true)}
          />
        )}

        {step === 5 && driver && trip && (
          <Screen5 driver={driver} trip={trip} driverPos={driverPos} onMenu={() => setShowMenu(true)} />
        )}

        {step === 6 && driver && trip && (
          <Screen6
            driver={driver}
            trip={trip}
            rating={rating}
            paymentMethod={paymentMethod}
            mobilePaymentConfirmed={mobilePaymentConfirmed}
            busy={busy}
            onConfirmMobilePayment={handleConfirmMobilePayment}
            onRate={handleRate}
            onDone={resetToBooking}
            onMenu={() => setShowMenu(true)}
          />
        )}

        {showPaymentModal && (
          <PaymentModal
            amount={priceFor(vehicle)}
            selected={paymentMethod}
            onClose={() => setShowPaymentModal(false)}
            onSelect={(method, phone) => {
              setPaymentMethod(method);
              setPaymentPhone(phone);
              setShowPaymentModal(false);
            }}
          />
        )}

        {showHistory && session.user && (
          <HistoryModal passengerId={session.user.id} onClose={() => setShowHistory(false)} />
        )}

        {showMenu && (
          <AccountMenu session={session} onClose={() => setShowMenu(false)} onHistory={() => setShowHistory(true)} />
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
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  onSearch,
  onOptions,
  onMenu,
  availableVehicles,
  sheetExpanded,
  onExpandSheet,
}: {
  vehicle: VehicleType;
  onSelect: (v: VehicleType) => void;
  priceFor: (v: VehicleType) => number | null;
  pickup: GeoResult | null;
  dropoff: GeoResult | null;
  onPickupChange: (g: GeoResult) => void;
  onDropoffChange: (g: GeoResult) => void;
  onSearch: () => void;
  onOptions: () => void;
  onMenu: () => void;
  availableVehicles: AvailableVehicle[];
  sheetExpanded: boolean;
  onExpandSheet: () => void;
}) {
  const types: { key: VehicleType; icon: string }[] = [
    { key: 'berline', icon: '/icon_berline.png' },
    { key: 'van', icon: '/icon_van.png' },
    { key: 'suv', icon: '/icon_suv.png' },
  ];
  const ready = !!pickup && !!dropoff;
  const carPins = availableVehicles
    .filter((v) => v.last_lat != null && v.last_lng != null)
    .map((v) => ({ position: { lat: v.last_lat as number, lng: v.last_lng as number }, emoji: '🚗' }));

  return (
    <div className="screen fade">
      <RealMap
        pitch={55}
        buildings3d
        pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
        dropoff={dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null}
        showRoute={ready}
        routeColor="#e8c9a8"
        pins={carPins}
      />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />

      {!sheetExpanded ? (
        <div className="sheet glass copper-texture" style={{ paddingTop: 14, paddingBottom: 18 }} onClick={onExpandSheet}>
          <div className="route-sub" style={{ marginBottom: 8 }}>
            {availableVehicles.length > 0
              ? `${availableVehicles.length} véhicule${availableVehicles.length > 1 ? 's' : ''} disponible${availableVehicles.length > 1 ? 's' : ''} près de vous`
              : 'Recherche des véhicules à proximité…'}
          </div>
          <div className="field" style={{ cursor: 'pointer' }}>
            <input type="text" placeholder="Où allez-vous ?" readOnly value="" style={{ pointerEvents: 'none' }} />
          </div>
          <div className="home-indicator" />
        </div>
      ) : (
        <div className="sheet glass copper-texture" style={{ paddingTop: 16 }}>
          <AddressField label="DÉPART" placeholder="D'où partez-vous ?" value={pickup} onChange={onPickupChange} />
          <div style={{ height: 10 }} />
          <AddressField label="DESTINATION" placeholder="Où allez-vous ?" value={dropoff} onChange={onDropoffChange} />
          <div style={{ height: 14 }} />
          <div className="vehicles">
            {types.map((t) => (
              <div key={t.key} className={`vcard ${vehicle === t.key ? 'selected' : ''}`} onClick={() => onSelect(t.key)}>
                <img src={t.icon} alt={VEHICLE_LABELS[t.key]} className="vimg" />
                <div className="driver-name" style={{ fontSize: 12 }}>{VEHICLE_LABELS[t.key]}</div>
                <div className="vprice">{ready ? formatFCFA(priceFor(t.key)) : '—'}</div>
              </div>
            ))}
          </div>
          {!ready && <div className="confirm-title" style={{ marginBottom: 10 }}>CHOISISSEZ VOS ADRESSES</div>}
          <button className="btn amber" onClick={onSearch} disabled={!ready}>
            {ready ? 'CONFIRMER' : 'CHOISISSEZ VOS ADRESSES'}
          </button>
          <div className="home-indicator" />
        </div>
      )}
    </div>
  );
}

/* Champ de saisie d'adresse avec suggestions réelles (OpenStreetMap Nominatim). */
function AddressField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: GeoResult | null;
  onChange: (g: GeoResult) => void;
}) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value) return;
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchAddress(query)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="field" style={{ position: 'relative' }}>
      <label>{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {searching && <div className="route-sub">Recherche…</div>}
      {open && results.length > 0 && (
        <div
          className="glass"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, borderRadius: 12, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}
        >
          {results.map((r, i) => (
            <div
              key={i}
              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid rgba(169,122,91,0.15)' : undefined }}
              onClick={() => {
                onChange(r);
                setQuery(r.label);
                setOpen(false);
              }}
            >
              <div className="route-addr" style={{ fontSize: 14 }}>{r.label}</div>
              <div className="route-sub">{r.address}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteCard({ pickup, dropoff }: { pickup: GeoResult; dropoff: GeoResult }) {
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
          <div className="route-addr">{pickup.label}</div>
          <div className="route-sub">{pickup.address}</div>
          <div style={{ height: 10 }} />
          <div className="route-label">DESTINATION</div>
          <div className="route-addr">{dropoff.label}</div>
          <div className="route-sub">{dropoff.address}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 2 — Confirmation catégorie + paiement                            */
/* ---------------------------------------------------------------------- */
function Screen2({
  vehicle,
  price,
  pickup,
  dropoff,
  busy,
  paymentMethod,
  onChangePayment,
  onConfirm,
  onOptions,
  onMenu,
}: {
  vehicle: VehicleType;
  price: number | null;
  pickup: GeoResult;
  dropoff: GeoResult;
  busy: boolean;
  paymentMethod: PaymentMethod;
  onChangePayment: () => void;
  onConfirm: () => void;
  onOptions: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="screen fade">
      <RealMap pickup={{ lat: pickup.lat, lng: pickup.lng }} dropoff={{ lat: dropoff.lat, lng: dropoff.lng }} showRoute routeColor="#e8c9a8" />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <RouteCard pickup={pickup} dropoff={dropoff} />
      <div className="sheet glass">
        <div className="veh-hero"><img src={VEHICLE_ICON[vehicle]} alt={VEHICLE_LABELS[vehicle]} className="veh-hero-img" /></div>
        <div className="confirm-title">{VEHICLE_LABELS[vehicle]} SÉLECTIONNÉE</div>
        <div className="confirm-sub">Standard, 4 places — {formatFCFA(price)}</div>
        <div className="pay-box" onClick={onChangePayment} style={{ cursor: 'pointer' }}>
          <span>{paymentMethod === 'cash' ? '💵' : paymentMethod === 'airtel_money' ? '📱' : '📲'}</span>
          <div>
            <div className="lbl">{PAYMENT_METHOD_LABELS[paymentMethod].toUpperCase()}</div>
            <div className="sub">Paiement à la fin de la course.</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--copper-light)', fontWeight: 700 }}>MODIFIER</span>
        </div>
        <button className="btn cyan" onClick={onConfirm} disabled={busy}>
          {busy ? 'CONFIRMATION…' : `CONFIRMER LA COURSE (${PAYMENT_METHOD_LABELS[paymentMethod].toUpperCase()})`}
        </button>
        <div className="home-indicator" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 3 — Recherche d'un chauffeur (diffusion temps réel)               */
/* ---------------------------------------------------------------------- */
function Screen3({
  trip,
  busy,
  onCancel,
  onOptions,
  onMenu,
}: {
  trip: Trip;
  busy: boolean;
  onCancel: () => void;
  onOptions: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="screen fade">
      <RealMap pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }} />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <div className="title-banner glass" style={{ top: 100 }}>
        <div className="route-label">RECHERCHE D&apos;UN CHAUFFEUR</div>
        <div className="route-sub">Votre demande a été envoyée à tous les {VEHICLE_LABELS[trip.vehicle_type]} disponibles.</div>
      </div>
      <div className="sheet glass" style={{ paddingTop: 16 }}>
        <div className="search-sheet">
          <div className="spinner" />
          <div className="search-text">
            EN ATTENTE D&apos;UN CHAUFFEUR…
            <br />
            {formatFCFA(trip.estimated_price)}
          </div>
        </div>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          ANNULER LA COURSE
        </button>
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
  paymentMethod,
  driverPos,
  onOptions,
  onMenu,
}: {
  driver: DriverInfo;
  vehicleInfo: VehicleInfo;
  trip: Trip;
  busy: boolean;
  paymentMethod: PaymentMethod;
  driverPos: { lat: number; lng: number } | null;
  onOptions: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="screen fade">
      <RealMap
        pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
        pins={[{ position: driverPos ?? { lat: trip.pickup_lat, lng: trip.pickup_lng }, emoji: '🚗' }]}
      />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <div className="title-banner glass">
        <h2>CHAUFFEUR EN ROUTE</h2>
        <div className="sub-route">📍 {trip.pickup_address} → {trip.dropoff_address}</div>
      </div>
      <div className="sheet glass">
        <div className="driver-row">
          <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
          <div className="driver-info">
            <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
            <div className="driver-eta">Le chauffeur arrive vers votre position de départ</div>
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
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 700 }}>
              PAIEMENT — {PAYMENT_METHOD_LABELS[paymentMethod].toUpperCase()}
            </div>
            <div className="amt">{formatFCFA(trip.estimated_price)}</div>
          </div>
          <div className="check-circle">✓</div>
        </div>
        <div className="btn-row">
          <button
            className="btn ghost"
            onClick={() => alert(`Appel vers ${driver.full_name ?? 'le chauffeur'} (${driver.phone ?? 'numéro indisponible'})`)}
          >
            📞 APPELER
          </button>
        </div>
        <div className="route-sub" style={{ textAlign: 'center', marginTop: 8 }}>
          Le trajet démarre automatiquement quand le chauffeur vous prend en charge.
        </div>
        <div className="home-indicator" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 5 — En course                                                    */
/* ---------------------------------------------------------------------- */
function Screen5({
  driver,
  trip,
  driverPos,
  onMenu,
}: {
  driver: DriverInfo;
  trip: Trip;
  driverPos: { lat: number; lng: number } | null;
  onMenu: () => void;
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
        </div>
        <div className="split-divider" />
        <div className="split-right">
          <div className="split-header" style={{ left: '50%', right: 0 }}>SUIVI DU TRAJET</div>
          <div className="mini-map">
            <RealMap
              pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
              dropoff={{ lat: trip.dropoff_lat, lng: trip.dropoff_lng }}
              showRoute
              routeColor="#e8c9a8"
              pins={driverPos ? [{ position: driverPos, emoji: '🚗' }] : []}
            />
          </div>
          <div className="split-content" style={{ paddingTop: 300 }}>
            <div className="fare-box">
              <div className="fare-row"><span className="k">DESTINATION</span><span className="v">{trip.dropoff_address}</span></div>
              <div className="fare-row"><span className="k">Prix</span><span className="v">{formatFCFA(trip.estimated_price)}</span></div>
            </div>
          </div>
        </div>
      </div>
      <Header onMenuClick={onMenu} />
      <div className="route-sub" style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}>
        Le chauffeur termine la course depuis son tableau de bord.
      </div>
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
  paymentMethod,
  mobilePaymentConfirmed,
  busy,
  onConfirmMobilePayment,
  onRate,
  onDone,
  onMenu,
}: {
  driver: DriverInfo;
  trip: Trip;
  rating: number;
  paymentMethod: PaymentMethod;
  mobilePaymentConfirmed: boolean;
  busy: boolean;
  onConfirmMobilePayment: () => void;
  onRate: (n: number) => void;
  onDone: () => void;
  onMenu: () => void;
}) {
  const isMobileMoney = paymentMethod === 'airtel_money' || paymentMethod === 'moov_money';
  return (
    <div className="screen fade">
      <RealMap
        pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
        dropoff={{ lat: trip.dropoff_lat, lng: trip.dropoff_lng }}
        showRoute
        routeColor="#e8c9a8"
        pins={[{ position: { lat: trip.dropoff_lat, lng: trip.dropoff_lng }, emoji: '🏁' }]}
      />
      <Header onMenuClick={onMenu} />
      <div className="title-banner glass"><h2>COURSE TERMINÉE</h2></div>
      <div className="sheet glass">
        <div className="driver-row">
          <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
          <div className="driver-info">
            <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
            <div className="driver-eta" style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
              Paiement : {PAYMENT_METHOD_LABELS[paymentMethod]}
            </div>
          </div>
          <div className="check-circle">✓</div>
        </div>
        <div className="pay-confirmed" style={{ marginTop: 0 }}>
          <div className="amt">{formatFCFA(trip.final_price ?? trip.estimated_price)}</div>
          <div className="check-circle">✓</div>
        </div>

        {isMobileMoney && !mobilePaymentConfirmed && (
          <button className="btn cyan" style={{ marginTop: 10 }} onClick={onConfirmMobilePayment} disabled={busy}>
            {busy ? 'CONFIRMATION…' : `J'AI ENVOYÉ LE PAIEMENT ${PAYMENT_METHOD_LABELS[paymentMethod].toUpperCase()}`}
          </button>
        )}
        {isMobileMoney && mobilePaymentConfirmed && (
          <div className="route-sub" style={{ marginTop: 10, color: 'var(--copper-light)', fontWeight: 700 }}>
            ✓ Paiement {PAYMENT_METHOD_LABELS[paymentMethod]} confirmé
          </div>
        )}

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
