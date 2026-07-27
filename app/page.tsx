"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase, VehicleType, VEHICLE_LABELS, PricingRule } from "../lib/supabase";
import ChadFlag from "../components/ChadFlag";
import { IconBerline, IconPrestige, IconSUV } from "../components/VehicleIcons";

// La carte utilise le DOM (Leaflet) : chargement uniquement côté client, jamais pré-rendu au build.
const MapBackground = dynamic(() => import("../components/MapBackground"), { ssr: false });

const VEHICLE_ORDER: VehicleType[] = ["berline", "prestige", "suv"];
const VEHICLE_ICON: Record<VehicleType, (props: { active: boolean }) => JSX.Element> = {
  berline: IconBerline,
  prestige: IconPrestige,
  suv: IconSUV,
};

export default function BookingScreen() {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [vehicleType, setVehicleType] = useState<VehicleType>("berline");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distanceKm, setDistanceKm] = useState<number>(3);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase
      .from("pricing_rules")
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          setStatus({ text: `Impossible de charger les tarifs (${error.message}).`, error: true });
          return;
        }
        setPricingRules(data ?? []);
      });
  }, []);

  const rule = pricingRules.find((r) => r.vehicle_type === vehicleType);
  const estimatedPrice = rule ? Math.round(rule.base_fare + rule.price_per_km * distanceKm) : null;

  async function confirmTrip() {
    setSubmitting(true);
    setStatus(null);

    const { data: userData } = await supabase.auth.getUser();

    if (!userData?.user) {
      setStatus({
        text: "Connexion requise : l'authentification par téléphone (OTP) n'est pas encore branchée sur cet écran de démo. Le calcul de prix ci-dessus fonctionne déjà avec les vraies données Supabase.",
        error: true,
      });
      setSubmitting(false);
      return;
    }

    const { data: trip, error } = await supabase
      .from("trips")
      .insert({
        passenger_id: userData.user.id,
        vehicle_type: vehicleType,
        pickup_lat: 12.1348,
        pickup_lng: 15.0557,
        pickup_address: pickup,
        dropoff_lat: 12.1348,
        dropoff_lng: 15.0557,
        dropoff_address: dropoff,
        estimated_price: estimatedPrice,
      })
      .select()
      .single();

    if (error || !trip) {
      setStatus({ text: `Erreur lors de la demande : ${error?.message}`, error: true });
      setSubmitting(false);
      return;
    }

    // Paiement en espèces : on ouvre l'enregistrement dès la réservation,
    // le chauffeur le passera à "paid" en fin de course une fois l'argent remis.
    const { error: paymentError } = await supabase.from("payments").insert({
      trip_id: trip.id,
      method: "cash",
      amount: estimatedPrice ?? 0,
      status: "pending",
    });

    if (paymentError) {
      setStatus({
        text: `Course créée, mais le paiement n'a pas pu être initialisé (${paymentError.message}).`,
        error: true,
      });
    } else {
      setStatus({ text: "Course demandée ! Paiement en espèces à la remise. Recherche d'un chauffeur disponible…" });
    }
    setSubmitting(false);
  }

  return (
    <div className="app-shell">
      <div className="map-layer">
        <MapBackground />
      </div>

      <div className="top-bar">
        <div className="brand">
          Yallah-Namsou <span dir="rtl">نمشوا</span>
        </div>
        <ChadFlag />
      </div>

      <div className="sheet">
        <label>Type de véhicule</label>
        <div className="vehicle-grid">
          {VEHICLE_ORDER.map((type) => {
            const Icon = VEHICLE_ICON[type];
            const active = vehicleType === type;
            return (
              <div
                key={type}
                className={`vehicle-card ${active ? "active" : ""}`}
                onClick={() => setVehicleType(type)}
              >
                {active && <span className="check">✓</span>}
                <Icon active={active} />
                <span className="vehicle-label">{VEHICLE_LABELS[type]}</span>
              </div>
            );
          })}
        </div>

        <label>Point de départ</label>
        <div className="input-wrap">
          <input
            type="text"
            placeholder="Ex : Avenue Charles de Gaulle"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
          />
          <span className="input-icon">📍</span>
        </div>

        <label>Destination</label>
        <div className="input-wrap split">
          <input
            type="text"
            placeholder="Ex : Aéroport de N'Djamena"
            value={dropoff}
            onChange={(e) => setDropoff(e.target.value)}
          />
          <input
            type="number"
            className="km-input"
            min={0.5}
            step={0.5}
            value={distanceKm}
            onChange={(e) => setDistanceKm(parseFloat(e.target.value) || 0)}
            title="Distance estimée (km) — géolocalisation à brancher ensuite"
          />
        </div>

        <div className="price-box">
          <div className="label">Prix estimé</div>
          <div className="amount">
            {estimatedPrice !== null ? `${estimatedPrice.toLocaleString("fr-FR")} FCFA` : "…"}
          </div>
        </div>

        <div className="payment-badge">💵 Paiement : Espèces à la remise</div>

        <button
          className="confirm-btn"
          disabled={submitting || !pickup || !dropoff}
          onClick={confirmTrip}
        >
          {submitting ? "Envoi en cours…" : "Confirmer la course"}
        </button>

        {status && (
          <div className={`status-msg ${status.error ? "error" : ""}`}>{status.text}</div>
        )}
      </div>
    </div>
  );
}
