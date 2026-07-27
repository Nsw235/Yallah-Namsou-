import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Private Fleet — VTC N\u2019Djamena',
  description: 'Application de réservation VTC haut de gamme, mode sombre, N\u2019Djamena.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
