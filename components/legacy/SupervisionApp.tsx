'use client';

import { useState } from 'react';
import BottomNav, { SupervisionTab } from './BottomNav';
import MapView from './MapView';
import FleetView from './FleetView';
import StatsView from './StatsView';
import SettingsView from './SettingsView';

export default function SupervisionApp() {
  const [tab, setTab] = useState<SupervisionTab>('carte');

  return (
    <div className="supervision-root flex flex-col">
      <div className="flex-1 overflow-hidden">
        {tab === 'carte' && <MapView />}
        {tab === 'flotte' && <FleetView onLocate={() => setTab('carte')} />}
        {tab === 'stats' && <StatsView />}
        {tab === 'parametres' && <SettingsView />}
      </div>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
