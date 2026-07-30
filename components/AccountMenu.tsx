'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

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
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setFullName(data?.full_name ?? null);
        setPhone(data?.phone ?? null);
      });
  }, [session.user.id]);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    // Pas besoin de setSigningOut(false) / onClose() : onAuthStateChange
    // fait revenir sur AuthGate et démonte ce composant.
  }

  const initial = (fullName ?? session.user.email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="account-head">
          <div className="account-avatar">{initial}</div>
          <div>
            <div className="account-name">{fullName ?? 'Mon compte'}</div>
            <div className="account-sub">{phone ?? session.user.email}</div>
          </div>
        </div>

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
      </div>
    </div>
  );
}
