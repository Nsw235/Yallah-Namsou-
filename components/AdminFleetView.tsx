'use client';

import { useMemo, useState } from 'react';
import { FleetVehicle, updateVehicle, updateVehicleStatus } from '@/lib/admin';

const STATUS_LABEL: Record<string, string> = { available: 'En attente', busy: 'En course', offline: 'Hors ligne' };

export default function AdminFleetView({ fleet, busy, onChanged }: { fleet: FleetVehicle[]; busy: boolean; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'berline' | 'van' | 'suv'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'busy' | 'offline'>('all');
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [draft, setDraft] = useState({ plate: '', brand: '', model: '', passenger_capacity: 4 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return fleet.filter((v) => {
      if (typeFilter !== 'all' && v.type !== typeFilter) return false;
      if (statusFilter !== 'all' && v.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = `${v.plate} ${v.brand ?? ''} ${v.model ?? ''} ${v.driver_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [fleet, query, typeFilter, statusFilter]);

  function openEdit(v: FleetVehicle) {
    setEditing(v);
    setErr(null);
    setDraft({ plate: v.plate, brand: v.brand ?? '', model: v.model ?? '', passenger_capacity: v.passenger_capacity ?? 4 });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setErr(null);
    try {
      await updateVehicle(editing.id, {
        plate: draft.plate.trim(),
        brand: draft.brand.trim() || null,
        model: draft.model.trim() || null,
        passenger_capacity: Number(draft.passenger_capacity) || 4,
      });
      setEditing(null);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Échec de la mise à jour.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffline(v: FleetVehicle) {
    try {
      await updateVehicleStatus(v.id, v.status === 'offline' ? 'available' : 'offline');
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Action impossible.');
    }
  }

  return (
    <div className="admin-list-view">
      <div className="driver-card">
        <h2>Flotte de véhicules ({filtered.length}/{fleet.length})</h2>

        <div className="admin-toolbar">
          <input className="admin-search" placeholder="Rechercher plaque, marque, chauffeur…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="admin-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
            <option value="all">Tous types</option>
            <option value="berline">Berline</option>
            <option value="van">Van</option>
            <option value="suv">SUV</option>
          </select>
          <select className="admin-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="all">Tous statuts</option>
            <option value="available">En attente</option>
            <option value="busy">En course</option>
            <option value="offline">Hors ligne</option>
          </select>
        </div>

        {err && <div className="auth-error">{err}</div>}

        <div className="fleet-table">
          <div className="fleet-table-head">
            <span>Véhicule</span>
            <span>Chauffeur</span>
            <span>Capacité</span>
            <span>Statut</span>
            <span>Position GPS</span>
            <span>Actions</span>
          </div>
          {filtered.map((v) => (
            <div key={v.id} className="fleet-table-row">
              <div className="fleet-cell-main">
                <div className="driver-name">{v.brand} {v.model}</div>
                <div className="route-sub">{v.plate} · {v.type.toUpperCase()}</div>
              </div>
              <div className="fleet-cell-driver">
                <span className="mini-avatar" style={v.driver_avatar ? { backgroundImage: `url(${v.driver_avatar})` } : undefined}>
                  {!v.driver_avatar && (v.driver_name ?? '?').charAt(0).toUpperCase()}
                </span>
                <div>
                  <div>{v.driver_name ?? '—'}</div>
                  <div className="route-sub">{v.driver_phone ?? ''}</div>
                </div>
              </div>
              <div>{v.passenger_capacity ?? '—'} places</div>
              <span className={`star-badge status-${v.status}`}>{STATUS_LABEL[v.status]}</span>
              <div className="route-sub">
                {v.last_lat != null && v.last_lng != null ? `${v.last_lat.toFixed(4)}, ${v.last_lng.toFixed(4)}` : 'Aucune'}
              </div>
              <div className="fleet-cell-actions">
                <button className="btn ghost" style={{ width: 'auto', padding: '7px 12px' }} onClick={() => openEdit(v)}>
                  Modifier
                </button>
                <button className="btn ghost" style={{ width: 'auto', padding: '7px 12px' }} disabled={busy} onClick={() => toggleOffline(v)}>
                  {v.status === 'offline' ? 'Remettre en ligne' : 'Mettre hors ligne'}
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="alert-empty">Aucun véhicule ne correspond aux filtres.</div>}
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Modifier {editing.plate}</h3>
            <div className="field">
              <label>PLAQUE D&apos;IMMATRICULATION</label>
              <input value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} />
            </div>
            <div className="field">
              <label>MARQUE</label>
              <input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
            </div>
            <div className="field">
              <label>MODÈLE</label>
              <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
            </div>
            <div className="field">
              <label>CAPACITÉ (places)</label>
              <input
                type="number"
                min={1}
                max={9}
                value={draft.passenger_capacity}
                onChange={(e) => setDraft({ ...draft, passenger_capacity: Number(e.target.value) })}
              />
            </div>
            {err && <div className="auth-error">{err}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn amber" disabled={saving} onClick={saveEdit}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
