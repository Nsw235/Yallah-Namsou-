'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import AuthGate from '@/components/AuthGate';

const ROUTE_BY_ROLE: Record<string, string> = {
  admin: '/admin',
  driver: '/chauffeur',
  passenger: '/client',
};

/**
 * Page racine "intelligente" : plus d'écran de choix d'espace.
 * On identifie le rôle du compte connecté (profiles.role) et on redirige
 * automatiquement vers /admin, /chauffeur ou /client. Chaque espace garde
 * en plus son propre contrôle de rôle (défense en profondeur) : un chauffeur
 * qui irait taper /admin directement resterait bloqué sur "Accès refusé".
 */
export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    setRedirecting(true);
    supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data?.role) {
          setError("Impossible de déterminer votre espace. Contactez l'administrateur.");
          setRedirecting(false);
          return;
        }
        const dest = ROUTE_BY_ROLE[data.role] ?? '/client';
        router.replace(dest);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, router]);

  // Session en cours de résolution, ou redirection en cours : écran de chargement discret.
  if (session === undefined || redirecting) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          background: '#0a0b0d',
        }}
      >
        <img src="/logo.png" alt="Yalla Nimshi" style={{ width: 84, height: 'auto', opacity: 0.9 }} />
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '2px solid rgba(176,141,87,0.3)',
            borderTopColor: '#a97a5b',
            animation: 'spin 0.9s linear infinite',
          }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // Pas connecté : un seul écran de connexion pour tout le monde. Le rôle
  // (passager / chauffeur / admin) est déterminé après connexion à partir du
  // compte — un chauffeur ou un admin se connecte avec les identifiants qui
  // lui ont été fournis, la création de compte libre ne crée que des comptes
  // passager (voir AuthGate / trigger `handle_new_user`).
  if (!session) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0a0b0d' }}>
        <AuthGate onAuthed={() => {}} />
      </div>
    );
  }

  // Connecté mais le rôle n'a pas pu être résolu (profil manquant, etc.).
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
        background: '#0a0b0d',
        color: '#f2f3f5',
      }}
    >
      <div>
        <p style={{ fontSize: 14, color: '#ffb3b3', marginBottom: 14 }}>{error}</p>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.reload();
          }}
          style={{
            padding: '10px 20px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(180deg,#e8c9a8,#a97a5b)',
            color: '#241a13',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
