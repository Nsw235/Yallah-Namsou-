'use client';

import { useEffect, useState } from 'react';
import { formatFCFA } from '@/lib/pricing';
import { getVehicleTripHistory, VehicleTripHistoryRow } from '@/lib/admin';

const STATUS_LABEL: Record<string, string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  in_progress: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

export default function VehicleHistoryModal({
  vehicleId,
  vehicleLabel,
  onClose,
}: {
  vehicleId: string;
  vehicleLabel: string;
  onClose: () => void;
}) {
  const [trips, setTrips] = useState<VehicleTripHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVehicleTripHistory(vehicleId)
      .then(setTrips)
      .catch((e) => setError(e?.message ?? "Impossible de charger l'historique."));
  }, [vehicleId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Historique — {vehicleLabel}</h3>
        {error && <div className="auth-error">{error}</div>}
        {!trips && !error && <div className="history-empty">Chargement…</div>}
        {trips && trips.length === 0 && <div className="history-empty">Aucune course pour ce véhicule.</div>}
        {trips?.map((t) => (
          <div className="history-item" key={t.id}>
            <div className="history-row">
              <span className="k">Trajet</span>
              <span>{t.pickup_address ?? '—'} → {t.dropoff_address ?? '—'}</span>
            </div>
            <div className="history-row">
              <span className="k">Passager</span>
              <span>{t.passenger_name ?? '—'}</span>
            </div>
            <div className="history-row">
              <span className="k">Statut</span>
              <span>{STATUS_LABEL[t.status] ?? t.status}</span>
            </div>
            <div className="history-row">
              <span className="k">Prix</span>
              <span>{formatFCFA(t.final_price ?? t.estimated_price)}</span>
            </div>
            <div className="history-row">
              <span className="k">Date</span>
              <span>{new Date(t.requested_at).toLocaleString('fr-FR')}</span>
            </div>
          </div>
        ))}
        <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
