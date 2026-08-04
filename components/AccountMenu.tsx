'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { updateMyAvatar, updateMyProfileInfo } from '@/lib/driver';

export default function AccountMenu({
  session,
  onClose,
  onHistory,
}: {
  session: Session;
  onClose: () => void;
  onHistory: () => void;
}) {
  const [fullName, setFullName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Vue "menu" (par défaut) ou "édition du profil".
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  function loadProfile() {
    supabase
      .from('profiles')
      .select('full_name, phone, avatar_url')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setFullName(data?.full_name ?? null);
        setPhone(data?.phone ?? null);
        setAvatarUrl(data?.avatar_url ?? null);
        setNameDraft(data?.full_name ?? '');
        setPhoneDraft(data?.phone ?? '');
      });
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    // Pas besoin de setSigningOut(false) / onClose() : onAuthStateChange
    // fait revenir sur AuthGate et démonte ce composant.
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const url = await updateMyAvatar(session.user.id, file);
      setAvatarUrl(url);
    } catch (err: any) {
      setAvatarError(err?.message ?? "Impossible d'envoyer la photo.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleSaveProfile() {
    setSaveError(null);
    setSaved(false);
    if (!nameDraft.trim()) {
      setSaveError('Le nom ne peut pas être vide.');
      return;
    }
    setSaving(true);
    try {
      await updateMyProfileInfo(session.user.id, { full_name: nameDraft, phone: phoneDraft });
      setFullName(nameDraft.trim());
      setPhone(phoneDraft.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Échec de la mise à jour du profil.');
    } finally {
      setSaving(false);
    }
  }

  const initial = (fullName ?? session.user.email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!editing ? (
          <>
            <div className="account-head">
              <button
                className="account-avatar account-avatar-btn"
                style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
                onClick={() => setEditing(true)}
                aria-label="Modifier mon profil"
              >
                {!avatarUrl && initial}
              </button>
              <div>
                <div className="account-name">{fullName ?? 'Mon compte'}</div>
                <div className="account-sub">{phone ?? session.user.email}</div>
              </div>
            </div>

            <button className="menu-item" onClick={() => setEditing(true)}>
              <span>Modifier mon profil</span>
              <span className="menu-item-arrow">›</span>
            </button>

            <button
              className="menu-item"
              onClick={() => {
                onClose();
                onHistory();
              }}
            >
              <span>Historique des courses</span>
              <span className="menu-item-arrow">›</span>
            </button>

            <a className="menu-item" href="tel:+23566000000">
              <span>Aide et assistance</span>
              <span className="menu-item-arrow">›</span>
            </a>

            <button className="btn ghost" style={{ width: '100%', marginTop: 14, color: 'var(--danger)' }} onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </button>
          </>
        ) : (
          <>
            <div className="edit-profile-head">
              <button className="menu-item-arrow edit-profile-back" onClick={() => setEditing(false)} aria-label="Retour">
                ‹
              </button>
              <h3 style={{ margin: 0 }}>Modifier mon profil</h3>
            </div>

            <div className="avatar-edit-row">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden-file-input"
                onChange={handleAvatarChange}
              />
              <button
                className="account-avatar account-avatar-lg account-avatar-btn"
                style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                aria-label="Changer la photo de profil"
              >
                {!avatarUrl && initial}
                <span className="avatar-edit-badge">📷</span>
                {avatarUploading && <span className="avatar-uploading-overlay" />}
              </button>
              <div className="field-hint">Touchez la photo pour la changer</div>
            </div>
            {avatarError && <div className="auth-error">{avatarError}</div>}

            <div className="field">
              <label>NOM COMPLET</label>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Votre nom complet" />
            </div>
            <div className="field">
              <label>TÉLÉPHONE</label>
              <input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="+235 66 00 00 00" />
            </div>
            <div className="field">
              <label>EMAIL</label>
              <input value={session.user.email ?? ''} disabled />
            </div>

            {saveError && <div className="auth-error">{saveError}</div>}
            {saved && <div className="field-hint" style={{ color: 'var(--copper-light)', fontWeight: 700 }}>✓ Profil mis à jour</div>}

            <button className="btn amber" style={{ marginTop: 6 }} onClick={handleSaveProfile} disabled={saving}>
              {saving ? 'ENREGISTREMENT…' : 'ENREGISTRER'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
