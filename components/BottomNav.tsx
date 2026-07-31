'use client';

import { Car, Map, BarChart3, Settings } from 'lucide-react';

export type SupervisionTab = 'flotte' | 'carte' | 'stats' | 'parametres';

const TABS: { key: SupervisionTab; label: string; icon: typeof Car }[] = [
  { key: 'flotte', label: 'Flotte', icon: Car },
  { key: 'carte', label: 'Carte', icon: Map },
  { key: 'stats', label: 'Stats', icon: BarChart3 },
  { key: 'parametres', label: 'Paramètres', icon: Settings },
];

export default function BottomNav({
  active,
  onChange,
}: {
  active: SupervisionTab;
  onChange: (tab: SupervisionTab) => void;
}) {
  return (
    <nav className="flex flex-none items-stretch justify-around border-t border-border bg-black/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md">
      {TABS.map(({ key, label, icon: Icon }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex flex-1 flex-col items-center gap-1 py-2.5"
          >
            <Icon size={20} className={isActive ? 'text-copper-light' : 'text-gray-500'} />
            <span
              className={`text-[10.5px] font-semibold ${isActive ? 'text-copper-light' : 'text-gray-500'}`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
