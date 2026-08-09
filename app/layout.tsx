import type { Metadata, Viewport } from 'next';
import './globals.css';
import './tailwind.css';
import ViewportHeightFix from '@/components/ViewportHeightFix';

export const metadata: Metadata = {
  title: 'Yalla Nimshi — Service de transport d’exception, N’Djamena',
  description: 'L’élégance accessible à tous. Application de réservation VTC haut de gamme à N’Djamena.',
  icons: {
    icon: '/logo.png',
  },
  // Empêche Safari iOS de détecter automatiquement adresses/téléphones dans
  // le texte et de les transformer en liens soulignés cliquables — casse
  // sinon la mise en forme des cartes de course (adresses, numéros de prix).
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0b0d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" />
      </head>
      <body>
        <ViewportHeightFix />
        {children}
      </body>
    </html>
  );
}
