'use client';

/**
 * Bee Network brand mark: gold tile + dark bee glyph with cream wings.
 * Vector twin of `public/bee-mark.svg` (kept in sync by hand — same geometry).
 * Use for the header logo, avatars, and anywhere the brand appears in-app.
 * Favicons / manifest PNGs are rasterized from the SVG file (see README note
 * in `public/icons/`).
 */

interface BeeMarkProps {
  className?: string;
  title?: string;
}

export function BeeMark({ className = '', title = 'Bee Network' }: BeeMarkProps) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={`block ${className}`}>
      <defs>
        <linearGradient id="beeMarkUiGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE9A8" />
          <stop offset=".5" stopColor="#FFB800" />
          <stop offset="1" stopColor="#D98900" />
        </linearGradient>
        <clipPath id="beeMarkUiBodyClip">
          <ellipse cx="30" cy="38" rx="12" ry="9" transform="rotate(-16 30 38)" />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#beeMarkUiGold)" />
      <ellipse cx="24" cy="22" rx="10" ry="6" transform="rotate(-18 24 22)" fill="#FFF9DB" opacity=".95" />
      <ellipse cx="40" cy="22" rx="10" ry="6" transform="rotate(18 40 22)" fill="#FFF9DB" opacity=".95" />
      <path d="M19 41 L13 44 L18 36 Z" fill="#1A1A1A" />
      <ellipse cx="30" cy="38" rx="12" ry="9" transform="rotate(-16 30 38)" fill="#1A1A1A" />
      <g clipPath="url(#beeMarkUiBodyClip)">
        <rect x="26" y="24" width="4.5" height="30" fill="#FFC52E" />
        <rect x="33.5" y="24" width="4.5" height="30" fill="#FFC52E" />
      </g>
      <circle cx="43" cy="32" r="6.5" fill="#1A1A1A" />
      <circle cx="45" cy="30" r="1.8" fill="#FFF3CB" />
    </svg>
  );
}
