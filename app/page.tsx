import Link from 'next/link';

const SPACES = [
  {
    href: '/client',
    title: 'Passager',
    description: 'Réservez votre course : sélection du véhicule, adresses et suivi en temps réel.',
  },
  {
    href: '/chauffeur',
    title: 'Chauffeur',
    description: 'Acceptez des courses, naviguez et suivez vos gains.',
  },
  {
    href: '/admin',
    title: 'Administration',
    description: 'Supervisez la flotte, les chauffeurs et les statistiques.',
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
        gap: 24,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <img src="/logo.png" alt="Yalla Nimshi" style={{ width: 120, height: 'auto' }} />
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Choisissez votre espace</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
        {SPACES.map((space) => (
          <Link
            key={space.href}
            href={space.href}
            style={{
              display: 'block',
              padding: '16px 18px',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.12)',
              textAlign: 'left',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>{space.title}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>{space.description}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
