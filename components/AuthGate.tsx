'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthGate({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Âge minimum requis pour réserver une course, comme chez Uber : on
  // vérifie côté client (confort immédiat) puis côté serveur (voir
  // migration 0006, la vraie barrière ne peut pas reposer sur le client).
  const MIN_AGE = 18;
  function hasMinimumAge(isoDate: string): boolean {
    const dob = new Date(isoDate);
    if (Number.isNaN(dob.getTime())) return false;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hasHadBirthdayThisYear =
      today.getMonth() > dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hasHadBirthdayThisYear) age -= 1;
    return age >= MIN_AGE;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && !hasMinimumAge(dateOfBirth)) {
      setError(`Vous devez avoir au moins ${MIN_AGE} ans pour créer un compte passager.`);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName, date_of_birth: dateOfBirth } },
        });
        if (signUpError) throw signUpError;
        // Le trigger `handle_new_user` crée automatiquement la ligne `profiles`
        // (role: passenger) à partir de raw_user_meta_data.full_name /
        // date_of_birth. Une contrainte serveur (migration 0006) rejette en
        // plus toute date de naissance de moins de 18 ans.
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
      onAuthed();
    } catch (err: any) {
      setError(err?.message ?? 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen fade">
      <img src="/logo.png" alt="Yalla Nimshi" className="auth-logo-img" />
      <img src="/tagline-banner.png" alt="Service de transport d'exception" className="auth-tagline-img" />
      <img src="/fleet-cars.png" alt="Flotte Yalla Nimshi" className="auth-fleet-img" />
      <div className="auth-sub">
        {mode === 'signin' ? 'Connectez-vous pour réserver votre course.' : 'Créez votre compte passager.'}
      </div>

      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <div className="field">
            <label>NOM COMPLET</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ex : Awa Djimet"
              required
            />
          </div>
        )}
        {mode === 'signup' && (
          <div className="field">
            <label>DATE DE NAISSANCE</label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
        )}
        <div className="field">
          <label>EMAIL</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            required
          />
        </div>
        <div className="field">
          <label>MOT DE PASSE</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={6}
            required
          />
        </div>
        <button className="btn copper" type="submit" disabled={loading}>
          {loading ? 'Veuillez patienter…' : mode === 'signin' ? 'SE CONNECTER' : "CRÉER MON COMPTE"}
        </button>
      </form>

      <div className="auth-switch">
        {mode === 'signin' ? (
          <>
            Pas encore de compte ?{' '}
            <button onClick={() => { setMode('signup'); setError(null); }}>Créer un compte</button>
          </>
        ) : (
          <>
            Déjà inscrit ?{' '}
            <button onClick={() => { setMode('signin'); setError(null); }}>Se connecter</button>
          </>
        )}
      </div>

      <div className="auth-tracking">
        <div className="auth-tracking-label">Suivi en direct</div>
        <img src="/live-tracking.png" alt="Suivi en direct de votre course" className="auth-tracking-img" />
      </div>
    </div>
  );
}
