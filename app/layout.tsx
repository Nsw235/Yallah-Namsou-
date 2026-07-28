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
      <body>{children}</body>
    </html>
  );
}
