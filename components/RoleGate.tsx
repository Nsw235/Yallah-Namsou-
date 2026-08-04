'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { getMyRole } from '@/lib/access';
import AuthGate from '@/components/AuthGate';

type Role = 'passenger' | 'driver' | 'admin';

// Espace correspondant à chaque rôle, pour la redirection automatique.
const SPACE_BY_ROLE: Record<Role, string> = {
  passenger: '/client',
  driver: '/chauffeur',
  admin: '/admin',
};

/**
 * Vérifie le rôle du compte connecté pour n'afficher que le bon espace
 * (chauffeur/client/admin). Auparavant, un rôle qui ne correspondait pas à
 * `allow` affichait un écran "Accès refusé" demandant à l'utilisateur de se
 * déconnecter — déroutant pour un chauffeur ou un admin qui se connecte
 * simplement sur la mauvaise URL (ex: lien /client partagé par erreur).
 * Désormais, on redirige automatiquement vers l'espace correspondant à son
 * rôle réel, sans jamais le forcer à se déconnecter : la plateforme reconnaît
 * seule s'il s'agit d'un chauffeur ou d'un administrateur.
 */
export default function RoleGate({ allow, children }: { allow: Role; children: React.ReactNode }) {
  const router = useRouter();
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

  // Rôle connu mais différent de l'espace demandé : redirection silencieuse
  // vers son propre espace, sans passer par un écran d'erreur.
  useEffect(() => {
    if (!error && role && role !== allow) {
      router.replace(SPACE_BY_ROLE[role]);
    }
  }, [error, role, allow, router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  const spinner = (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0b0d' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(176,141,87,0.3)', borderTopColor: '#a97a5b', animation: 'spin 0.9s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (session === undefined || (session && role === undefined)) {
    return spinner;
  }

  if (!session) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0a0b0d' }}>
        <AuthGate onAuthed={() => {}} />
      </div>
    );
  }

  // Rôle différent mais reconnu : la redirection vers le bon espace vient
  // d'être déclenchée ci-dessus. On affiche le spinner le temps qu'elle
  // s'exécute plutôt qu'un écran d'erreur.
  if (!error && role && role !== allow) {
    return spinner;
  }

  // Seul cas encore bloquant : le compte n'a pas de rôle reconnu du tout
  // (profil manquant/corrompu) — ici la redirection automatique est
  // impossible puisqu'on ne sait pas vers quel espace envoyer l'utilisateur.
  if (error || !role) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: '#0a0b0d', color: '#f2f3f5' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Compte non reconnu</p>
          <p style={{ fontSize: 13, color: '#9aa0aa', marginBottom: 14 }}>
            {error ?? "Ce compte n'a pas de rôle valide. Contactez le support."}
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
