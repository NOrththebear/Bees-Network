'use client';

/**
 * Central node bee: a small foraging bee that hovers with fluttering wings
 * while the node is active, and rests (desaturated, still) when inactive.
 * Same honey-gold language as the splash art, simplified for ~80px display.
 */

interface NodeBeeProps {
  active: boolean;
  className?: string;
}

export function NodeBee({ active, className = '' }: NodeBeeProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      role="img"
      aria-label={active ? 'Bee node active and serving requests' : 'Bee node inactive'}
      className={`block ${active ? '' : 'opacity-70 saturate-50'} ${className}`}
    >
      <defs>
        <linearGradient id="nodeBeeGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0a3" />
          <stop offset=".45" stopColor="#ffc52e" />
          <stop offset="1" stopColor="#d98900" />
        </linearGradient>
        <linearGradient id="nodeBeeDark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#303238" />
          <stop offset="1" stopColor="#090a0c" />
        </linearGradient>
        <clipPath id="nodeBeeAbdomenClip">
          <ellipse cx="40" cy="58" rx="23" ry="16" transform="rotate(-18 40 58)" />
        </clipPath>
      </defs>

      <g className={active ? 'nodebee-bob' : undefined}>
        {/* Wings sit behind the body; placement on the wrapper so the
            flutter keyframes never override it. */}
        <g transform="rotate(-18 35 32)">
          <ellipse
            cx="35"
            cy="32"
            rx="15"
            ry="8"
            fill="#FFF7DC"
            opacity=".92"
            className={active ? 'nodebee-wing nodebee-wing-l' : undefined}
          />
        </g>
        <g transform="rotate(18 59 30)">
          <ellipse
            cx="59"
            cy="30"
            rx="14"
            ry="8"
            fill="#FFF7DC"
            opacity=".92"
            className={active ? 'nodebee-wing nodebee-wing-r' : undefined}
          />
        </g>

        {/* Stinger */}
        <path d="M 18 62 L 8 67 L 16 53 Z" fill="#292a2e" />

        {/* Abdomen + stripes */}
        <ellipse cx="40" cy="58" rx="23" ry="16" transform="rotate(-18 40 58)" fill="url(#nodeBeeGold)" />
        <g clipPath="url(#nodeBeeAbdomenClip)">
          <rect x="30" y="34" width="8" height="48" fill="url(#nodeBeeDark)" />
          <rect x="44" y="34" width="8" height="48" fill="url(#nodeBeeDark)" />
        </g>
        <ellipse
          cx="40"
          cy="58"
          rx="23"
          ry="16"
          transform="rotate(-18 40 58)"
          fill="none"
          stroke="#ffe28a"
          strokeOpacity=".65"
          strokeWidth="1.2"
        />

        {/* Head + face */}
        <circle cx="63" cy="48" r="12" fill="url(#nodeBeeGold)" />
        <circle cx="66.5" cy="45.5" r="4.5" fill="#17181c" />
        <circle cx="68" cy="44" r="1.4" fill="#fff" />
        <path d="M 60 36 Q 58 29 53 27" fill="none" stroke="#343238" strokeWidth="2" strokeLinecap="round" />
        <path d="M 66 36 Q 67 29 72 27" fill="none" stroke="#343238" strokeWidth="2" strokeLinecap="round" />
        <circle cx="63" cy="48" r="12" fill="none" stroke="#ffe89a" strokeOpacity=".6" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
