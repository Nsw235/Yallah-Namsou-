import type { Metadata, Viewport } from 'next';
import './globals.css';
import './tailwind.css';

export const metadata: Metadata = {
  title: 'Yalla Nimshi — Service de transport d’exception, N’Djamena',
  description: 'L’élégance accessible à tous. Application de réservation VTC haut de gamme à N’Djamena.',
  icons: {
    icon: '/logo.png',
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
      <body>{children}</body>
    </html>
  );
}
