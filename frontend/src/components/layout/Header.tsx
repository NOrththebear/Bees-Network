'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { BeeMark } from '@/components/BeeMark';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  backHref?: string;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
  settingsHref?: string;
}

export function Header({
  title,
  showBack = false,
  backHref = '/',
  leftAction,
  rightAction,
  settingsHref = '/account',
}: HeaderProps) {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-surface)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 pb-3 header-top">
      <div className="max-w-md mx-auto flex items-center justify-between gap-3">
        {/* Left side */}
        <div className="flex items-center gap-3 min-w-0">
          {showBack && (
            <Link
              href={backHref}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors touch-target"
              aria-label="Go back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          <div className="flex items-center gap-2">
            <BeeMark className="w-9 h-9" />
            <span className="text-xs font-semibold text-[var(--color-text)]">Bee Network</span>
          </div>
        </div>

        {/* Center - Title */}
        <div className="flex-1 text-center truncate px-4">
          <h1 className="text-lg font-semibold text-[var(--color-text)] truncate">{title}</h1>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 min-w-0">
          {leftAction}
          {rightAction || (
            <Link
              href={settingsHref}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors touch-target"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}