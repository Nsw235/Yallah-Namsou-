'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { PaymentMethod, PricingRule, Trip, VehicleType } from '@/types/database';
import {
  CAR_MODEL_BY_TYPE,
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
  expireStaleTrips,
  getAvailableVehicles,
  getDriverAndVehicle,
  getPricingRules,
  getTrip,
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

/** Convertit la liste des véhicules en ligne (dispo) en pins 3D pour la carte :
 *  utilisé sur les écrans 1, 2 et 3 pour que le passager voie en permanence
 *  les chauffeurs connectés autour de lui, dès qu'ils passent en ligne. */
function vehiclesToCarPins(availableVehicles: AvailableVehicle[]) {
  return availableVehicles
    .filter((v) => v.last_lat != null && v.last_lng != null)
    .map((v) => ({
      position: { lat: v.last_lat as number, lng: v.last_lng as number },
      car3d: { modelUrl: CAR_MODEL_BY_TYPE[v.type] },
    }));
}

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
  // Temps d'arrivée estimé du chauffeur assigné (calculé via l'itinéraire
  // Mapbox trafic temps réel), affiché à l'écran 4 ("chauffeur en route").
  const [driverEtaSeconds, setDriverEtaSeconds] = useState<number | null>(null);
  // Message affiché pendant la recherche (ex: "le chauffeur a annulé, on
  // recherche à nouveau…") et compte à rebours avant annulation automatique.
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [searchSecondsLeft, setSearchSecondsLeft] = useState<number | null>(null);
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
    getPricingRules()
      .then(setPricingRules)
      .catch(async (e: any) => {
        const msg = String(e?.message ?? '');
        if (msg.toLowerCase().includes('jwt issued at future') || msg.toLowerCase().includes('clock')) {
          // Cause quasi certaine : l'heure du téléphone est décalée par rapport
          // au serveur, donc le jeton d'authentification semble "émis dans le
          // futur" et Supabase le rejette. On retente une fois avec un jeton
          // frais (parfois suffisant si l'écart est faible) avant d'afficher
          // un message clair, actionnable, plutôt que l'erreur technique brute.
          try {
            const { data } = await supabase.auth.refreshSession();
            if (data.session) {
              const rules = await getPricingRules();
              setPricingRules(rules);
              return;
            }
          } catch {
            /* on retombe sur le message ci-dessous */
          }
          setError("L'heure de votre téléphone semble incorrecte. Vérifiez la date et l'heure dans les réglages, puis relancez l'application.");
          return;
        }
        setError(e.message);
      });
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
    setSearchNotice(null);
    setSearchSecondsLeft(null);
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
  // Comme dans une vraie appli VTC, la recherche a un délai (voir
  // trips.expires_at) : si personne n'accepte à temps, le serveur annule
  // la course automatiquement et on revient à l'écran de réservation.
  useEffect(() => {
    if (step !== 3 || !trip) return;
    const unsubscribe = subscribeToTrip(trip.id, async (updated) => {
      setTrip(updated);
      if (updated.status === 'accepted' && updated.driver_id && updated.vehicle_id) {
        try {
          const { driver: d, vehicle: v } = await getDriverAndVehicle(updated.driver_id, updated.vehicle_id);
          setDriver(d);
          setVehicleInfo(v);
          setSearchNotice(null);
          setStep(4);
        } catch (e: any) {
          setError(e?.message ?? "Impossible de charger les infos du chauffeur.");
        }
      } else if (updated.status === 'cancelled') {
        // Délai de recherche dépassé (ou annulation serveur) : on informe
        // le passager et on le ramène à l'écran de réservation pour qu'il
        // relance une demande, plutôt que de le laisser bloqué à regarder
        // un écran de recherche qui ne mènera nulle part.
        setError(null);
        setSearchNotice(
          updated.cancel_reason === 'timeout'
            ? "Aucun chauffeur n'a accepté votre demande à temps. Veuillez réessayer."
            : "Votre demande a été annulée. Veuillez réessayer."
        );
        window.setTimeout(() => resetToBooking(), 2600);
      }
    });
    return unsubscribe;
  }, [step, trip?.id]);

  // Compte à rebours affiché pendant la recherche (écran 3), basé sur
  // trips.expires_at. Purement visuel : l'annulation réelle est décidée
  // côté serveur (job planifié), mais on déclenche aussi une vérification
  // immédiate quand le compte à rebours atteint zéro, en filet de sécurité
  // si le job planifié a un peu de retard.
  useEffect(() => {
    if (step !== 3 || !trip?.expires_at) {
      setSearchSecondsLeft(null);
      return;
    }
    const expiresAtMs = new Date(trip.expires_at).getTime();
    let pokedServer = false;

    function tick() {
      const secondsLeft = Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000));
      setSearchSecondsLeft(secondsLeft);
      if (secondsLeft === 0 && !pokedServer) {
        pokedServer = true;
        expireStaleTrips()
          .then(() => (trip ? getTrip(trip.id) : null))
          .then((refreshed) => refreshed && setTrip(refreshed))
          .catch(() => {});
      }
    }
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [step, trip?.id, trip?.expires_at]);

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
  // du passager. On gère aussi explicitement les cas "chauffeur a annulé"
  // (retour en recherche) et "annulée" : sans ça, l'écran restait bloqué
  // sur les infos d'un chauffeur qui n'assurait plus la course.
  useEffect(() => {
    if ((step !== 4 && step !== 5) || !trip) return;
    const unsubscribe = subscribeToTrip(trip.id, (updated) => {
      setTrip(updated);
      if (updated.status === 'in_progress') {
        setStep(5);
      } else if (updated.status === 'completed') {
        setStep(6);
      } else if (updated.status === 'pending') {
        // Le chauffeur a annulé avant le départ : la course repart en
        // recherche pour un autre chauffeur, avec un nouveau délai.
        setDriver(null);
        setVehicleInfo(null);
        setDriverPos(null);
        setSearchNotice('Le chauffeur a dû annuler. Nous recherchons un autre chauffeur…');
        setStep(3);
      } else if (updated.status === 'cancelled') {
        setError(null);
        setSearchNotice('Votre course a été annulée. Veuillez réessayer.');
        window.setTimeout(() => resetToBooking(), 2600);
      }
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
            availableVehicles={availableVehicles}
          />
        )}

        {step === 3 && trip && (
          <Screen3
            trip={trip}
            busy={busy}
            notice={searchNotice}
            secondsLeft={searchSecondsLeft}
            onCancel={handleCancelSearch}
            onOptions={() => setShowHistory(true)}
            onMenu={() => setShowMenu(true)}
            availableVehicles={availableVehicles}
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
            driverEtaSeconds={driverEtaSeconds}
            onEtaChange={setDriverEtaSeconds}
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
  const carPins = vehiclesToCarPins(availableVehicles);

  return (
    <div className="screen fade">
      <RealMap
        pitch={75}
        buildings3d
        pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
        dropoff={dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null}
        showRoute={ready}
        routeColor="#e8c9a8"
        pins={carPins}
      />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />

      {/* Barre d'adresse compacte : la carte reste le sujet principal de
          l'écran, un tap ouvre le laissez-passer pour saisir/modifier. */}
      {!sheetExpanded && (
        <div className="yn-map-bar" onClick={onExpandSheet}>
          <span className={`addr ${!pickup ? 'placeholder' : ''}`}>{pickup ? pickup.label : "D'où partez-vous ?"}</span>
          <span className="sep">→</span>
          <span className={`addr ${!dropoff ? 'placeholder' : ''}`}>{dropoff ? dropoff.label : 'Où allez-vous ?'}</span>
          <span className="city-tag">N&apos;Djamena</span>
        </div>
      )}

      {!sheetExpanded && (
        <div className="yn-flightpath">
          <div className="yn-fp-row">
            <div className="yn-fp-line" />
            <div className="yn-fp-stage active"><div className="yn-fp-dot" /><span>DÉP</span></div>
            <div className="yn-fp-stage"><div className="yn-fp-dot" /><span>RECH</span></div>
            <div className="yn-fp-stage"><div className="yn-fp-dot" /><span>ATT</span></div>
            <div className="yn-fp-stage"><div className="yn-fp-dot" /><span>ROUTE</span></div>
            <div className="yn-fp-stage"><div className="yn-fp-dot" /><span>ARR</span></div>
          </div>
        </div>
      )}

      {!sheetExpanded ? (
        <div className="yn-ticket">
          <div className="yn-ticket-stub" style={{ borderTop: 'none' }} onClick={onExpandSheet}>
            <div className="yn-stub-row">
              <div>
                <div className="yn-stub-label">
                  {availableVehicles.length > 0
                    ? `${availableVehicles.length} véhicule${availableVehicles.length > 1 ? 's' : ''} à proximité`
                    : 'Recherche des véhicules…'}
                </div>
                <div className="yn-stub-price" style={{ fontSize: 15 }}>Où allez-vous ?</div>
              </div>
              <div style={{ fontSize: 20 }}>›</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="yn-ticket">
          <div className="yn-ticket-body">
            <div className="yn-addr-group">
              <AddressField label="DÉPART" icon="dot" placeholder="D'où partez-vous ?" value={pickup} onChange={onPickupChange} />
              <AddressField label="DESTINATION" icon="pin" placeholder="Où allez-vous ?" value={dropoff} onChange={onDropoffChange} last />
            </div>
            <div className="yn-classes-label">Véhicule</div>
            <div className="yn-classes">
              {types.map((t) => (
                <div key={t.key} className={`yn-cclass ${vehicle === t.key ? 'selected' : ''}`} onClick={() => onSelect(t.key)}>
                  <img src={t.icon} alt={VEHICLE_LABELS[t.key]} />
                  <div className="cname">{VEHICLE_LABELS[t.key]}</div>
                  <div className="cprice">{ready ? formatFCFA(priceFor(t.key)) : '—'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="yn-ticket-stub">
            <div className="yn-stub-row">
              <div>
                <div className="yn-stub-label">Tarif estimé</div>
                <div className="yn-stub-price">{ready ? formatFCFA(priceFor(vehicle)) : '—'}</div>
              </div>
              <div className="yn-stub-code">TCHAD<br />N&apos;Djamena</div>
            </div>
            <div className="yn-stub-dash" />
            <button className="yn-stub-btn" onClick={onSearch} disabled={!ready}>
              {ready ? 'CONFIRMER LA COURSE' : 'CHOISISSEZ VOS ADRESSES'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Champ de saisie d'adresse avec suggestions réelles (OpenStreetMap Nominatim). */
function AddressField({
  label,
  icon,
  placeholder,
  value,
  onChange,
  last,
}: {
  label: string;
  icon: 'dot' | 'pin';
  placeholder: string;
  value: GeoResult | null;
  onChange: (g: GeoResult) => void;
  last?: boolean;
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
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchAddress(query)
        .then((r) => {
          // Une adresse a pu être sélectionnée pendant que cette requête
          // était en vol (le debounce de 400ms n'annule pas le fetch déjà
          // parti) : sans ce garde, la réponse tardive rouvrait la liste
          // de suggestions juste après que l'utilisateur l'ait fermée.
          if (cancelled) return;
          setResults(r);
          setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Filet de sécurité : dès qu'une adresse est retenue (value non nul),
  // on force la fermeture de la liste, quel que soit l'état en cours.
  useEffect(() => {
    if (value) {
      setOpen(false);
      setResults([]);
    }
  }, [value]);

  return (
    <div className={`yn-addr-row ${last ? '' : 'yn-addr-row-b'}`} style={{ position: 'relative' }}>
      <span className={`yn-addr-icon yn-addr-icon-${icon}`} aria-hidden="true" />
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {searching && <div className="route-sub" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>…</div>}
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
  availableVehicles,
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
  availableVehicles: AvailableVehicle[];
}) {
  const carPins = vehiclesToCarPins(availableVehicles);
  return (
    <div className="screen fade">
      <RealMap
        pickup={{ lat: pickup.lat, lng: pickup.lng }}
        dropoff={{ lat: dropoff.lat, lng: dropoff.lng }}
        showRoute
        routeColor="#e8c9a8"
        pins={carPins}
      />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <RouteCard pickup={pickup} dropoff={dropoff} />
      <div className="yn-ticket">
        <div className="yn-ticket-body">
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
        </div>
        <div className="yn-ticket-stub">
          <div className="yn-stub-row">
            <div>
              <div className="yn-stub-label">Total à payer</div>
              <div className="yn-stub-price">{formatFCFA(price)}</div>
            </div>
            <div className="yn-stub-code">TCHAD<br />N&apos;Djamena</div>
          </div>
          <div className="yn-stub-dash" />
          <button className="yn-stub-btn" onClick={onConfirm} disabled={busy}>
            {busy ? 'CONFIRMATION…' : 'ÉMETTRE LE LAISSEZ-PASSER'}
          </button>
        </div>
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
  notice,
  secondsLeft,
  onCancel,
  onOptions,
  onMenu,
  availableVehicles,
}: {
  trip: Trip;
  busy: boolean;
  notice: string | null;
  secondsLeft: number | null;
  onCancel: () => void;
  onOptions: () => void;
  onMenu: () => void;
  availableVehicles: AvailableVehicle[];
}) {
  const mm = secondsLeft != null ? Math.floor(secondsLeft / 60) : null;
  const ss = secondsLeft != null ? secondsLeft % 60 : null;
  const carPins = vehiclesToCarPins(availableVehicles);
  return (
    <div className="screen fade">
      <RealMap pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }} pins={carPins} />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <div className="yn-compass-wrap">
        <div className="yn-compass-ring" />
        <div className="yn-compass-ring r2" />
        <div className="yn-needle" />
        <div className="yn-compass-core" />
      </div>
      <div className="yn-compass-label">
        {notice ? notice.toUpperCase() : "RECHERCHE D'UN CHAUFFEUR"}
        <span>
          {notice
            ? 'Merci de patienter…'
            : `Diffusion aux ${VEHICLE_LABELS[trip.vehicle_type]} disponibles`}
        </span>
        {!notice && secondsLeft != null && mm != null && ss != null && (
          <span style={{ display: 'block', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            Annulation auto dans {mm}:{String(ss).padStart(2, '0')}
          </span>
        )}
      </div>
      <div className="yn-ticket">
        <div className="yn-ticket-stub">
          <div className="yn-stub-row">
            <div>
              <div className="yn-stub-label">Montant réservé</div>
              <div className="yn-stub-price">{formatFCFA(trip.estimated_price)}</div>
            </div>
          </div>
          <div className="yn-stub-dash" />
          <button className="yn-stub-btn" style={{ background: 'transparent', border: '1px solid rgba(28,21,18,0.3)', color: 'var(--copper-deep)' }} onClick={onCancel} disabled={busy}>
            ANNULER LA COURSE
          </button>
        </div>
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
  driverEtaSeconds,
  onEtaChange,
}: {
  driver: DriverInfo;
  vehicleInfo: VehicleInfo;
  trip: Trip;
  busy: boolean;
  paymentMethod: PaymentMethod;
  driverPos: { lat: number; lng: number } | null;
  onOptions: () => void;
  onMenu: () => void;
  driverEtaSeconds: number | null;
  onEtaChange: (seconds: number | null) => void;
}) {
  // Texte "communiqué" au passager sur le temps d'arrivée du chauffeur,
  // recalculé en temps réel à partir de l'itinéraire trafic (RealMap → onRouteInfo).
  const etaLabel =
    driverEtaSeconds != null
      ? driverEtaSeconds < 60
        ? "Arrive à l'instant"
        : `Arrive dans ${Math.round(driverEtaSeconds / 60)} min`
      : 'Localisation du chauffeur…';

  return (
    <div className="screen fade">
      <RealMap
        pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
        dropoff={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
        driverPosition={driverPos ?? undefined}
        showRoute
        routeColor="#e8c9a8"
        onRouteInfo={(info) => onEtaChange(info ? info.durationSeconds : null)}
        pins={[
          {
            position: driverPos ?? { lat: trip.pickup_lat, lng: trip.pickup_lng },
            car3d: { modelUrl: CAR_MODEL_BY_TYPE[trip.vehicle_type] },
          },
        ]}
      />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <div className="title-banner glass">
        <h2>CHAUFFEUR EN ROUTE</h2>
        <div className="sub-route">📍 {trip.pickup_address} → {trip.dropoff_address}</div>
      </div>
      <div className="yn-ticket">
        <div className="yn-ticket-body">
          <div className="driver-row">
            <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
            <div className="driver-info">
              <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
              <div className="driver-eta">
                Le chauffeur arrive vers votre position de départ
                <span className="eta-badge">⏱ {etaLabel}</span>
              </div>
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
          <button
            className="btn ghost"
            onClick={() => alert(`Appel vers ${driver.full_name ?? 'le chauffeur'} (${driver.phone ?? 'numéro indisponible'})`)}
          >
            📞 APPELER
          </button>
        </div>
        <div className="yn-ticket-stub">
          <div className="yn-stub-row">
            <div>
              <div className="yn-stub-label">Paiement — {PAYMENT_METHOD_LABELS[paymentMethod]}</div>
              <div className="yn-stub-price">{formatFCFA(trip.estimated_price)}</div>
            </div>
            <div style={{ fontSize: 20 }}>✓</div>
          </div>
          <div className="yn-stub-dash" />
          <div style={{ fontSize: 11, textAlign: 'center', color: 'var(--copper-dark)' }}>
            Le trajet démarre automatiquement quand le chauffeur vous prend en charge.
          </div>
        </div>
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
      <RealMap
        pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
        dropoff={{ lat: trip.dropoff_lat, lng: trip.dropoff_lng }}
        showRoute
        routeColor="#e8c9a8"
        pins={driverPos ? [{ position: driverPos, car3d: { modelUrl: CAR_MODEL_BY_TYPE[trip.vehicle_type] } }] : []}
      />
      <Header onMenuClick={onMenu} />
      <div className="title-banner glass">
        <h2>EN ROUTE VERS DESTINATION</h2>
        <div className="sub-route">Le chauffeur vous conduit directement, aucune action requise</div>
      </div>
      <div className="yn-ticket">
        <div className="yn-ticket-body">
          <div className="driver-row">
            <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
            <div className="driver-info">
              <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
              <div className="driver-meta">
                <span className="star-badge">{Number(driver.rating_avg).toFixed(1)} ★</span>
              </div>
            </div>
            <div className="driver-name">{formatFCFA(trip.estimated_price)}</div>
          </div>
          <div className="trip-timeline">
            <div className="route-line">
              <div className="route-dot start done" />
              <div className="route-dash" />
              <div className="route-dot end active" />
            </div>
            <div className="trip-timeline-labels">
              <div><div className="route-sub" style={{ margin: 0 }}>{trip.pickup_address}</div></div>
              <div><div className="route-addr" style={{ fontSize: 13 }}>{trip.dropoff_address}</div></div>
            </div>
          </div>
        </div>
        <div className="yn-ticket-stub">
          <div style={{ fontSize: 11, textAlign: 'center', color: 'var(--copper-dark)', fontWeight: 700 }}>
            TRAJET EN COURS — AUCUNE ACTION REQUISE
          </div>
        </div>
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
      <div className="yn-ticket">
        <div className="yn-ticket-body">
          <div className="driver-row">
            <div className="avatar-ring"><div className="av">🧑🏾‍✈️</div></div>
            <div className="driver-info">
              <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
              <div className="driver-eta" style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
                Paiement : {PAYMENT_METHOD_LABELS[paymentMethod]}
              </div>
            </div>
          </div>

          {isMobileMoney && !mobilePaymentConfirmed && (
            <button className="btn cyan" style={{ marginBottom: 10 }} onClick={onConfirmMobilePayment} disabled={busy}>
              {busy ? 'CONFIRMATION…' : `J'AI ENVOYÉ LE PAIEMENT ${PAYMENT_METHOD_LABELS[paymentMethod].toUpperCase()}`}
            </button>
          )}
          {isMobileMoney && mobilePaymentConfirmed && (
            <div className="route-sub" style={{ marginBottom: 10, color: 'var(--copper-light)', fontWeight: 700 }}>
              ✓ Paiement {PAYMENT_METHOD_LABELS[paymentMethod]} confirmé
            </div>
          )}

          <div className="stars">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} className={`star ${rating >= i ? 'active' : ''}`} onClick={() => onRate(i)}>★</button>
            ))}
          </div>
        </div>
        <div className="yn-ticket-stub" style={{ position: 'relative' }}>
          <span className="yn-used">UTILISÉ</span>
          <div className="yn-stub-row">
            <div>
              <div className="yn-stub-label">Montant final</div>
              <div className="yn-stub-price">{formatFCFA(trip.final_price ?? trip.estimated_price)}</div>
            </div>
            <div className="yn-stub-code">Nº YN-{trip.id.slice(0, 8).toUpperCase()}</div>
          </div>
          <div className="yn-stub-dash" />
          <button className="yn-stub-btn" onClick={() => { if (!rating) onRate(5); onDone(); }}>TERMINER</button>
        </div>
      </div>
    </div>
  );
}
