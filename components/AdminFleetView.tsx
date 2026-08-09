'use client';

import { useEffect, useMemo, useState } from 'react';
import { DriverDetail, FleetVehicle, createVehicle, removeVehicle, updateVehicle, updateVehicleStatus } from '@/lib/admin';
import { useToast } from '@/components/Toast';
import VehicleHistoryModal from '@/components/admin/VehicleHistoryModal';

const STATUS_LABEL: Record<string, string> = { available: 'En attente', busy: 'En course', offline: 'Hors ligne' };
const TYPE_LABEL: Record<string, string> = { berline: 'Berline', van: 'Van', suv: 'SUV' };

export default function AdminFleetView({
  fleet,
  drivers,
  busy,
  onChanged,
}: {
  fleet: FleetVehicle[];
  drivers: DriverDetail[];
  busy: boolean;
  onChanged: () => void;
}) {
  const pushToast = useToast();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'berline' | 'van' | 'suv'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'busy' | 'offline'>('all');
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [draft, setDraft] = useState({ plate: '', brand: '', model: '', passenger_capacity: 4 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<FleetVehicle | null>(null);
  const [removing, setRemoving] = useState<FleetVehicle | null>(null);
  const [removeSaving, setRemoveSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState({ plate: '', brand: '', model: '', type: 'berline' as 'berline' | 'van' | 'suv', passenger_capacity: 4, driver_id: '' });
  const [createSaving, setCreateSaving] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setOpenMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

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
    setOpenMenu(null);
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
      pushToast(`${draft.plate.trim()} — véhicule mis à jour`);
      setEditing(null);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Échec de la mise à jour.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffline(v: FleetVehicle) {
    setOpenMenu(null);
    try {
      await updateVehicleStatus(v.id, v.status === 'offline' ? 'available' : 'offline');
      pushToast(v.status === 'offline' ? `${v.plate} remis en ligne` : `${v.plate} mis hors ligne`);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Action impossible.');
    }
  }

  function openCreate() {
    setCreateErr(null);
    setCreateDraft({ plate: '', brand: '', model: '', type: 'berline', passenger_capacity: 4, driver_id: drivers[0]?.id ?? '' });
    setCreating(true);
  }

  async function submitCreate() {
    if (!createDraft.plate.trim()) { setCreateErr('La plaque est requise.'); return; }
    if (!createDraft.driver_id) { setCreateErr('Sélectionnez un chauffeur.'); return; }
    setCreateSaving(true);
    setCreateErr(null);
    try {
      await createVehicle({
        driver_id: createDraft.driver_id,
        type: createDraft.type,
        plate: createDraft.plate.trim(),
        brand: createDraft.brand.trim() || null,
        model: createDraft.model.trim() || null,
        passenger_capacity: Number(createDraft.passenger_capacity) || 4,
      });
      pushToast(`${createDraft.plate.trim()} — véhicule ajouté à la flotte`);
      setCreating(false);
      onChanged();
    } catch (e: any) {
      setCreateErr(e?.message ?? "Échec de l'ajout du véhicule.");
    } finally {
      setCreateSaving(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveSaving(true);
    try {
      await removeVehicle(removing.id);
      pushToast(`${removing.plate} retiré de la flotte`);
      setRemoving(null);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Impossible de retirer ce véhicule.');
    } finally {
      setRemoveSaving(false);
    }
  }

  return (
    <div>
      <div className="adm2-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="adm2-section-title">Flotte ({filtered.length}/{fleet.length})</p>
        <button className="adm2-btn-primary" onClick={openCreate}>
          <span style={{ fontSize: 12 }}>＋</span>Ajouter
        </button>
      </div>

      <div style={{ padding: '10px 14px 0' }}>
        <div className="adm2-search">
          <input placeholder="Plaque, marque, chauffeur…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="adm2-chips">
          <button className={`adm2-chip ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>Tous</button>
          <button className={`adm2-chip ${typeFilter === 'berline' ? 'active' : ''}`} onClick={() => setTypeFilter('berline')}>Berline</button>
          <button className={`adm2-chip ${typeFilter === 'van' ? 'active' : ''}`} onClick={() => setTypeFilter('van')}>Van</button>
          <button className={`adm2-chip ${typeFilter === 'suv' ? 'active' : ''}`} onClick={() => setTypeFilter('suv')}>SUV</button>
          <button className={`adm2-chip ${statusFilter === 'available' ? 'active' : ''}`} onClick={() => setStatusFilter(statusFilter === 'available' ? 'all' : 'available')}>En attente</button>
          <button className={`adm2-chip ${statusFilter === 'busy' ? 'active' : ''}`} onClick={() => setStatusFilter(statusFilter === 'busy' ? 'all' : 'busy')}>En course</button>
          <button className={`adm2-chip ${statusFilter === 'offline' ? 'active' : ''}`} onClick={() => setStatusFilter(statusFilter === 'offline' ? 'all' : 'offline')}>Hors ligne</button>
        </div>
      </div>

      {err && <div className="auth-error" style={{ margin: '10px 14px 0' }}>{err}</div>}

      <div className="adm2-list" style={{ marginTop: 6 }}>
        {filtered.length === 0 && <div className="adm2-empty">Aucun véhicule ne correspond aux filtres.</div>}
        {filtered.map((v) => {
          const dotColor = v.status === 'available' ? '#5a9c6f' : v.status === 'busy' ? '#4d9fff' : '#5a5147';
          const badgeClass = v.status === 'available' ? 'adm2-badge-green' : v.status === 'busy' ? 'adm2-badge-gray' : 'adm2-badge-gray';
          return (
            <div key={v.id} className="adm2-row" style={{ position: 'relative' }} onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === v.id ? null : v.id); }}>
              <span className="adm2-row-dot" style={{ background: dotColor }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="adm2-row-title">{v.plate} · {v.brand} {v.model}</p>
                <p className="adm2-row-sub">{v.driver_name ?? '—'} · {v.type.toUpperCase()}</p>
              </div>
              <span
                className={`adm2-badge ${v.status === 'busy' ? '' : badgeClass}`}
                style={v.status === 'busy' ? { color: '#9cc4f5', background: '#101722' } : undefined}
              >
                {STATUS_LABEL[v.status].toUpperCase()}
              </span>
              <span className="adm2-row-chevron">⋮</span>
              {openMenu === v.id && (
                <div className="row-dropdown" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 14, top: '100%', zIndex: 30 }}>
                  <button onClick={() => openEdit(v)}>Modifier</button>
                  <button disabled={busy} onClick={() => toggleOffline(v)}>
                    {v.status === 'offline' ? 'Remettre en ligne' : 'Mettre hors ligne'}
                  </button>
                  <button onClick={() => { setOpenMenu(null); setHistoryFor(v); }}>Historique</button>
                  <hr />
                  <button className="danger" onClick={() => { setOpenMenu(null); setRemoving(v); }}>Retirer</button>
                </div>
              )}
            </div>
          );
        })}
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

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ajouter un véhicule</h3>
            <div className="field">
              <label>TYPE</label>
              <select value={createDraft.type} onChange={(e) => setCreateDraft({ ...createDraft, type: e.target.value as any })}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>PLAQUE D&apos;IMMATRICULATION</label>
              <input value={createDraft.plate} onChange={(e) => setCreateDraft({ ...createDraft, plate: e.target.value })} placeholder="Ex : 3494629B" />
            </div>
            <div className="field-grid-2">
              <div className="field">
                <label>MARQUE</label>
                <input value={createDraft.brand} onChange={(e) => setCreateDraft({ ...createDraft, brand: e.target.value })} />
              </div>
              <div className="field">
                <label>MODÈLE</label>
                <input value={createDraft.model} onChange={(e) => setCreateDraft({ ...createDraft, model: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>CAPACITÉ (places)</label>
              <input
                type="number"
                min={1}
                max={9}
                value={createDraft.passenger_capacity}
                onChange={(e) => setCreateDraft({ ...createDraft, passenger_capacity: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>CHAUFFEUR ASSIGNÉ</label>
              <select value={createDraft.driver_id} onChange={(e) => setCreateDraft({ ...createDraft, driver_id: e.target.value })}>
                <option value="" disabled>Sélectionner un chauffeur…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name ?? d.phone ?? d.id}</option>
                ))}
              </select>
              {drivers.length === 0 && <div className="field-hint">Ajoutez d&apos;abord un chauffeur dans l&apos;onglet Chauffeurs.</div>}
            </div>
            {createErr && <div className="auth-error">{createErr}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setCreating(false)}>Annuler</button>
              <button className="btn amber" disabled={createSaving} onClick={submitCreate}>
                {createSaving ? 'Ajout…' : 'Ajouter le véhicule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyFor && (
        <VehicleHistoryModal
          vehicleId={historyFor.id}
          vehicleLabel={`${historyFor.brand ?? ''} ${historyFor.model ?? ''} · ${historyFor.plate}`}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {removing && (
        <div className="modal-overlay" onClick={() => setRemoving(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Retirer {removing.plate} de la flotte ?</h3>
            <p className="route-sub" style={{ marginBottom: 14 }}>
              Ce véhicule ne sera plus visible dans la supervision ni assignable à des courses. Son historique de courses est conservé.
            </p>
            {err && <div className="auth-error">{err}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setRemoving(null)}>Annuler</button>
              <button className="btn amber" style={{ background: 'linear-gradient(180deg,#ff8a8a,var(--danger))' }} disabled={removeSaving} onClick={confirmRemove}>
                {removeSaving ? 'Retrait…' : 'Retirer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
