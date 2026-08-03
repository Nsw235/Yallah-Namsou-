'use client';

export default function Header({
  onMenuClick,
  onOptionsClick,
}: {
  onMenuClick?: () => void;
  onOptionsClick?: () => void;
}) {
  return (
    <div className="header">
      <div className="header-top">
        <div className="icon-btn" onClick={onMenuClick} role="button" aria-label="Menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <img src="/logo.png" alt="Yalla Nimshi" className="header-logo-img" />
        <div className="icon-btn" onClick={onOptionsClick} role="button" aria-label="Options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="12" cy="19" r="1.6" fill="currentColor" />
          </svg>
        </div>
      </div>
    </div>
  );
}
