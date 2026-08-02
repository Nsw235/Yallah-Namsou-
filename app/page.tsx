import Link from 'next/link';
import { User, Car, ShieldCheck, ChevronRight } from 'lucide-react';

const SPACES = [
  {
    href: '/client',
    title: 'Passager',
    description: 'Réservez votre course : sélection du véhicule, adresses et suivi en temps réel.',
    icon: User,
  },
  {
    href: '/chauffeur',
    title: 'Chauffeur',
    description: 'Acceptez des courses, naviguez et suivez vos gains.',
    icon: Car,
  },
  {
    href: '/admin',
    title: 'Administration',
    description: 'Supervisez la flotte, les chauffeurs et les statistiques.',
    icon: ShieldCheck,
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: 24,
        textAlign: 'center',
        background:
          'radial-gradient(ellipse at 50% 0%, rgba(169,122,91,0.16), transparent 55%), radial-gradient(ellipse at 50% 100%, rgba(107,74,53,0.14), transparent 60%), #0a0b0d',
      }}
    >
      <img
        src="/logo.png"
        alt="Yallah Namsou"
        style={{ width: 110, height: 'auto', filter: 'drop-shadow(0 4px 14px rgba(169,122,91,0.35))' }}
      />
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f2f3f5', margin: 0 }}>Choisissez votre espace</h1>
        <p style={{ fontSize: 13, color: '#9aa0aa', marginTop: 6 }}>Yallah Namsou — N&apos;Djamena</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 380 }}>
        {SPACES.map((space) => {
          const Icon = space.icon;
          return (
            <Link
              key={space.href}
              href={space.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '16px 18px',
                borderRadius: 18,
                border: '1px solid rgba(176,141,87,0.28)',
                background: 'rgba(20,22,26,0.6)',
                backdropFilter: 'blur(16px)',
                textAlign: 'left',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(180deg,#e8c9a8,#a97a5b)',
                  color: '#241a13',
                }}
              >
                <Icon size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: '#f2f3f5' }}>{space.title}</div>
                <div style={{ fontSize: 12, color: '#9aa0aa', marginTop: 3, lineHeight: 1.35 }}>
                  {space.description}
                </div>
              </div>
              <ChevronRight size={18} color="#e8c9a8" style={{ flex: '0 0 auto' }} />
            </Link>
          );
        })}
      </div>
    </main>
  );
}
