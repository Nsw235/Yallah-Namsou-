'use client';

import { useRef, useState } from 'react';
import { formatFCFA } from '@/lib/pricing';
import {
  DriverDetail,
  adminCreateDriver,
  adminSetDriverPassword,
  adminUpdateDriverAvatar,
  setDriverValidation,
  updateDriverInfo,
} from '@/lib/admin';
import { useToast } from '@/components/Toast';

const VALIDATION_LABEL: Record<string, string> = { approved: 'approuvé', rejected: 'rejeté', suspended: 'suspendu', pending: 'en attente' };

export default function AdminDriversView({
  drivers,
  busy,
  onChanged,
}: {
  drivers: DriverDetail[];
  busy: boolean;
  onChanged: () => void;
}) {
  const pushToast = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DriverDetail | null>(null);
  const [tab, setTab] = useState<'profil' | 'securite' | 'vehicules'>('profil');

  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [licenseDraft, setLicenseDraft] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordOk, setPasswordOk] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState({ fullName: '', phone: '', email: '', password: '', licenseNumber: '' });
  const [createSaving, setCreateSaving] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const filtered = drivers.filter((d) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return `${d.full_name ?? ''} ${d.phone ?? ''} ${d.license_number ?? ''}`.toLowerCase().includes(q);
  });

  function openDriver(d: DriverDetail) {
    setSelected(d);
    setTab('profil');
    setErr(null);
    setNameDraft(d.full_name ?? '');
    setPhoneDraft(d.phone ?? '');
    setLicenseDraft(d.license_number ?? '');
    setPassword('');
    setPassword2('');
    setPasswordOk(false);
  }

  async function refreshSelected() {
    await onChanged();
  }

  function openCreate() {
    setCreateErr(null);
    setCreateDraft({ fullName: '', phone: '', email: '', password: '', licenseNumber: '' });
    setCreating(true);
  }

  async function submitCreate() {
    if (!createDraft.fullName.trim() || !createDraft.email.trim()) {
      setCreateErr('Nom complet et email sont requis.');
      return;
    }
    if (createDraft.password.length < 8) {
      setCreateErr('Mot de passe : 8 caractères minimum.');
      return;
    }
    setCreateSaving(true);
    setCreateErr(null);
    try {
      await adminCreateDriver({
        fullName: createDraft.fullName.trim(),
        phone: createDraft.phone.trim() || undefined,
        email: createDraft.email.trim(),
        password: createDraft.password,
        licenseNumber: createDraft.licenseNumber.trim() || undefined,
      });
      pushToast(`${createDraft.fullName.trim()} — chauffeur ajouté`);
      setCreating(false);
      await onChanged();
    } catch (e: any) {
      setCreateErr(e?.message ?? "Échec de la création du chauffeur.");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleValidation(status: 'approved' | 'rejected' | 'suspended') {
    if (!selected) return;
    setErr(null);
    try {
      await setDriverValidation(selected.id, status);
      await refreshSelected();
      setSelected({ ...selected, validation_status: status });
      pushToast(`${selected.full_name ?? 'Chauffeur'} : ${VALIDATION_LABEL[status]}`);
    } catch (e: any) {
      setErr(e?.message ?? 'Action impossible.');
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selected) return;
    setErr(null);
    setAvatarUploading(true);
    try {
      const url = await adminUpdateDriverAvatar(selected.id, file);
      setSelected({ ...selected, avatar_url: url });
      await refreshSelected();
      pushToast('Photo mise à jour');
    } catch (e: any) {
      setErr(e?.message ?? "Impossible d'envoyer la photo.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function saveProfile() {
    if (!selected) return;
    setSavingProfile(true);
    setErr(null);
    try {
      await updateDriverInfo(selected.id, {
        full_name: nameDraft.trim(),
        phone: phoneDraft.trim(),
        license_number: licenseDraft.trim() || null,
      });
      setSelected({ ...selected, full_name: nameDraft.trim(), phone: phoneDraft.trim(), license_number: licenseDraft.trim() || null });
      await refreshSelected();
      pushToast('Profil chauffeur mis à jour');
    } catch (e: any) {
      setErr(e?.message ?? 'Échec de la mise à jour.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    if (!selected) return;
    setErr(null);
    if (password.length < 8) {
      setErr('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== password2) {
      setErr('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSavingPassword(true);
    try {
      await adminSetDriverPassword(selected.id, password);
      setPassword('');
      setPassword2('');
      setPasswordOk(true);
      pushToast('Mot de passe chauffeur changé');
      setTimeout(() => setPasswordOk(false), 3000);
    } catch (e: any) {
      setErr(e?.message ?? 'Échec du changement de mot de passe.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="admin-list-view">
      <div className="driver-card">
        <div className="section-head-row">
          <div>
            <h2>Chauffeurs ({filtered.length}/{drivers.length})</h2>
            <p className="route-sub">Notes, courses, revenus et statut de validation.</p>
          </div>
          <button className="btn amber btn-inline" onClick={openCreate}>+ Ajouter un nouveau chauffeur</button>
        </div>
        <div className="admin-toolbar">
          <input className="admin-search" placeholder="Rechercher un chauffeur…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="fleet-table drivers-table">
          <div className="fleet-table-head drivers-head">
            <span>Chauffeur</span>
            <span>Note</span>
            <span>Courses</span>
            <span>Revenus générés</span>
            <span>Statut</span>
            <span>Actions</span>
          </div>
          {filtered.map((d) => (
            <div key={d.id} className="fleet-table-row drivers-row">
              <div className="fleet-cell-driver">
                <span className="mini-avatar mini-avatar-lg" style={d.avatar_url ? { backgroundImage: `url(${d.avatar_url})` } : undefined}>
                  {!d.avatar_url && (d.full_name ?? '?').charAt(0).toUpperCase()}
                </span>
                <div>
                  <div className="driver-name">{d.full_name ?? 'Chauffeur'}</div>
                  <div className="route-sub">{d.phone ?? '—'}</div>
                </div>
              </div>
              <div>{Number(d.rating_avg).toFixed(1)} ★</div>
              <div>{d.completed_trips} ✓ / {d.cancelled_trips} ✗</div>
              <div>{formatFCFA(d.revenue_total)}</div>
              <span className={`star-badge status-${d.validation_status === 'approved' ? 'available' : d.validation_status === 'suspended' ? 'offline' : 'busy'}`}>
                {d.validation_status}
              </span>
              <button className="btn ghost" style={{ width: 'auto', padding: '7px 12px' }} onClick={() => openDriver(d)}>
                Gérer
              </button>
            </div>
          ))}
          {filtered.length === 0 && <div className="alert-empty">Aucun chauffeur trouvé.</div>}
        </div>
      </div>

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ajouter un nouveau chauffeur</h3>
            <div className="field">
              <label>NOM COMPLET</label>
              <input value={createDraft.fullName} onChange={(e) => setCreateDraft({ ...createDraft, fullName: e.target.value })} />
            </div>
            <div className="field-grid-2">
              <div className="field">
                <label>TÉLÉPHONE</label>
                <input value={createDraft.phone} onChange={(e) => setCreateDraft({ ...createDraft, phone: e.target.value })} />
              </div>
              <div className="field">
                <label>N° DE PERMIS</label>
                <input value={createDraft.licenseNumber} onChange={(e) => setCreateDraft({ ...createDraft, licenseNumber: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>EMAIL (identifiant de connexion)</label>
              <input type="email" value={createDraft.email} onChange={(e) => setCreateDraft({ ...createDraft, email: e.target.value })} />
            </div>
            <div className="field">
              <label>MOT DE PASSE INITIAL</label>
              <input type="password" placeholder="8 caractères minimum" value={createDraft.password} onChange={(e) => setCreateDraft({ ...createDraft, password: e.target.value })} />
            </div>
            {createErr && <div className="auth-error">{createErr}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setCreating(false)}>Annuler</button>
              <button className="btn amber" disabled={createSaving} onClick={submitCreate}>
                {createSaving ? 'Création…' : 'Créer le chauffeur'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal driver-modal" onClick={(e) => e.stopPropagation()}>
            <div className="avatar-edit-row">
              <input ref={fileRef} type="file" accept="image/*" className="hidden-file-input" onChange={handleAvatarChange} />
              <button
                className="account-avatar account-avatar-lg account-avatar-btn"
                style={selected.avatar_url ? { backgroundImage: `url(${selected.avatar_url})` } : undefined}
                onClick={() => fileRef.current?.click()}
                disabled={avatarUploading}
              >
                {!selected.avatar_url && (selected.full_name ?? '?').charAt(0).toUpperCase()}
                <span className="avatar-edit-badge">📷</span>
                {avatarUploading && <span className="avatar-uploading-overlay" />}
              </button>
              <div>
                <div className="account-name">{selected.full_name ?? 'Chauffeur'}</div>
                <div className="field-hint">Cliquer sur la photo pour la remplacer</div>
              </div>
            </div>

            <div className="admin-tabs">
              {(['profil', 'securite', 'vehicules'] as const).map((t) => (
                <button key={t} className={`admin-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t === 'profil' ? 'Profil' : t === 'securite' ? 'Sécurité' : 'Véhicules'}
                </button>
              ))}
            </div>

            {err && <div className="auth-error">{err}</div>}

            {tab === 'profil' && (
              <>
                <div className="field">
                  <label>NOM COMPLET</label>
                  <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
                </div>
                <div className="field">
                  <label>TÉLÉPHONE</label>
                  <input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} />
                </div>
                <div className="field">
                  <label>N° DE PERMIS</label>
                  <input value={licenseDraft} onChange={(e) => setLicenseDraft(e.target.value)} />
                </div>
                <button className="btn amber" disabled={savingProfile} onClick={saveProfile}>
                  {savingProfile ? 'Enregistrement…' : 'Enregistrer le profil'}
                </button>

                <div className="admin-tabs-sep" />
                <div className="btn-row">
                  {selected.validation_status !== 'approved' ? (
                    <button className="btn cyan" disabled={busy} onClick={() => handleValidation('approved')}>APPROUVER</button>
                  ) : (
                    <button className="btn ghost" disabled={busy} onClick={() => handleValidation('suspended')}>SUSPENDRE</button>
                  )}
                  <button className="btn ghost" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => handleValidation('rejected')}>
                    REJETER
                  </button>
                </div>
              </>
            )}

            {tab === 'securite' && (
              <>
                <div className="field">
                  <label>NOUVEAU MOT DE PASSE</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 caractères minimum" />
                </div>
                <div className="field">
                  <label>CONFIRMER LE MOT DE PASSE</label>
                  <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                </div>
                {passwordOk && <div className="field-hint" style={{ color: 'var(--copper-light)', fontWeight: 700 }}>✓ Mot de passe changé</div>}
                <button className="btn amber" disabled={savingPassword} onClick={savePassword}>
                  {savingPassword ? 'Changement…' : 'Changer le mot de passe'}
                </button>
                <p className="route-sub" style={{ marginTop: 10 }}>
                  Le chauffeur pourra se connecter immédiatement avec ce nouveau mot de passe.
                </p>
              </>
            )}

            {tab === 'vehicules' && (
              <>
                {selected.vehicles.length === 0 && <p className="route-sub">Aucun véhicule assigné.</p>}
                {selected.vehicles.map((v) => (
                  <div key={v.id} className="driver-list-row">
                    <div>
                      <div className="driver-name">{v.brand} {v.model} — {v.plate}</div>
                      <div className="route-sub">{v.type.toUpperCase()}</div>
                    </div>
                    <span className={`star-badge status-${v.status}`}>{v.status}</span>
                  </div>
                ))}
              </>
            )}

            <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setSelected(null)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
