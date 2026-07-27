'use client';

import { useEffect, useState } from 'react';
import { TripWithDriver } from '@/types/database';
import { getTripHistory } from '@/lib/rides';
import { formatFCFA, VEHICLE_LABELS } from '@/lib/pricing';

export default function HistoryModal({
  passengerId,
  onClose,
}: {
  passengerId: string;
  onClose: () => void;
}) {
  const [trips, setTrips] = useState<TripWithDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTripHistory(passengerId)
      .then(setTrips)
      .catch((err) => setError(err?.message ?? 'Impossible de charger l\u2019historique.'));
  }, [passengerId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Historique des courses</h3>
        {error && <div className="auth-error">{error}</div>}
        {!trips && !error && <div className="history-empty">Chargement…</div>}
        {trips && trips.length === 0 && (
          <div className="history-empty">Aucune course terminée pour le moment.</div>
        )}
        {trips?.map((t) => (
          <div className="history-item" key={t.id}>
            <div className="history-row">
              <span className="k">Trajet</span>
              <span>{t.pickup_address} → {t.dropoff_address}</span>
            </div>
            <div className="history-row">
              <span className="k">Véhicule</span>
              <span>{VEHICLE_LABELS[t.vehicle_type]}{t.vehicle_info?.plate ? ` · ${t.vehicle_info.plate}` : ''}</span>
            </div>
            <div className="history-row">
              <span className="k">Chauffeur</span>
              <span>{t.driver_profile?.full_name ?? '—'}</span>
            </div>
            <div className="history-row">
              <span className="k">Prix</span>
              <span>{formatFCFA(t.final_price ?? t.estimated_price)}</span>
            </div>
            <div className="history-row">
              <span className="k">Date</span>
              <span>{t.completed_at ? new Date(t.completed_at).toLocaleString('fr-FR') : '—'}</span>
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
