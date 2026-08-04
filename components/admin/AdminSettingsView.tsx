'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { formatFCFA } from '@/lib/pricing';
import { getPricingRules, updatePricingRule } from '@/lib/admin';

type PricingRow = { id: string; vehicle_type: string; base_fare: number; price_per_km: number; peak_multiplier: number };

const TYPE_LABEL: Record<string, string> = { berline: 'Berline', van: 'Van', suv: 'SUV' };

export default function AdminSettingsView({ session }: { session: Session }) {
  const [rules, setRules] = useState<PricingRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { base_fare: string; price_per_km: string; peak_multiplier: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdOk, setPwdOk] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getPricingRules()
      .then((data: any) => {
        setRules(data);
        const d: typeof drafts = {};
        data.forEach((r: PricingRow) => {
          d[r.id] = {
            base_fare: String(r.base_fare),
            price_per_km: String(r.price_per_km),
            peak_multiplier: String(r.peak_multiplier),
          };
        });
        setDrafts(d);
      })
      .catch((e) => setErr(e?.message ?? 'Erreur de chargement des tarifs.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function saveRule(id: string) {
    const d = drafts[id];
    if (!d) return;
    setSavingId(id);
    setErr(null);
    try {
      await updatePricingRule(id, {
        base_fare: Number(d.base_fare),
        price_per_km: Number(d.price_per_km),
        peak_multiplier: Number(d.peak_multiplier),
      });
      setSavedId(id);
      setTimeout(() => setSavedId(null), 2000);
      load();
    } catch (e: any) {
      setErr(e?.message ?? 'Échec de la mise à jour du tarif.');
    } finally {
      setSavingId(null);
    }
  }

  async function changeMyPassword() {
    setPwdErr(null);
    if (newPassword.length < 8) {
      setPwdErr('8 caractères minimum.');
      return;
    }
    if (newPassword !== newPassword2) {
      setPwdErr('Les mots de passe ne correspondent pas.');
      return;
    }
    setSavingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setNewPassword2('');
      setPwdOk(true);
      setTimeout(() => setPwdOk(false), 3000);
    } catch (e: any) {
      setPwdErr(e?.message ?? 'Échec du changement de mot de passe.');
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <div className="admin-list-view">
      <div className="driver-card">
        <h2>Grille tarifaire</h2>
        <p className="route-sub" style={{ marginBottom: 14 }}>
          Tarifs appliqués en temps réel à chaque nouvelle estimation de course.
        </p>
        {err && <div className="auth-error">{err}</div>}
        {loading ? (
          <div className="spinner" />
        ) : (
          rules.map((r) => {
            const d = drafts[r.id];
            if (!d) return null;
            return (
              <div key={r.id} className="pricing-row">
                <div className="pricing-row-head">
                  <b>{TYPE_LABEL[r.vehicle_type] ?? r.vehicle_type}</b>
                  <span className="route-sub">
                    Exemple 10km : {formatFCFA(Number(d.base_fare) + Number(d.price_per_km) * 10)}
                  </span>
                </div>
                <div className="pricing-fields">
                  <div className="field">
                    <label>PRISE EN CHARGE (FCFA)</label>
                    <input
                      type="number"
                      value={d.base_fare}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: { ...d, base_fare: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>PRIX / KM (FCFA)</label>
                    <input
                      type="number"
                      value={d.price_per_km}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: { ...d, price_per_km: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>MULTIPLICATEUR HEURE DE POINTE</label>
                    <input
                      type="number"
                      step="0.1"
                      value={d.peak_multiplier}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: { ...d, peak_multiplier: e.target.value } })}
                    />
                  </div>
                </div>
                <button className="btn amber" disabled={savingId === r.id} onClick={() => saveRule(r.id)}>
                  {savingId === r.id ? 'Enregistrement…' : savedId === r.id ? '✓ Enregistré' : 'Enregistrer ce tarif'}
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="driver-card">
        <h2>Mon compte administrateur</h2>
        <div className="field">
          <label>EMAIL</label>
          <input value={session.user.email ?? ''} disabled />
        </div>
        <div className="field">
          <label>NOUVEAU MOT DE PASSE</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="8 caractères minimum" />
        </div>
        <div className="field">
          <label>CONFIRMER</label>
          <input type="password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} />
        </div>
        {pwdErr && <div className="auth-error">{pwdErr}</div>}
        {pwdOk && <div className="field-hint" style={{ color: 'var(--copper-light)', fontWeight: 700 }}>✓ Mot de passe changé</div>}
        <button className="btn amber" disabled={savingPwd} onClick={changeMyPassword}>
          {savingPwd ? 'Changement…' : 'Changer mon mot de passe'}
        </button>
      </div>
    </div>
  );
}
