/** The MUNOS column-and-laurel mark (same drawing as the munos.pages.dev favicon), inline so it renders offline. */
export function MunosMark({ size = 28 }: { size?: number }) {
  const leaf = "M10 24C7 17 10 11 16 8C17 16 15 21 10 24ZM8 35C2 31 2 25 3 21C8 24 10 29 8 35ZM12 44C10 39 12 34 17 31C19 38 17 42 12 44Z";
  return (
    <svg className="munos-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path fill="#062b42" d="M20 16h24v5H20zM24 24h4v23h-4zM30 24h4v23h-4zM36 24h4v23h-4zM21 50h22v4H21z" />
      <path d="M18 53C7 45 5 34 10 23" fill="none" stroke="#009edb" strokeWidth="2.5" />
      <path d={leaf} fill="#009edb" />
      <g transform="translate(64 0) scale(-1 1)">
        <path d="M18 53C7 45 5 34 10 23" fill="none" stroke="#009edb" strokeWidth="2.5" />
        <path d={leaf} fill="#009edb" />
      </g>
    </svg>
  );
}
