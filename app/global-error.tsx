'use client';

// Next.js affiche ce composant à la place de l'écran générique
// "Application error: a client-side exception has occurred" dès qu'une
// exception non interceptée remonte jusqu'à la racine. Utile uniquement
// pour déboguer : on affiche le message et la stack en clair, y compris en
// production, le temps d'identifier la cause. À retirer (ou masquer
// derrière une condition) une fois le bug corrigé, pour ne pas exposer de
// détails techniques aux vrais utilisateurs.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body style={{ background: '#0a0b0d', color: '#fff', padding: 20, fontFamily: 'monospace' }}>
        <h2 style={{ color: '#ff6b6b' }}>Erreur interceptée</h2>
        <p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{error?.message}</p>
        {error?.digest && <p style={{ opacity: 0.6, fontSize: 12 }}>digest: {error.digest}</p>}
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, opacity: 0.7, marginTop: 20 }}>
          {error?.stack}
        </pre>
        <button
          onClick={() => reset()}
          style={{ marginTop: 20, padding: '10px 16px', borderRadius: 8, border: '1px solid #555' }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
