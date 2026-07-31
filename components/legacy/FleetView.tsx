'use client';

import { Plus, Car, MapPin, User } from 'lucide-react';
import { MOCK_FLEET, STATUS_META } from './mockData';

export default function FleetView({ onLocate }: { onLocate?: (vehicleId: string) => void }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <button className="sv-btn-copper flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-extrabold shadow-copper">
        <Plus size={16} /> AJOUTER NOUVEAU VÉHICULE
      </button>

      {MOCK_FLEET.map((v) => {
        const meta = STATUS_META[v.status];
        return (
          <div key={v.id} className="sv-card flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-border bg-black/40 text-copper-light">
                <Car size={20} />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-gray-400">Vehicle ID: {v.code}</div>
                <div className="text-base font-extrabold text-white">{v.label}</div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                  <User size={11} /> Chauffeur : {v.driverName}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <div className="text-[10px] font-semibold text-gray-500">STATUS</div>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${meta.text}`}>
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {meta.label}
                </div>
              </div>
              <button
                onClick={() => onLocate?.(v.id)}
                className="sv-btn-copper flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-extrabold"
              >
                <MapPin size={12} /> LOCALISER
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
