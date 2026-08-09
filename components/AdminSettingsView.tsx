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
    <div>
      <div className="adm2-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="adm2-section-title">Tarification</p>
        <button className="adm2-btn-primary" onClick={openEditor} disabled={loading || rules.length === 0}>
          Modifier
        </button>
      </div>

      {err && <div className="auth-error" style={{ margin: '10px 14px 0' }}>{err}</div>}

      {loading ? (
        <div className="adm2-empty">Chargement…</div>
      ) : (
        <div className="adm2-list" style={{ marginTop: 6 }}>
          {rules.map((r) => (
            <button key={r.id} className="adm2-row" onClick={openEditor}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="adm2-row-title">{TYPE_LABEL[r.vehicle_type] ?? r.vehicle_type}</p>
                <p className="adm2-row-sub">Prise en charge {formatFCFA(r.base_fare)} · pointe ×{r.peak_multiplier}</p>
              </div>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#8a8171' }}>
                {formatFCFA(r.price_per_km)}/km
              </span>
              <span className="adm2-row-chevron">›</span>
            </button>
          ))}
        </div>
      )}

      <div className="adm2-row-header" style={{ borderTop: '0.5px solid #1a1712' }}>
        <p className="adm2-section-title" style={{ fontSize: 11 }}>Compte administrateur</p>
      </div>
      <div className="adm2-list" style={{ paddingBottom: 12 }}>
        <div className="adm2-toggle-row">
          <i className="ti ti-mail" style={{ fontSize: 14, color: '#8a8171' }} aria-hidden="true" />
          <span style={{ fontSize: 10.5, color: '#736a5a', flex: 1 }}>{session.user.email ?? ''}</span>
        </div>
      </div>
      <div style={{ padding: '0 14px 14px' }}>
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
        <button className="btn amber" disabled={savingPwd} onClick={changeMyPassword} style={{ marginTop: 8 }}>
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
