'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { getMyRole } from '@/lib/access';
import AuthGate from '@/components/AuthGate';

type Role = 'passenger' | 'driver' | 'admin';

/**
 * Bloque l'accès à un espace (chauffeur/client/admin) si le rôle du compte
 * connecté ne correspond pas à `allow`. Sans ce composant, /chauffeur et
 * /client rendaient leur tableau de bord à N'IMPORTE QUEL compte connecté,
 * quel que soit son rôle réel — seul /admin avait ce contrôle.
 */
export default function RoleGate({ allow, children }: { allow: Role; children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    getMyRole(session.user.id)
      .then((r) => setRole(r as Role | null))
      .catch((e) => setError(e?.message ?? 'Erreur.'));
  }, [session?.user?.id]);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  if (session === undefined || (session && role === undefined)) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0b0d' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(176,141,87,0.3)', borderTopColor: '#a97a5b', animation: 'spin 0.9s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0a0b0d' }}>
        <AuthGate onAuthed={() => {}} />
      </div>
    );
  }

  if (error || role !== allow) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: '#0a0b0d', color: '#f2f3f5' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Accès refusé</p>
          <p style={{ fontSize: 13, color: '#9aa0aa', marginBottom: 14 }}>
            {error ?? `Ce compte n'a pas le rôle "${allow}" (rôle actuel : ${role ?? 'inconnu'}).`}
          </p>
          <button
            onClick={handleLogout}
            style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: 'linear-gradient(180deg,#e8c9a8,#a97a5b)', color: '#241a13', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
          >
            Déconnexion
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
