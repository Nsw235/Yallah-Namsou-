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
  const maxTrips = Math.max(...series.map((d) => d.trips), 1);
  const totalPayments = payments.reduce((s, p) => s + p.total, 0) || 1;

  const topDrivers = useMemo(
    () => [...drivers].sort((a, b) => b.revenue_total - a.revenue_total).slice(0, 5),
    [drivers]
  );

  return (
    <div className="admin-list-view">
      <div className="driver-card">
        <div className="analytics-head">
          <h2>Analyses détaillées</h2>
          <div className="admin-toolbar" style={{ margin: 0 }}>
            {[7, 14, 30].map((r) => (
              <button key={r} className={`btn ghost range-btn ${range === r ? 'active' : ''}`} onClick={() => setRange(r as 7 | 14 | 30)}>
                {r} jours
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="spinner" />
        ) : (
          <>
            <div className="kpi-row" style={{ marginTop: 14 }}>
              <div className="kpi-box">
                <div className="kpi-label">REVENUS ({range}j)</div>
                <div className="kpi-value up">{formatFCFA(totals.revenue)}</div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">COURSES ({range}j)</div>
                <div className="kpi-value">{totals.trips}</div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">TAUX D&apos;ANNULATION</div>
                <div className="kpi-value down">{totals.cancelRate}%</div>
              </div>
            </div>

            <h3 style={{ marginTop: 22 }}>Revenus par jour</h3>
            <div className="analytics-chart">
              {series.map((d) => (
                <div key={d.date} className="analytics-bar-col" title={`${d.date} · ${formatFCFA(d.revenue)}`}>
                  <div className="analytics-bar" style={{ height: `${Math.max(4, (d.revenue / maxRevenue) * 100)}%` }} />
                  <div className="analytics-bar-lbl">{d.date.slice(5)}</div>
                </div>
              ))}
            </div>

            <h3 style={{ marginTop: 22 }}>Courses par jour</h3>
            <div className="analytics-chart">
              {series.map((d) => (
                <div key={d.date} className="analytics-bar-col" title={`${d.date} · ${d.trips} course(s), ${d.cancelled} annulée(s)`}>
                  <div className="analytics-bar analytics-bar-cyan" style={{ height: `${Math.max(4, (d.trips / maxTrips) * 100)}%` }} />
                  <div className="analytics-bar-lbl">{d.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="driver-card">
        <h2>Répartition des paiements</h2>
        {payments.length === 0 ? (
          <p className="route-sub">Aucun paiement confirmé pour le moment.</p>
        ) : (
          <div className="payment-breakdown">
            {payments.map((p) => (
              <div key={p.method} className="payment-row">
                <div className="payment-row-top">
                  <span><span className="sw" style={{ background: PAYMENT_COLOR[p.method] ?? 'var(--copper)' }} /> {PAYMENT_LABEL[p.method] ?? p.method}</span>
                  <span>{formatFCFA(p.total)} · {p.count} paiement(s)</span>
                </div>
                <div className="payment-bar-track">
                  <div className="payment-bar-fill" style={{ width: `${(p.total / totalPayments) * 100}%`, background: PAYMENT_COLOR[p.method] ?? 'var(--copper)' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="driver-card">
        <h2>Top 5 chauffeurs (par revenus générés)</h2>
        {topDrivers.length === 0 && <p className="route-sub">Aucune donnée disponible.</p>}
        {topDrivers.map((d, i) => (
          <div key={d.id} className="driver-list-row">
            <div>
              <div className="driver-name">#{i + 1} {d.full_name ?? 'Chauffeur'}</div>
              <div className="route-sub">{d.completed_trips} course(s) · {Number(d.rating_avg).toFixed(1)} ★</div>
            </div>
            <span className="star-badge">{formatFCFA(d.revenue_total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
