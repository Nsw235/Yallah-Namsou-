'use client';

import { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { MOCK_STATS } from './mockData';

const PERIODS = ["Aujourd'hui", '7 jours', 'Mois'];

export default function StatsView() {
  const [period, setPeriod] = useState(PERIODS[0]);
  const maxVal = Math.max(...MOCK_STATS.byType.map((b) => b.value), 1);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="sv-card px-4 py-3.5">
        <h2 className="text-sm font-extrabold sv-title">Section Stats &amp; Analytics</h2>
        <p className="mt-0.5 text-[11px] text-gray-400">Aujourd&apos;hui (31/07)</p>

        <div className="mt-3 grid grid-cols-3 divide-x divide-white/10 text-center">
          <Kpi label="Total Courses" value={String(MOCK_STATS.totalCourses)} />
          <Kpi label="Revenus" value={`${MOCK_STATS.revenue}€`} />
          <Kpi label="Courses/Heure" value={String(MOCK_STATS.coursesPerHour)} />
        </div>
      </div>

      <div className="sv-card px-4 py-3.5">
        <h3 className="text-sm font-extrabold sv-title">Courses par Type</h3>
        <p className="mt-0.5 text-[11px] text-gray-400">Derniers 7 jours</p>

        <div className="mt-4 flex h-32 items-end justify-between gap-2">
          {MOCK_STATS.byType.map((b, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="w-full rounded-t-md bg-gradient-to-b from-copper-light to-copper shadow-copper"
                style={{ height: `${Math.max(6, (b.value / maxVal) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-500">
          <span>0</span>
          <span>{maxVal}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="sv-pill relative flex-1 rounded-xl px-3 py-2.5 text-xs font-bold text-gray-200">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full appearance-none bg-transparent pr-5 outline-none"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p} className="bg-black">
                {p}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
        </div>
        <button className="sv-btn-copper flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-extrabold shadow-copper">
          <Download size={14} /> Exporter CSV/PDF
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1">
      <div className="text-[10px] font-semibold text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-white">{value}</div>
    </div>
  );
}
