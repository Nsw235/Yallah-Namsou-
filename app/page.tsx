"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, VEHICLE_LABELS, VehicleType } from "../../lib/supabase";

type TripStatus = "pending" | "accepted" | "in_progress" | "completed" | "cancelled";

interface Trip {
  id: string;
  vehicle_type: VehicleType;
  pickup_address: string | null;
  dropoff_address: string | null;
  estimated_price: number | null;
  status: TripStatus;
  requested_at: string;
}

interface Payment {
  id: string;
  trip_id: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  method: "cash" | "airtel_money" | "moov_money";
}

export default function ChauffeurScreen() {
  const [loading, setLoading] = useState(true);
  const [isApprovedDriver, setIsApprovedDriver] = useState<boolean | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [activePayment, setActivePayment] = useState<Payment | null>(null);
  const [pendingTrips, setPendingTrips] = useState<Trip[]>([]);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [working, setWorking] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      setIsApprovedDriver(false);
      setLoading(false);
      return;
    }

    const { data: driverRow } = await supabase
      .from("drivers")
      .select("validation_status")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!driverRow || driverRow.validation_status !== "approved") {
      setIsApprovedDriver(false);
      setLoading(false);
      return;
    }
    setIsApprovedDriver(true);

    // Course active du chauffeur (déjà acceptée, en cours, ou terminée en attente d'encaissement)
    const { data: myTrip } = await supabase
      .from("trips")
      .select("id, vehicle_type, pickup_address, dropoff_address, estimated_price, status, requested_at")
      .eq("driver_id", userData.user.id)
      .in("status", ["accepted", "in_progress", "completed"])
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (myTrip) {
      setActiveTrip(myTrip as Trip);
      const { data: payment } = await supabase
        .from("payments")
        .select("id, trip_id, amount, status, method")
        .eq("trip_id", myTrip.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setActivePayment((payment as Payment) ?? null);
      setPendingTrips([]);
    } else {
      setActiveTrip(null);
      setActivePayment(null);
      const { data: available } = await supabase
        .from("trips")
        .select("id, vehicle_type, pickup_address, dropoff_address, estimated_price, status, requested_at")
        .eq("status", "pending")
        .is("driver_id", null)
        .order("requested_at", { ascending: true });
      setPendingTrips((available as Trip[]) ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function acceptTrip(tripId: string) {
    setWorking(true);
    setStatus(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;

    const { error } = await supabase
      .from("trips")
      .update({ driver_id: userData.user.id, status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", tripId);

    if (error) {
      setStatus({ text: `Impossible d'accepter la course : ${error.message}`, error: true });
    } else {
      setStatus({ text: "Course acceptée ! Direction le point de départ." });
      await loadData();
    }
    setWorking(false);
  }

  async function startTrip(tripId: string) {
    setWorking(true);
    setStatus(null);
    const { error } = await supabase
      .from("trips")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", tripId);

    if (error) {
      setStatus({ text: `Erreur : ${error.message}`, error: true });
    } else {
      setStatus({ text: "Course démarrée. Bonne route !" });
      await loadData();
    }
    setWorking(false);
  }

  async function completeTrip(tripId: string) {
    setWorking(true);
    setStatus(null);
    const { error } = await supabase
      .from("trips")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", tripId);

    if (error) {
      setStatus({ text: `Erreur : ${error.message}`, error: true });
    } else {
      setStatus({ text: "Course terminée. Encaisse le montant en espèces auprès du passager." });
      await loadData();
    }
    setWorking(false);
  }

  async function confirmCashReceived(paymentId: string) {
    setWorking(true);
    setStatus(null);
    const { error } = await supabase.from("payments").update({ status: "paid" }).eq("id", paymentId);

    if (error) {
      setStatus({ text: `Erreur : ${error.message}`, error: true });
    } else {
      setStatus({ text: "Paiement confirmé. Merci !" });
      await loadData();
    }
    setWorking(false);
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="sheet" style={{ position: "static", maxHeight: "none" }}>
          <p>Chargement…</p>
        </div>
      </div>
    );
  }

  if (!isApprovedDriver) {
    return (
      <div className="app-shell">
        <div className="sheet" style={{ position: "static", maxHeight: "none" }}>
          <div className="brand" style={{ marginBottom: 14 }}>Espace chauffeur</div>
          <div className="status-msg error">
            Accès réservé aux chauffeurs validés par l'administrateur. Connecte-toi avec ton compte
            chauffeur, ou contacte l'administrateur si ton dossier est encore en attente de validation.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="sheet" style={{ position: "static", maxHeight: "none", minHeight: "100vh" }}>
        <div className="brand" style={{ marginBottom: 14 }}>Espace chauffeur</div>

        {activeTrip ? (
          <div className="vehicle-card active" style={{ display: "block", cursor: "default", textAlign: "left" }}>
            <div className="vehicle-label" style={{ marginBottom: 6 }}>
              {VEHICLE_LABELS[activeTrip.vehicle_type]} — {activeTrip.status === "accepted" && "Course acceptée"}
              {activeTrip.status === "in_progress" && "Course en cours"}
              {activeTrip.status === "completed" && "Course terminée"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
              📍 {activeTrip.pickup_address || "—"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
              🏁 {activeTrip.dropoff_address || "—"}
            </div>
            <div className="price-box" style={{ marginTop: 0, textAlign: "left" }}>
              <div className="amount">
                {activeTrip.estimated_price?.toLocaleString("fr-FR") ?? "…"} FCFA
              </div>
            </div>

            {activeTrip.status === "accepted" && (
              <button className="confirm-btn" disabled={working} onClick={() => startTrip(activeTrip.id)}>
                {working ? "…" : "Démarrer la course"}
              </button>
            )}

            {activeTrip.status === "in_progress" && (
              <button className="confirm-btn" disabled={working} onClick={() => completeTrip(activeTrip.id)}>
                {working ? "…" : "Terminer la course"}
              </button>
            )}

            {activeTrip.status === "completed" && activePayment && activePayment.status === "pending" && (
              <>
                <div className="payment-badge">
                  💵 Encaissement espèces : {activePayment.amount.toLocaleString("fr-FR")} FCFA
                </div>
                <button
                  className="confirm-btn"
                  disabled={working}
                  onClick={() => confirmCashReceived(activePayment.id)}
                >
                  {working ? "…" : "💵 Argent reçu — Confirmer"}
                </button>
              </>
            )}

            {activeTrip.status === "completed" && activePayment?.status === "paid" && (
              <div className="status-msg">Paiement confirmé pour cette course.</div>
            )}
          </div>
        ) : (
          <>
            <label>Courses disponibles</label>
            {pendingTrips.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Aucune course en attente pour le moment.
              </div>
            )}
            {pendingTrips.map((trip) => (
              <div
                key={trip.id}
                className="vehicle-card"
                style={{ display: "block", cursor: "default", textAlign: "left", marginBottom: 10 }}
              >
                <div className="vehicle-label" style={{ marginBottom: 6 }}>
                  {VEHICLE_LABELS[trip.vehicle_type]}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
                  📍 {trip.pickup_address || "—"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
                  🏁 {trip.dropoff_address || "—"}
                </div>
                <div className="price-box" style={{ marginTop: 0, textAlign: "left" }}>
                  <div className="amount">{trip.estimated_price?.toLocaleString("fr-FR") ?? "…"} FCFA</div>
                </div>
                <button className="confirm-btn" disabled={working} onClick={() => acceptTrip(trip.id)}>
                  {working ? "…" : "Accepter la course"}
                </button>
              </div>
            ))}
          </>
        )}

        {status && <div className={`status-msg ${status.error ? "error" : ""}`}>{status.text}</div>}
      </div>
    </div>
  );
}
