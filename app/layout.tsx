import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moto-Taxi Tchad",
  description: "Commandez une moto ou une voiture en quelques secondes à N'Djamena",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#1B2A4A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
