'use client';

/**
 * Bee Network loading splash screen.
 *
 * Art source: `public/bee_network_splash.svg` (kept as the file of record).
 * The SVG is inlined here (rather than `<img>`) so the loading message is
 * configurable and no extra network request is needed.
 *
 * Two deliberate adjustments vs the raw file (design + timing preserved):
 * - Placement (`translate`/`rotate`) lives on outer wrapper `<g>`s while the
 *   animation classes sit on inner `<g>`s. A CSS keyframe `transform`
 *   overrides the `transform` *attribute*, so without wrappers the bee and
 *   ring would jump to the origin while animating.
 * - `.status-dot` gains `transform-box: fill-box; transform-origin: center`
 *   so the pulse scales each dot in place instead of toward the SVG origin.
 *
 * Usage (App Router, client pages):
 *   const [loading, setLoading] = useState(true);
 *   return (<>
 *     <BeeSplashScreen show={loading} message="SYNCING NODE" onHidden={() => ...} />
 *     <main>...</main>
 *   </>);
 * When `show` flips to false the overlay fades, unmounts, and stops
 * intercepting pointer events — interaction is never blocked afterwards.
 */

import { useEffect, useRef, useState } from 'react';

interface BeeSplashScreenProps {
  /** Controls visibility. Defaults to true (splash on mount). */
  show?: boolean;
  /** Brand title. Defaults to "BEE NETWORK". */
  title?: string;
  /** Loading message under the title. Keep it short. Defaults to "CONNECTING INTELLIGENCE". */
  message?: string;
  /** Called once, after the fade-out completes and the overlay unmounts. */
  onHidden?: () => void;
  className?: string;
}

const FADE_MS = 450;

export function BeeSplashScreen({
  show = true,
  title = 'BEE NETWORK',
  message = 'CONNECTING INTELLIGENCE',
  onHidden,
  className = '',
}: BeeSplashScreenProps) {
  const [prevShow, setPrevShow] = useState(show);
  const [rendered, setRendered] = useState(show);
  const [fading, setFading] = useState(false);
  const onHiddenRef = useRef(onHidden);
  // Latest-callback ref: keeps the fade timer stable across parent re-renders.
  useEffect(() => {
    onHiddenRef.current = onHidden;
  });

  // Derived-state pattern (not an effect): respond to `show` flips during
  // render; the unmount timer below only *reads* `fading`.
  if (prevShow !== show) {
    setPrevShow(show);
    if (show) {
      setRendered(true);
      setFading(false);
    } else {
      setFading(true);
    }
  }

  useEffect(() => {
    if (!fading) return;
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => {
      setRendered(false);
      onHiddenRef.current?.();
    }, reduce ? 0 : FADE_MS);
    return () => clearTimeout(t);
  }, [fading]);

  if (!rendered) return null;

  return (
    <div
      className={`bee-splash fixed inset-0 z-[100] flex items-center justify-center bg-[#08090b] p-6 ${fading ? 'bee-splash-hidden' : ''} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 480 640"
        role="img"
        aria-labelledby="bee-splash-title bee-splash-desc"
        className="h-auto w-[min(78vw,380px,58vh)]"
      >
        <title id="bee-splash-title">Bee Network loading animation</title>
        <desc id="bee-splash-desc">
          A golden bee hovers in the center of a rotating honey-gold loading ring on a dark background.
        </desc>
        <defs>
          <radialGradient id="beeSplashBackgroundGlow">
            <stop offset="0" stopColor="#5a3900" stopOpacity=".28" />
            <stop offset="1" stopColor="#08090b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="beeSplashGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0a3" />
            <stop offset=".38" stopColor="#ffc52e" />
            <stop offset="1" stopColor="#d98900" />
          </linearGradient>
          <linearGradient id="beeSplashDarkStripe" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#303238" />
            <stop offset="1" stopColor="#090a0c" />
          </linearGradient>
          <linearGradient id="beeSplashWingFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff9db" stopOpacity=".92" />
            <stop offset="1" stopColor="#ffc62f" stopOpacity=".24" />
          </linearGradient>
          <filter id="beeSplashSoftGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="beeSplashShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000" floodOpacity=".5" />
          </filter>
          <clipPath id="beeSplashAbdomenClip">
            <ellipse cx="0" cy="0" rx="48" ry="34" transform="rotate(-36)" />
          </clipPath>
        </defs>

        <ellipse cx="240" cy="295" rx="205" ry="205" fill="url(#beeSplashBackgroundGlow)" />

        {/* Independent loading ring layer (placement wrapper + rotating inner layer) */}
        <g id="bee-splash-loading-ring" transform="translate(240 290)" fill="none" strokeLinecap="round">
          <circle r="136" stroke="#e8a514" strokeOpacity=".10" strokeWidth="2" />
          <g id="bee-splash-ring-rotator" className="bee-splash-ring-rotator">
            <path d="M -87 -105 A 136 136 0 0 1 79 -111" stroke="url(#beeSplashGold)" strokeWidth="7" filter="url(#beeSplashSoftGlow)" />
            <path d="M 122 -58 A 136 136 0 0 1 119 62" stroke="#f8b91d" strokeOpacity=".55" strokeWidth="5" />
            <path d="M 72 116 A 136 136 0 0 1 -61 122" stroke="url(#beeSplashGold)" strokeWidth="7" />
            <path d="M -125 53 A 136 136 0 0 1 -119 -61" stroke="#d58b08" strokeOpacity=".5" strokeWidth="5" />
            <g id="bee-splash-loading-dots" fill="#ffc52e" stroke="none" filter="url(#beeSplashSoftGlow)">
              <circle cx="-105" cy="-88" r="4.5" />
              <circle cx="-91" cy="-101" r="4" />
              <circle cx="-75" cy="-112" r="3.5" />
              <circle cx="126" cy="79" r="4.5" />
              <circle cx="130" cy="61" r="4" />
              <circle cx="132" cy="43" r="3.5" />
              <circle cx="-83" cy="111" r="4.5" />
              <circle cx="-99" cy="101" r="4" />
              <circle cx="-113" cy="88" r="3.5" />
            </g>
          </g>
        </g>

        {/* Bee placement wrapper + independently bobbing inner layer */}
        <g id="bee-splash-bee-placement" transform="translate(244 288) rotate(-8)" filter="url(#beeSplashShadow)">
          <g id="bee-splash-bee" className="bee-splash-hover">
            {/* Antennae */}
            <g id="bee-splash-antennae" fill="none" strokeLinecap="round" strokeWidth="4">
              <path d="M 29 -26 Q 31 -57 49 -66" stroke="#343238" />
              <path d="M 46 -24 Q 56 -50 76 -53" stroke="#343238" />
              <circle cx="50" cy="-67" r="6.5" fill="url(#beeSplashGold)" stroke="none" />
              <circle cx="77" cy="-54" r="6.5" fill="url(#beeSplashGold)" stroke="none" />
            </g>

            {/* Wings animate independently */}
            <g id="bee-splash-left-wing" className="bee-splash-wing bee-splash-wing-left">
              <path d="M -9 -8 C -44 -63 -92 -73 -95 -42 C -98 -18 -58 3 -17 9 Z" fill="url(#beeSplashWingFill)" stroke="#ffe7a0" strokeWidth="1.8" />
              <path d="M -16 -5 Q -52 -41 -86 -43" fill="none" stroke="#fff4c4" strokeOpacity=".7" strokeWidth="1.2" />
            </g>
            <g id="bee-splash-right-wing" className="bee-splash-wing bee-splash-wing-right">
              <path d="M -7 -9 C -35 -75 -16 -106 8 -88 C 29 -71 20 -32 5 3 Z" fill="url(#beeSplashWingFill)" stroke="#ffe7a0" strokeWidth="1.8" />
              <path d="M -3 -13 Q -12 -51 3 -81" fill="none" stroke="#fff4c4" strokeOpacity=".7" strokeWidth="1.2" />
            </g>

            {/* Stinger */}
            <path id="bee-splash-stinger" d="M -39 21 L -63 35 L -49 9 Z" fill="#292a2e" />

            {/* Abdomen and stripes */}
            <g id="bee-splash-abdomen" transform="translate(-26 17) rotate(-36)">
              <ellipse cx="0" cy="0" rx="49" ry="34" fill="url(#beeSplashGold)" />
              <g clipPath="url(#beeSplashAbdomenClip)">
                <path d="M -20 -42 L -1 -42 L -1 42 L -20 42 Z" fill="url(#beeSplashDarkStripe)" />
                <path d="M 13 -42 L 32 -42 L 32 42 L 13 42 Z" fill="url(#beeSplashDarkStripe)" />
              </g>
              <ellipse cx="0" cy="0" rx="49" ry="34" fill="none" stroke="#ffe28a" strokeOpacity=".65" strokeWidth="1.5" />
            </g>

            {/* Head */}
            <g id="bee-splash-head">
              <circle cx="23" cy="-4" r="34" fill="url(#beeSplashGold)" />
              <circle cx="31" cy="-7" r="20" fill="#17181c" />
              <ellipse cx="36" cy="-16" rx="6.5" ry="8" fill="#fff" />
              <circle cx="23" cy="-4" r="34" fill="none" stroke="#ffe89a" strokeOpacity=".6" strokeWidth="1.5" />
            </g>
          </g>
        </g>

        <g id="bee-splash-brand" fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" textAnchor="middle">
          <text x="240" y="500" fill="#fff3cb" fontSize="25" fontWeight="650" letterSpacing="1.2">
            {title}
          </text>
          <text x="240" y="526" fill="#d9a82c" fontSize="11" letterSpacing="3.2">
            {message}
          </text>
          <g id="bee-splash-status-dots" fill="#ffc52e">
            <circle className="bee-splash-status-dot bee-splash-dot-1" cx="222" cy="558" r="3" />
            <circle className="bee-splash-status-dot bee-splash-dot-2" cx="240" cy="558" r="3" />
            <circle className="bee-splash-status-dot bee-splash-dot-3" cx="258" cy="558" r="3" />
          </g>
        </g>

        <style>{`
          .bee-splash-hover { transform-box: fill-box; transform-origin: center; animation: beeSplashHover 2.2s ease-in-out infinite; }
          .bee-splash-wing { transform-box: fill-box; transform-origin: 20% 75%; }
          .bee-splash-wing-left { animation: beeSplashWingFlutter .16s ease-in-out infinite alternate; }
          .bee-splash-wing-right { animation: beeSplashWingFlutter .13s ease-in-out infinite alternate-reverse; }
          .bee-splash-ring-rotator { transform-box: fill-box; transform-origin: center; animation: beeSplashRingRotate 8s linear infinite; }
          .bee-splash-status-dot { transform-box: fill-box; transform-origin: center; opacity: .25; animation: beeSplashDotPulse 1.2s ease-in-out infinite; }
          .bee-splash-dot-2 { animation-delay: .2s; }
          .bee-splash-dot-3 { animation-delay: .4s; }
          @keyframes beeSplashHover { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(2.5deg); } }
          @keyframes beeSplashWingFlutter { from { transform: rotate(-9deg) scale(.96); opacity: .78; } to { transform: rotate(13deg) scale(1.04); opacity: 1; } }
          @keyframes beeSplashRingRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes beeSplashDotPulse { 0%,100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.25); } }
          @media (prefers-reduced-motion: reduce) {
            .bee-splash-hover, .bee-splash-wing, .bee-splash-ring-rotator, .bee-splash-status-dot {
              animation-duration: 0.001ms !important;
              animation-iteration-count: 1 !important;
            }
          }
        `}</style>
      </svg>
    </div>
  );
}
