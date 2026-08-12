'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  getActiveTripForPassenger,
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
import ChatModal from '@/components/ChatModal';
import { ToastProvider, useToast } from '@/components/Toast';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

/** Convertit la liste des véhicules en ligne (dispo) en pins 3D pour la carte :
 *  utilisé sur les écrans 1, 2 et 3 pour que le passager voie en permanence
 *  les chauffeurs connectés autour de lui, dès qu'ils passent en ligne. */
const VEHICLE_ICON_BY_TYPE: Record<VehicleType, string> = {
  berline: '/vehicle-icons/berline.png',
  suv: '/vehicle-icons/suv.png',
  van: '/vehicle-icons/van.png',
};

function vehiclesToCarPins(availableVehicles: AvailableVehicle[]) {
  return availableVehicles
    .filter((v) => v.last_lat != null && v.last_lng != null)
    .map((v) => ({
      position: { lat: v.last_lat as number, lng: v.last_lng as number },
      icon: { url: VEHICLE_ICON_BY_TYPE[v.type], ringColor: '#a97a5b' },
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

/** Point d'entrée : fournit le contexte Toast (utilisé pour les retours
 *  d'action — appel, message, partage — à la place des alert() natifs,
 *  moins intrusifs et plus cohérents avec le reste de l'app). */
export default function PrivateFleetApp() {
  return (
    <ToastProvider>
      <PrivateFleetAppScreens />
    </ToastProvider>
  );
}

function PrivateFleetAppScreens() {
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
  const [activeTripBanner, setActiveTripBanner] = useState<Trip | null>(null);
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

  // Reverrouille l'app sur une course déjà en cours (pending/accepted/
  // in_progress) au chargement — après un rechargement de page, un crash
  // d'onglet, ou une réouverture de l'app, le passager ne doit jamais
  // "perdre" une course en cours et se retrouver sur l'écran de réservation
  // comme si de rien n'était.
  const restoredActiveTrip = useRef(false);

  async function fetchActiveTripBanner(userId: string) {
    try {
      const active = await getActiveTripForPassenger(userId);
      setActiveTripBanner(active);
    } catch {
      // silencieux — le bandeau reste simplement absent
    }
  }

  async function restoreActiveTrip(userId: string) {
    try {
      const active = await getActiveTripForPassenger(userId);
      if (!active) {
        setActiveTripBanner(null);
        return;
      }
      setActiveTripBanner(active);
      setTrip(active);
      if (active.status === 'pending') {
        setStep(3);
        return;
      }
      if (!active.driver_id || !active.vehicle_id) return;
      const { driver: d, vehicle: v } = await getDriverAndVehicle(active.driver_id, active.vehicle_id);
      setDriver(d);
      setVehicleInfo(v);
      setStep(active.status === 'in_progress' ? 5 : 4);
    } catch {
      // Silencieux : au pire le passager repart de l'écran de réservation,
      // ce qui reste préférable à un écran bloqué sur une erreur au démarrage.
    }
  }

  // Bandeau "Course en cours" (écrans 1 et 2 uniquement) : si jamais le
  // passager se retrouve malgré tout sur l'écran de réservation avec une
  // course déjà active — plutôt que de le laisser taper dans le vide et
  // découvrir le conflit seulement à la confirmation, on l'affiche
  // proactivement avec un accès direct à sa course. La navigation ne se
  // fait que sur tap explicite (bouton "Voir"), pas automatiquement, pour
  // ne pas surprendre un passager qui regardait encore le formulaire.
  async function goToActiveTrip() {
    if (!session?.user) return;
    await restoreActiveTrip(session.user.id);
  }

  useEffect(() => {
    if (!session?.user || restoredActiveTrip.current) return;
    restoredActiveTrip.current = true;
    restoreActiveTrip(session.user.id);
  }, [session]);

  // Filet de sécurité iOS Safari : quand la page revient au premier plan
  // depuis le cache "retour arrière" (bfcache) — bouton retour du
  // navigateur, changement d'onglet — le DOM affiché peut être un instantané
  // figé d'avant la création de la course (ex. écran de réservation) même
  // si une course est bel et bien en cours côté serveur. On revérifie
  // l'état réel à chaque retour au premier plan de ce type.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted || !session?.user) return;
      restoreActiveTrip(session.user.id);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
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

  // Prix fixe : uniquement celui calculé depuis la grille tarifaire
  // (pricing_rules × distance). Le passager ne peut ni l'augmenter ni le
  // diminuer — aucun stepper, aucun offset stocké côté client.
  const recommendedPrice = priceFor(vehicle);
  const selectedPrice = recommendedPrice;

  function resetToBooking() {
    setStep(1);
    setTrip(null);
    setDriver(null);
    setVehicleInfo(null);
    setRating(0);
    setError(null);
    setActiveTripBanner(null);
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
      const price = selectedPrice;
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
      const isActiveTripConflict = e?.code === '23505' || e?.message?.includes('trips_one_active_per_passenger');
      // Une requête en double (relance réseau, double-clic) peut échouer après
      // qu'une autre a déjà réussi et fait avancer l'écran : on n'affiche
      // jamais une erreur obsolète par-dessus un écran déjà passé à l'étape 3.
      setStep((current) => {
        if (current === 2) {
          if (isActiveTripConflict) {
            // Le bandeau "Course en cours" (avec accès direct à cette
            // course) remplace le message d'erreur brut — plus clair et
            // actionnable qu'un texte d'erreur générique.
            if (session?.user) fetchActiveTripBanner(session.user.id);
          } else {
            setError(
              e?.message?.includes('row-level security')
                ? "La demande n'a pas pu être envoyée, réessayez."
                : e?.message ?? 'Impossible de créer la course.'
            );
          }
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

        {(step === 1 || step === 2) && activeTripBanner && (
          <ActiveTripBanner trip={activeTripBanner} onView={goToActiveTrip} />
        )}

        {step === 1 && (
          <Screen1
            vehicle={vehicle}
            onSelect={setVehicle}
            priceFor={priceFor}
            selectedPrice={selectedPrice}

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
            price={selectedPrice}
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
            passengerId={session.user.id}
            onOptions={() => setShowHistory(true)}
            onMenu={() => setShowMenu(true)}
            driverEtaSeconds={driverEtaSeconds}
            onEtaChange={setDriverEtaSeconds}
          />
        )}

        {step === 5 && driver && trip && (
          <Screen5 driver={driver} trip={trip} driverPos={driverPos} passengerId={session.user.id} />
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
            amount={selectedPrice}
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
// Sous-titre affiché sous le nom du véhicule dans la liste (façon Heetch :
// nom du véhicule + info rapide comme le nombre de places).
const VEHICLE_SUBTITLE: Record<VehicleType, string> = {
  berline: '4 places',
  van: '7 places',
  suv: '5 places',
};

/* ---------------------------------------------------------------------- */
/* Bandeau "Course en cours" — écrans 1 et 2 uniquement, voir goToActiveTrip */
/* ---------------------------------------------------------------------- */
function ActiveTripBanner({ trip, onView }: { trip: Trip; onView: () => void }) {
  const statusLabel = trip.status === 'pending' ? 'Recherche d\'un chauffeur…' : trip.status === 'in_progress' ? 'En route vers la destination' : 'Le chauffeur arrive';
  return (
    <div
      style={{
        position: 'absolute',
        top: 64,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: 'rgba(13,9,6,0.55)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 8,
      }}
    >
      <div
        style={{
          width: 'calc(100% - 24px)',
          maxWidth: 480,
          height: 'fit-content',
          background: '#1c1108',
          border: '0.5px solid #a97a5b',
          borderRadius: 14,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#3b2716', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
          🚗
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#f7e6d4' }}>Course en cours</p>
          <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#a89680', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {statusLabel} · {trip.pickup_address ?? 'Départ'} → {trip.dropoff_address ?? 'Destination'}
          </p>
        </div>
        <button
          onClick={onView}
          style={{ flexShrink: 0, background: '#efd9b8', color: '#3c2a1a', border: 'none', borderRadius: 999, padding: '8px 12px', fontSize: 10.5, fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          Voir
        </button>
      </div>
    </div>
  );
}

function Screen1({
  vehicle,
  onSelect,
  priceFor,
  selectedPrice,
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
  selectedPrice: number | null;
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
            <div className="yn-classes-label">Choisissez votre véhicule</div>
            <div className="yn-vlist">
              {types.map((t) => (
                <div
                  key={t.key}
                  className={`yn-vrow ${vehicle === t.key ? 'selected' : ''}`}
                  onClick={() => onSelect(t.key)}
                >
                  <img className="yn-vrow-icon" src={t.icon} alt={VEHICLE_LABELS[t.key]} />
                  <div className="yn-vrow-info">
                    <div className="yn-vrow-name">{VEHICLE_LABELS[t.key]}</div>
                    <div className="yn-vrow-sub">{VEHICLE_SUBTITLE[t.key]}</div>
                  </div>
                  <div className="yn-vrow-price">{ready ? formatFCFA(priceFor(t.key)) : '—'}</div>
                </div>
              ))}
            </div>

            {ready && (
              <div className="yn-price-stepper">
                <div className="yn-stepper-mid" style={{ margin: '0 auto' }}>
                  <div className="yn-stepper-price">{formatFCFA(selectedPrice)}</div>
                  <div className="yn-stepper-caption">Prix fixe</div>
                </div>
              </div>
            )}
          </div>
          <div className="yn-ticket-stub">
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
  const rowRef = useRef<HTMLDivElement>(null);
  // Position calculée dynamiquement (voir dropdown plus bas) : le menu de
  // suggestions est rendu en `position:fixed` ancré sur ce champ plutôt
  // qu'en `position:absolute` imbriqué dans `.yn-addr-group` — ce parent a
  // `overflow:hidden` (pour arrondir le bloc DÉPART/DESTINATION) qui
  // rognait purement et simplement la liste, la rendant invisible.
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Ferme la liste dès qu'on clique/touche en dehors du champ, ou qu'on
  // appuie sur Échap — c'était le bug signalé : la liste de suggestions
  // s'ouvrait à la saisie mais ne se refermait jamais si on ne cliquait
  // pas explicitement sur une suggestion (pas de blur, pas de clic-extérieur).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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

  // Recalcule la position du menu (ancré sous le champ) à chaque ouverture,
  // et la tient à jour tant qu'il est ouvert : le clavier virtuel fait
  // bouger toute la feuille du bas (voir --app-vh dans ViewportHeightFix),
  // donc la position à l'écran du champ change après l'ouverture initiale.
  // `useLayoutEffect` : calcule avant le premier paint, pas de flash à (0,0).
  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open]);

  return (
    <div ref={rowRef} className={`yn-addr-row ${last ? '' : 'yn-addr-row-b'}`} style={{ position: 'relative' }}>
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
      {open && results.length > 0 && dropdownPos && (
        <div
          className="glass"
          style={{
            position: 'fixed',
            top: dropdownPos.top + 4,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 999,
            borderRadius: 12,
            maxHeight: 180,
            overflowY: 'auto',
          }}
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
      <div className="yn-route-compact">
        <div className="dots">
          <div className="d start" />
          <div className="line" />
          <div className="d end" />
        </div>
        <div className="addrs">
          <div className="a">{pickup.label}</div>
          <div className="a">{dropoff.label}</div>
        </div>
      </div>
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
/* Messages qui tournent pendant la recherche d'un chauffeur, pour donner
   une impression de progression même quand rien de concret n'est encore
   arrivé côté serveur. */
const SEARCH_ROTATING_MESSAGES = [
  'On explore les chauffeurs autour de vous…',
  'Diffusion de votre demande en cours…',
  'On vous trouve la meilleure option…',
  'Ça ne devrait plus tarder…',
];

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
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (notice) return;
    const id = window.setInterval(() => setMsgIndex((i) => (i + 1) % SEARCH_ROTATING_MESSAGES.length), 2800);
    return () => window.clearInterval(id);
  }, [notice]);

  return (
    <div className="screen fade">
      <RealMap pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }} pins={carPins} />
      <div className="yn-search-scrim" />
      <Header onMenuClick={onMenu} onOptionsClick={onOptions} />
      <div className="yn-compass-wrap">
        <div className="yn-compass-ring" />
        <div className="yn-compass-ring r2" />
        <div className="yn-radar-sweep" />
        <div className="yn-radar-ring" />
        <div className="yn-radar-ring d2" />
        <div className="yn-radar-ring d3" />
        <div className="yn-compass-core" />
      </div>
      <div className="yn-compass-label">
        {notice ? notice.toUpperCase() : "RECHERCHE D'UN CHAUFFEUR"}
        <span key={msgIndex} className="yn-rotating-msg">
          {notice ? 'Merci de patienter…' : SEARCH_ROTATING_MESSAGES[msgIndex]}
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
  passengerId,
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
  passengerId: string;
  onOptions: () => void;
  onMenu: () => void;
  driverEtaSeconds: number | null;
  onEtaChange: (seconds: number | null) => void;
}) {
  const pushToast = useToast();
  const [showChat, setShowChat] = useState(false);
  const driverLabel = driver.full_name ?? 'le chauffeur';
  const hasPhone = Boolean(driver.phone);
  // Lien de suivi partageable : la page actuelle (course en cours), avec
  // repli presse-papiers si l'API Web Share n'est pas disponible (desktop,
  // navigateurs plus anciens).
  async function handleShare() {
    const shareData = {
      title: 'Yalla Nimshi — suivi de trajet',
      text: `Je suis en route avec ${driverLabel} (${vehicleInfo.plate}). Suivez mon trajet :`,
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        pushToast('Lien de suivi copié dans le presse-papiers');
      } else {
        pushToast("Le partage n'est pas disponible sur ce navigateur");
      }
    } catch {
      // L'utilisateur a annulé la boîte de partage native : rien à faire.
    }
  }
  // Texte "communiqué" au passager sur le temps d'arrivée du chauffeur,
  // recalculé en temps réel à partir de l'itinéraire trafic (RealMap → onRouteInfo).
  const etaMinutes = driverEtaSeconds != null ? Math.max(0, Math.round(driverEtaSeconds / 60)) : null;
  const etaLabel =
    driverEtaSeconds != null
      ? driverEtaSeconds < 60
        ? "Arrive à l'instant"
        : `${etaMinutes} min`
      : '…';
  // Anneau de progression : 100% de la circonférence à 15 min ou plus, se
  // vide au fur et à mesure que le chauffeur se rapproche (retour visuel
  // continu en plus du chiffre, plus lisible d'un coup d'œil).
  const RING_R = 46;
  const RING_C = 2 * Math.PI * RING_R;
  const etaRatio = driverEtaSeconds != null ? Math.min(1, driverEtaSeconds / (15 * 60)) : 1;
  const ringOffset = RING_C * (1 - etaRatio);

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

      <div className="eta-hero">
        <div className="eta-ring">
          <svg width="104" height="104">
            <circle className="track" cx="52" cy="52" r={RING_R} />
            <circle
              className="bar"
              cx="52" cy="52" r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={ringOffset}
            />
          </svg>
          <div className="eta-num">
            <span className="n">{etaLabel}</span>
            {driverEtaSeconds != null && driverEtaSeconds >= 60 && <span className="u">MIN</span>}
          </div>
        </div>
        <div className="eta-label">Votre chauffeur arrive</div>
        <div className="eta-sub">{driver.full_name ?? 'Le chauffeur'} approche de votre position</div>
      </div>

      <div className="yn-ticket">
        <div className="yn-ticket-body">
          <div className="driver-row">
            <div className="avatar-ring yn-avatar-ring-pulse"><div className="av">🧑🏾‍✈️</div></div>
            <div className="driver-info">
              <div className="driver-name">{driver.full_name ?? 'Chauffeur'}</div>
              <div className="driver-meta">
                <span className="star-badge">{Number(driver.rating_avg).toFixed(1)} ★</span>
                <span>·</span>
                <span>{vehicleInfo.model ?? vehicleInfo.brand}</span>
              </div>
            </div>
            <div>
              <div className="plate">
                <div className="plate-top">TCHAD</div>
                <div className="plate-body">{vehicleInfo.plate}</div>
              </div>
            </div>
          </div>

          <div className="yn-actions-row">
            {hasPhone ? (
              <a className="yn-act-btn" href={`tel:${driver.phone}`}>
                <span className="ic">📞</span>Appeler
              </a>
            ) : (
              <button className="yn-act-btn" onClick={() => pushToast(`Numéro de ${driverLabel} indisponible pour le moment`)}>
                <span className="ic">📞</span>Appeler
              </button>
            )}
            <button className="yn-act-btn" onClick={() => setShowChat(true)}>
              <span className="ic">💬</span>Message
            </button>
            <button className="yn-act-btn" onClick={handleShare}>
              <span className="ic">📍</span>Partager
            </button>
            <button className="yn-act-btn danger" onClick={() => pushToast("L'annulation n'est plus possible : un chauffeur est déjà en route. Contactez-le directement si besoin.")}>
              <span className="ic">✕</span>Annuler
            </button>
          </div>
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

      <div className="yn-mini-route">
        <svg width="100%" height="34" viewBox="0 0 280 34" preserveAspectRatio="none">
          <path d="M6,28 Q90,4 150,20 T274,8" stroke="rgba(232,201,168,0.18)" strokeWidth="2" fill="none" />
          <path
            d="M6,28 Q90,4 150,20 T274,8"
            stroke="#e8944a"
            strokeWidth="2"
            fill="none"
            strokeDasharray="400"
            strokeDashoffset={400 * (1 - (1 - etaRatio))}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <div className="yn-mini-route-label">Le chauffeur trace sa route vers vous</div>
      </div>

      {showChat && (
        <ChatModal
          tripId={trip.id}
          currentUserId={passengerId}
          myRole="passenger"
          otherPartyName={driverLabel}
          otherPartyPhone={driver.phone}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ÉCRAN 5 — En course                                                    */
/* ---------------------------------------------------------------------- */
/* Petits messages qui rythment le trajet, façon "on vous raconte le
   voyage" plutôt qu'un écran figé — tournent toutes les quelques secondes. */
const JOURNEY_MESSAGES = [
  'Installez-vous, on s\'occupe du reste',
  'Le chauffeur connaît bien cette route',
  'Presque à mi-chemin',
  'Trajet suivi en direct, aucune action requise',
];

function Screen5({
  driver,
  trip,
  driverPos,
  passengerId,
}: {
  driver: DriverInfo;
  trip: Trip;
  driverPos: { lat: number; lng: number } | null;
  passengerId: string;
}) {
  const [showChat, setShowChat] = useState(false);
  // Progression estimée du trajet : distance parcourue depuis le départ
  // rapportée à la distance totale départ→arrivée, à partir de la position
  // GPS live du chauffeur. Purement indicatif (ligne droite, pas de suivi
  // de route réelle), mais donne un repère visuel continu au passager.
  const totalKm = haversineKm(trip.pickup_lat, trip.pickup_lng, trip.dropoff_lat, trip.dropoff_lng);
  const doneKm = driverPos ? haversineKm(trip.pickup_lat, trip.pickup_lng, driverPos.lat, driverPos.lng) : 0;
  const progressPct = totalKm > 0 ? Math.min(96, Math.max(4, Math.round((doneKm / totalKm) * 100))) : 8;

  // Itinéraire trafic temps réel restant (chauffeur → destination), pour
  // afficher une distance/ETA qui bouge vraiment pendant le trajet.
  const [routeInfo, setRouteInfo] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const remainingKm = routeInfo ? routeInfo.distanceMeters / 1000 : Math.max(0.3, totalKm - doneKm);
  const remainingMin = routeInfo ? Math.max(1, Math.round(routeInfo.durationSeconds / 60)) : null;
  const speedKmh = routeInfo && routeInfo.durationSeconds > 0 ? (routeInfo.distanceMeters / 1000) / (routeInfo.durationSeconds / 3600) : null;
  const trafficLabel = speedKmh == null ? '—' : speedKmh > 32 ? 'Fluide' : speedKmh > 16 ? 'Modéré' : 'Dense';
  const trafficColor = speedKmh == null ? '#a89680' : speedKmh > 32 ? '#8fe0ac' : speedKmh > 16 ? '#e8c9a8' : '#e2807f';

  // Heure d'arrivée estimée, recalculée à chaque mise à jour d'itinéraire.
  const arrivalLabel = useMemo(() => {
    const base = remainingMin != null ? Date.now() + remainingMin * 60000 : null;
    if (!base) return null;
    return new Date(base).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }, [remainingMin]);

  // Ciel qui suit l'heure de la journée : chaud au lever/coucher, plus
  // sombre la nuit — simple habillage visuel, purement décoratif.
  const hour = new Date().getHours();
  const sky =
    hour >= 6 && hour < 11
      ? 'linear-gradient(200deg,#3a2a44 0%,#5a3a2a 35%,#2a1a10 65%,#0d0906 100%)'
      : hour >= 11 && hour < 17
        ? 'linear-gradient(200deg,#2a3244 0%,#3a2a1c 35%,#1c1108 65%,#0d0906 100%)'
        : hour >= 17 && hour < 20
          ? 'linear-gradient(200deg,#2a1a34 0%,#3a2418 35%,#1c1108 65%,#0d0906 100%)'
          : 'linear-gradient(200deg,#141018 0%,#1c1108 45%,#0d0906 100%)';

  const [msgIndex, setMsgIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setMsgIndex((i) => (i + 1) % JOURNEY_MESSAGES.length), 7000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="screen fade">
      <RealMap
        pickup={{ lat: trip.pickup_lat, lng: trip.pickup_lng }}
        dropoff={{ lat: trip.dropoff_lat, lng: trip.dropoff_lng }}
        driverPosition={driverPos}
        pitch={75}
        buildings3d
        showRoute
        routeFlow
        routeColor="#e8c9a8"
        onRouteInfo={setRouteInfo}
        pins={driverPos ? [{ position: driverPos, car3d: { modelUrl: CAR_MODEL_BY_TYPE[trip.vehicle_type] } }] : []}
      />
      <div className="yn-journey-sky" style={{ background: sky }} />
      <Header locked />

      <div className="yn-journey-milestone">
        <span key={msgIndex} className="yn-rotating-msg">
          {doneKm > 0.3 ? `${JOURNEY_MESSAGES[msgIndex]} · ${doneKm.toFixed(1)} km parcourus` : JOURNEY_MESSAGES[msgIndex]}
        </span>
      </div>

      <div className="yn-journey-stats">
        <div className="yn-journey-stat">
          <div className="v">{remainingKm.toFixed(1)} km</div>
          <div className="l">restants</div>
        </div>
        <div className="yn-journey-stat">
          <div className="v">{remainingMin != null ? `${remainingMin} min` : '…'}</div>
          <div className="l">{arrivalLabel ? `arrivée ${arrivalLabel}` : 'estimées'}</div>
        </div>
        <div className="yn-journey-stat">
          <div className="v" style={{ color: trafficColor }}>{trafficLabel}</div>
          <div className="l">trafic</div>
        </div>
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
            <button
              className="yn-chat-fab"
              onClick={() => setShowChat(true)}
              aria-label="Envoyer un message au chauffeur"
            >
              💬
            </button>
            <div className="driver-name">{formatFCFA(trip.estimated_price)}</div>
          </div>

          <div className="yn-progress-track">
            <div className="yn-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="yn-timeline-labels">
            <span><b>Départ</b><br />{trip.pickup_address}</span>
            <span className="end"><b>Arrivée</b><br />{trip.dropoff_address}</span>
          </div>
        </div>
        <div className="yn-ticket-stub">
          <div style={{ fontSize: 11, textAlign: 'center', color: 'var(--copper-dark)', fontWeight: 700 }}>
            TRAJET EN COURS — AUCUNE ACTION REQUISE
          </div>
        </div>
      </div>

      {showChat && (
        <ChatModal
          tripId={trip.id}
          currentUserId={passengerId}
          myRole="passenger"
          otherPartyName={driver.full_name ?? 'le chauffeur'}
          otherPartyPhone={driver.phone}
          onClose={() => setShowChat(false)}
        />
      )}
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
  const durationMin =
    trip.started_at && trip.completed_at
      ? Math.max(1, Math.round((new Date(trip.completed_at).getTime() - new Date(trip.started_at).getTime()) / 60000))
      : null;
  const km = trip.distance_km ?? haversineKm(trip.pickup_lat, trip.pickup_lng, trip.dropoff_lat, trip.dropoff_lng);

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

      <div className="yn-done-hero">
        <div className="yn-check-wrap">
          <div className="yn-check-circle">
            <svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6" /></svg>
          </div>
          {['38%', '48%', '58%', '44%', '62%'].map((left, i) => (
            <span
              key={i}
              className="yn-confetti"
              style={{
                left,
                background: [
                  'var(--copper-light)', 'var(--copper)', 'var(--copper-cream)', 'var(--danger)', 'var(--copper-light)',
                ][i],
                animationDelay: `${0.5 + i * 0.06}s`,
              }}
            />
          ))}
        </div>
        <div className="yn-done-title">Vous êtes arrivé !</div>
        <div className="yn-done-sub">Merci d&apos;avoir voyagé avec Yalla Nimshi</div>
      </div>

      <div className="yn-ticket" style={{ top: 230 }}>
        <div className="yn-ticket-body">
          <div className="yn-recap-row">
            <svg className="yn-recap-route" width="64" height="34" viewBox="0 0 64 34">
              <path d="M4,28 Q28,6 34,18 T60,6" stroke="var(--copper)" strokeWidth="2" fill="none" />
              <circle cx="4" cy="28" r="3" fill="#5be08a" />
              <circle cx="60" cy="6" r="3" fill="var(--copper-light)" />
            </svg>
            <div className="yn-recap-figures">
              <div><span>{km.toFixed(1)}</span> km</div>
              <div><span>{durationMin ?? '—'}</span> min</div>
            </div>
          </div>

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
