'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { formatFCFA } from '@/lib/pricing';
import { getPricingRules, updatePricingRule } from '@/lib/admin';
import { useToast } from '@/components/Toast';

type PricingRow = { id: string; vehicle_type: string; base_fare: number; price_per_km: number; peak_multiplier: number };

const TYPE_LABEL: Record<string, string> = { berline: 'Berline', van: 'Van', suv: 'SUV' };

export default function AdminSettingsView({ session }: { session: Session }) {
  const pushToast = useToast();
  const [rules, setRules] = useState<PricingRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { base_fare: string; price_per_km: string; peak_multiplier: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);

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

  function openEditor() {
    setErr(null);
    setActiveTab(rules[0]?.id ?? null);
    setEditing(true);
  }

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
      pushToast(`Tarif ${TYPE_LABEL[rules.find((r) => r.id === id)?.vehicle_type ?? ''] ?? ''} mis à jour`);
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
      pushToast('Mot de passe changé');
      setTimeout(() => setPwdOk(false), 3000);
    } catch (e: any) {
      setPwdErr(e?.message ?? 'Échec du changement de mot de passe.');
    } finally {
      setSavingPwd(false);
    }
  }

  const activeRule = rules.find((r) => r.id === activeTab);
  const activeDraft = activeTab ? drafts[activeTab] : undefined;

  return (
    <div className="admin-list-view">
      <div className="driver-card">
        <div className="section-head-row">
          <div>
            <h2>Grille tarifaire ({rules.length} type{rules.length !== 1 ? 's' : ''} de véhicule{rules.length !== 1 ? 's' : ''})</h2>
            <p className="route-sub">Tarifs appliqués en temps réel à chaque nouvelle estimation de course.</p>
          </div>
          <button className="btn amber btn-inline" onClick={openEditor} disabled={loading || rules.length === 0}>
            Modifier les tarifs
          </button>
        </div>

        {err && <div className="auth-error">{err}</div>}

        {loading ? (
          <div className="spinner" />
        ) : (
          <div className="fleet-table pricing-overview-table">
            <div className="fleet-table-head pricing-head">
              <span>Véhicule</span>
              <span>Prise en charge</span>
              <span>Prix / km</span>
              <span>Heure de pointe</span>
              <span>Exemple 10 km</span>
            </div>
            {rules.map((r) => (
              <div key={r.id} className="fleet-table-row pricing-head" onClick={openEditor}>
                <b className="driver-name">{TYPE_LABEL[r.vehicle_type] ?? r.vehicle_type}</b>
                <span>{formatFCFA(r.base_fare)}</span>
                <span>{formatFCFA(r.price_per_km)}</span>
                <span>×{r.peak_multiplier}</span>
                <span className="route-sub">{formatFCFA(Number(r.base_fare) + Number(r.price_per_km) * 10)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="driver-card">
        <h2>Mon compte administrateur</h2>
        <div className="field">
          <label>EMAIL</label>
          <input value={session.user.email ?? ''} disabled />
        </div>
        <div className="field-grid-2">
          <div className="field">
            <label>NOUVEAU MOT DE PASSE</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="8 caractères minimum" />
          </div>
          <div className="field">
            <label>CONFIRMER</label>
            <input type="password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} />
          </div>
        </div>
        {pwdErr && <div className="auth-error">{pwdErr}</div>}
        {pwdOk && <div className="field-hint" style={{ color: 'var(--copper-light)', fontWeight: 700 }}>✓ Mot de passe changé</div>}
        <button className="btn amber" disabled={savingPwd} onClick={changeMyPassword}>
          {savingPwd ? 'Changement…' : 'Changer mon mot de passe'}
        </button>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <div className="modal driver-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Modifier les tarifs</h3>

            <div className="admin-tabs">
              {rules.map((r) => (
                <button
                  key={r.id}
                  className={`admin-tab ${activeTab === r.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(r.id)}
                >
                  {TYPE_LABEL[r.vehicle_type] ?? r.vehicle_type}
                </button>
              ))}
            </div>

            {err && <div className="auth-error">{err}</div>}

            {activeRule && activeDraft && (
              <div className="pricing-row" key={activeRule.id}>
                <div className="pricing-row-head">
                  <span className="route-sub">
                    Exemple 10km : {formatFCFA(Number(activeDraft.base_fare) + Number(activeDraft.price_per_km) * 10)}
                  </span>
                </div>
                <div className="pricing-fields">
                  <div className="field">
                    <label>PRISE EN CHARGE (FCFA)</label>
                    <input
                      type="number"
                      value={activeDraft.base_fare}
                      onChange={(e) => setDrafts({ ...drafts, [activeRule.id]: { ...activeDraft, base_fare: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>PRIX / KM (FCFA)</label>
                    <input
                      type="number"
                      value={activeDraft.price_per_km}
                      onChange={(e) => setDrafts({ ...drafts, [activeRule.id]: { ...activeDraft, price_per_km: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>MULTIPLICATEUR HEURE DE POINTE</label>
                    <input
                      type="number"
                      step="0.1"
                      value={activeDraft.peak_multiplier}
                      onChange={(e) => setDrafts({ ...drafts, [activeRule.id]: { ...activeDraft, peak_multiplier: e.target.value } })}
                    />
                  </div>
                </div>
                <button className="btn amber" disabled={savingId === activeRule.id} onClick={() => saveRule(activeRule.id)}>
                  {savingId === activeRule.id ? 'Enregistrement…' : savedId === activeRule.id ? '✓ Enregistré' : 'Enregistrer ce tarif'}
                </button>
              </div>
            )}

            <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setEditing(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
