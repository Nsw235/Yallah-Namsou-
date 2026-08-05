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
    <div className="admin-list-view">
      <div className="driver-card">
        <div className="section-head-row">
          <div>
            <h2>Flotte de véhicules ({filtered.length}/{fleet.length})</h2>
            <p className="route-sub">Véhicules actifs, statut en temps réel, chauffeur assigné.</p>
          </div>
          <button className="btn amber btn-inline" onClick={openCreate}>+ Ajouter un véhicule</button>
        </div>

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
            <span></span>
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
              <span className={`star-badge status-${v.status}`}>
                <span className="bdot" />
                {STATUS_LABEL[v.status]}
              </span>
              <div className="route-sub">
                {v.last_lat != null && v.last_lng != null ? `${v.last_lat.toFixed(4)}, ${v.last_lng.toFixed(4)}` : 'Aucune'}
              </div>
              <div className="row-menu-wrap">
                <button
                  className="dots-btn"
                  onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === v.id ? null : v.id); }}
                  aria-label="Actions"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 6h.01M12 12h.01M12 18h.01" />
                  </svg>
                </button>
                {openMenu === v.id && (
                  <div className="row-dropdown" onClick={(e) => e.stopPropagation()}>
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
            </div>
          ))}
          {filtered.length === 0 && <div className="alert-empty">Aucun véhicule ne correspond aux filtres.</div>}
        </div>

        <div className="fleet-card-list">
          {filtered.map((v) => (
            <div key={v.id} className="fleet-card">
              <div className="fleet-card-top">
                <div>
                  <div className="driver-name">{v.brand} {v.model}</div>
                  <div className="route-sub">{v.plate} · {v.type.toUpperCase()} · {v.passenger_capacity ?? '—'} places</div>
                </div>
                <div className="row-menu-wrap">
                  <button
                    className="dots-btn"
                    onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === v.id ? null : v.id); }}
                    aria-label="Actions"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 6h.01M12 12h.01M12 18h.01" />
                    </svg>
                  </button>
                  {openMenu === v.id && (
                    <div className="row-dropdown" onClick={(e) => e.stopPropagation()}>
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
              </div>
              <span className={`star-badge status-${v.status}`}>
                <span className="bdot" />
                {STATUS_LABEL[v.status]}
              </span>
              <div className="fleet-card-driver">
                <span className="mini-avatar" style={v.driver_avatar ? { backgroundImage: `url(${v.driver_avatar})` } : undefined}>
                  {!v.driver_avatar && (v.driver_name ?? '?').charAt(0).toUpperCase()}
                </span>
                <div>
                  <div>{v.driver_name ?? '—'}</div>
                  <div className="route-sub">{v.driver_phone ?? ''}</div>
                </div>
              </div>
            </div>
          ))}
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
