'use client';

export default function Header({ onOptionsClick }: { onOptionsClick?: () => void }) {
  return (
    <div className="header">
      <div className="header-top">
        <div className="icon-btn">
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
      <div className="pill">
        <span className="dot" /> N&apos;Djamena
      </div>
    </div>
  );
}
