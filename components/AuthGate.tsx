'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthGate({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signUpError) throw signUpError;
        // Le trigger `handle_new_user` crée automatiquement la ligne `profiles`
        // (role: passenger) à partir de raw_user_meta_data.full_name.
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
      <div className="auth-title">Yalla Nimshi</div>
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
        <button className="btn cyan" type="submit" disabled={loading}>
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
    </div>
  );
}
