'use client';

import { useState } from 'react';
import { Flame, Maximize2, LocateFixed, Crosshair, SlidersHorizontal } from 'lucide-react';
import RealMap from '@/components/RealMap';
import { MOCK_FLEET, STATUS_META } from './mockData';

const STATUS_EMOJI: Record<string, string> = {
  en_course: '🟢',
  en_attente: '🟠',
  indisponible: '🔴',
};

export default function MapView() {
  const [heatmapOn, setHeatmapOn] = useState(true);
  const [mapKey, setMapKey] = useState(0); // force re-center by remounting the map

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const pins = MOCK_FLEET.map((v) => ({
    position: { lat: v.lat, lng: v.lng },
    emoji: STATUS_EMOJI[v.status],
  }));

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* Header compact */}
      <div className="sv-card px-4 py-3">
        <h1 className="text-lg font-extrabold sv-title">Yallah Namsou • Supervision Totale</h1>
        <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            Dashboard Multi-Vue (France • {dateStr} {timeStr})
          </span>
          <button className="flex items-center gap-1 font-semibold text-copper-light">
            <SlidersHorizontal size={13} /> Filtrer/Trier
          </button>
        </div>
      </div>

      {/* Carte GPS */}
      <div className="relative flex-1 min-h-[380px] overflow-hidden rounded-2xl border border-border">
        <RealMap key={mapKey} pitch={55} buildings3d pins={pins} />

        {heatmapOn && (
          <div className="sv-pill absolute left-3 top-3 z-10 max-w-[70%] rounded-full px-3 py-1.5 text-[11px] font-bold text-amber-300">
            <span className="flex items-center gap-1.5">
              <Flame size={13} /> Heatmap de demande — zones actives
            </span>
          </div>
        )}

        {/* Contrôles flottants */}
        <div className="absolute bottom-3 left-3 z-10 flex gap-2">
          <button
            className="sv-pill flex h-11 w-11 items-center justify-center rounded-full text-white"
            aria-label="Plein écran"
          >
            <Maximize2 size={17} />
          </button>
        </div>
        <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
          <button
            className="sv-pill flex h-11 w-11 items-center justify-center rounded-full text-copper-light"
            aria-label="Géolocaliser"
          >
            <LocateFixed size={18} />
          </button>
          <button
            onClick={() => setMapKey((k) => k + 1)}
            className="sv-btn-copper flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-extrabold shadow-copper"
          >
            <Crosshair size={14} /> Recenter
          </button>
        </div>
      </div>

      {/* Légende statuts */}
      <div className="sv-card flex justify-around px-3 py-2 text-[11px] font-semibold">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {meta.label}
          </span>
        ))}
      </div>
    </div>
  );
}
