'use client';

export default function MapBackground({
  routeColor,
  routePath,
  viewBox = '0 0 390 844',
  children,
}: {
  routeColor?: string;
  routePath?: string;
  viewBox?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="map">
      <div className="blockA" />
      <div className="blockB" />
      <div className="blockC" />
      <div className="blockD" />
      <div className="road h1" />
      <div className="road h2" />
      <div className="road v1" />
      <div className="road v2" />
      {routePath && (
        <svg className="overlay" viewBox={viewBox}>
          <path
            d={routePath}
            fill="none"
            stroke={routeColor}
            strokeWidth="4"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${routeColor})` }}
          />
        </svg>
      )}
      {children}
    </div>
  );
}
