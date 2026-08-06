'use client';

export default function Header({
  onMenuClick,
  onOptionsClick,
  locked,
}: {
  onMenuClick?: () => void;
  onOptionsClick?: () => void;
  /** Course en cours : plus aucune sortie possible tant qu'elle n'est pas
   *  terminée/annulée. Le bouton menu devient un cadenas visuel plutôt que
   *  de disparaître — le passager comprend que c'est un choix voulu de
   *  l'app, pas un bouton cassé. */
  locked?: boolean;
}) {
  return (
    <div className="header">
      <div className="header-top">
        {locked ? (
          <div className="icon-btn yn-header-locked" aria-label="Menu indisponible pendant le trajet" title="Indisponible pendant le trajet">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ) : (
          <div className="icon-btn" onClick={onMenuClick} role="button" aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}
        <img src="/logo.png" alt="Yalla Nimshi" className="header-logo-img" />
        {locked ? (
          <div style={{ width: 42, height: 42 }} />
        ) : (
          <div className="icon-btn" onClick={onOptionsClick} role="button" aria-label="Options">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="5" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="19" r="1.6" fill="currentColor" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
