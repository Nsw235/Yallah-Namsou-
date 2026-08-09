'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatFCFA } from '@/lib/pricing';
import { DailyPoint, DriverDetail, PaymentBreakdown, getAnalyticsSeries, getPaymentBreakdown } from '@/lib/admin';

const PAYMENT_LABEL: Record<string, string> = { cash: 'Espèces', airtel_money: 'Airtel Money', moov_money: 'Moov Money' };
const PAYMENT_COLOR: Record<string, string> = { cash: 'var(--copper)', airtel_money: '#ff4d4d', moov_money: '#ff9d1f' };

export default function AdminAnalyticsView({ drivers }: { drivers: DriverDetail[] }) {
  const [series, setSeries] = useState<DailyPoint[]>([]);
  const [payments, setPayments] = useState<PaymentBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<7 | 14 | 30>(14);

  useEffect(() => {
    setLoading(true);
    Promise.all([getAnalyticsSeries(range), getPaymentBreakdown()])
      .then(([s, p]) => {
        setSeries(s);
        setPayments(p);
      })
      .finally(() => setLoading(false));
  }, [range]);

  const totals = useMemo(() => {
    const revenue = series.reduce((s, d) => s + d.revenue, 0);
    const trips = series.reduce((s, d) => s + d.trips, 0);
    const cancelled = series.reduce((s, d) => s + d.cancelled, 0);
    return { revenue, trips, cancelled, cancelRate: trips > 0 ? Math.round((cancelled / trips) * 1000) / 10 : 0 };
  }, [series]);

  const maxRevenue = Math.max(...series.map((d) => d.revenue), 1);
  const totalPayments = payments.reduce((s, p) => s + p.total, 0) || 1;

  const topDrivers = useMemo(
    () => [...drivers].sort((a, b) => b.revenue_total - a.revenue_total).slice(0, 5),
    [drivers]
  );

  return (
    <div>
      <div className="adm2-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 'none' }}>
        <p className="adm2-section-title">Analyses</p>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 14, 30].map((r) => (
            <button key={r} className={`adm2-chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r as 7 | 14 | 30)} style={{ border: range === r ? 'none' : '0.5px solid #241f18' }}>
              {r}j
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="adm2-empty">Chargement…</div>
      ) : (
        <>
          <div className="adm2-hero">
            <div className="adm2-hero-top">
              <div>
                <p className="adm2-hero-label">REVENUS · {range} JOURS</p>
                <p className="adm2-hero-value">
                  {formatFCFA(totals.revenue).replace(' FCFA', '')} <span className="unit">FCFA</span>
                </p>
              </div>
            </div>
            <svg viewBox="0 0 280 40" style={{ width: '100%', height: 34, marginTop: 6, display: 'block' }}>
              <polyline
                points={series.map((d, i) => `${(i / Math.max(series.length - 1, 1)) * 280},${40 - (d.revenue / maxRevenue) * 36 - 2}`).join(' ')}
                fill="none"
                stroke="#3f7a54"
                strokeWidth="1.5"
              />
            </svg>
          </div>

          <div className="adm2-kpi-grid">
            <div className="adm2-kpi-cell">
              <p className="adm2-kpi-cell-label">COURSES · {range}J</p>
              <div className="adm2-kpi-cell-value">
                <span className="n">{totals.trips}</span>
                <span className="t" style={{ color: '#736a5a' }}>{(totals.trips / range).toFixed(1)}/j</span>
              </div>
            </div>
            <div className="adm2-kpi-cell">
              <p className="adm2-kpi-cell-label">ANNULATION</p>
              <div className="adm2-kpi-cell-value">
                <span className="n">{totals.cancelRate}%</span>
                <span className="t adm2-trend-down">{totals.cancelled} annulée{totals.cancelled > 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>

          <div className="adm2-row-header">
            <p className="adm2-section-title" style={{ fontSize: 11 }}>Paiements</p>
          </div>
          {payments.length === 0 ? (
            <div className="adm2-empty">Aucun paiement confirmé pour le moment.</div>
          ) : (
            <div className="adm2-list" style={{ paddingBottom: 10 }}>
              {payments.map((p) => (
                <div key={p.method} style={{ padding: '7px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: '#ece6d9' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: PAYMENT_COLOR[p.method] ?? 'var(--copper)' }} />
                      {PAYMENT_LABEL[p.method] ?? p.method}
                    </span>
                    <span style={{ fontSize: 9.5, color: '#736a5a', fontFamily: 'var(--font-mono)' }}>
                      {formatFCFA(p.total)} · {p.count}
                    </span>
                  </div>
                  <div style={{ marginTop: 5, height: 3, borderRadius: 2, background: '#1a1712', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(p.total / totalPayments) * 100}%`, background: PAYMENT_COLOR[p.method] ?? 'var(--copper)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="adm2-row-header">
            <p className="adm2-section-title" style={{ fontSize: 11 }}>Top 5 chauffeurs</p>
          </div>
          {topDrivers.length === 0 ? (
            <div className="adm2-empty">Aucune donnée disponible.</div>
          ) : (
            <div className="adm2-list" style={{ paddingBottom: 12 }}>
              {topDrivers.map((d, i) => (
                <div key={d.id} className="adm2-row" style={{ cursor: 'default' }}>
                  <div className={`adm2-avatar ${i > 0 ? 'off' : ''}`}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="adm2-row-title">{d.full_name ?? 'Chauffeur'}</p>
                    <p className="adm2-row-sub">{d.completed_trips} course{d.completed_trips > 1 ? 's' : ''} · {Number(d.rating_avg).toFixed(1)}★</p>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: '#8fbfa0', fontFamily: 'var(--font-mono)' }}>
                    {formatFCFA(d.revenue_total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
