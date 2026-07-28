import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Yalla Nimshi — Service de transport d\u2019exception, N\u2019Djamena',
  description: 'L\u2019élégance accessible à tous. Application de réservation VTC haut de gamme à N\u2019Djamena.',
  icons: {
    icon: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
