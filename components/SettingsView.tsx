'use client';

import { useState, ReactNode } from 'react';
import { Bell, Map, UserCog, LifeBuoy, ChevronRight } from 'lucide-react';

export default function SettingsView() {
  const [heatmapDefault, setHeatmapDefault] = useState(true);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="sv-card px-2 py-2">
        <h2 className="px-2 pb-1 pt-1.5 text-sm font-extrabold sv-title">Paramètres &amp; Contrôles</h2>

        <SettingsRow
          icon={<Bell size={18} />}
          title="Alertes & Notifications"
          subtitle="Gérer les seuils d'alerte (immobile / batterie)"
          action={<ChevronRight size={16} className="text-gray-500" />}
        />

        <SettingsRow
          icon={<Map size={18} />}
          title="Gestion de la Carte"
          subtitle="Activer la Heatmap par défaut"
          action={
            <Toggle checked={heatmapDefault} onChange={setHeatmapDefault} />
          }
        />

        <SettingsRow
          icon={<UserCog size={18} />}
          title="Profil & Sécurité"
          subtitle="Changer mot de passe / Logs d'accès"
          action={<ChevronRight size={16} className="text-gray-500" />}
        />

        <SettingsRow
          icon={<LifeBuoy size={18} />}
          title="Soutien Technique"
          subtitle="Contacter le support direct"
          action={<ChevronRight size={16} className="text-gray-500" />}
          last
        />
      </div>
    </div>
  );
}

function SettingsRow({
  icon,
  title,
  subtitle,
  action,
  last = false,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action: ReactNode;
  last?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 px-2 py-3 text-left ${
        !last ? 'border-b border-white/5' : ''
      }`}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-black/40 text-copper-light">
        {icon}
      </span>
      <span className="flex-1">
        <div className="text-sm font-bold text-white">{title}</div>
        <div className="text-[11px] text-gray-400">{subtitle}</div>
      </span>
      {action}
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors ${
        checked ? 'bg-copper' : 'bg-white/15'
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
