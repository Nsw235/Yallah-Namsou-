"use client";

import { useEffect, useState } from "react";
import { supabase, VehicleType, PricingRule } from "../lib/supabase";

export default function BookingScreen() {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [vehicleType, setVehicleType] = useState<VehicleType>("moto");
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

    const { error } = await supabase.from("trips").insert({
      passenger_id: userData.user.id,
      vehicle_type: vehicleType,
      pickup_lat: 12.1348,
      pickup_lng: 15.0557,
      pickup_address: pickup,
      dropoff_lat: 12.1348,
      dropoff_lng: 15.0557,
      dropoff_address: dropoff,
      estimated_price: estimatedPrice,
    });

    if (error) {
      setStatus({ text: `Erreur lors de la demande : ${error.message}`, error: true });
    } else {
      setStatus({ text: "Course demandée ! Recherche d'un chauffeur disponible…" });
    }
    setSubmitting(false);
  }

  return (
    <div className="screen">
      <div className="header">
        <h1>Où allez-vous ?</h1>
        <p>N'Djamena · Moto ou voiture, à la demande</p>
      </div>

      <div className="content">
        <label>Type de véhicule</label>
        <div className="vehicle-toggle">
          <div
            className={`vehicle-btn ${vehicleType === "moto" ? "active" : ""}`}
            onClick={() => setVehicleType("moto")}
          >
            <span className="emoji">🏍️</span>
            Moto
          </div>
          <div
            className={`vehicle-btn ${vehicleType === "voiture" ? "active" : ""}`}
            onClick={() => setVehicleType("voiture")}
          >
            <span className="emoji">🚗</span>
            Voiture
          </div>
        </div>

        <label>Point de départ</label>
        <input
          type="text"
          placeholder="Ex : Avenue Charles de Gaulle"
          value={pickup}
          onChange={(e) => setPickup(e.target.value)}
        />

        <label>Destination</label>
        <input
          type="text"
          placeholder="Ex : Aéroport de N'Djamena"
          value={dropoff}
          onChange={(e) => setDropoff(e.target.value)}
        />

        <label>Distance estimée (km) — géolocalisation à brancher ensuite</label>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={distanceKm}
          onChange={(e) => setDistanceKm(parseFloat(e.target.value) || 0)}
        />

        <div className="price-box">
          <div className="label">Prix estimé</div>
          <div className="amount">
            {estimatedPrice !== null ? `${estimatedPrice.toLocaleString("fr-FR")} FCFA` : "…"}
          </div>
        </div>

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
