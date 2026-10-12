'use client';

import { useEffect, useState } from 'react';
import { isOnline, isStandalone } from '@/lib/pwa';

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    setOnline(isOnline());

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('pwa-online', handleOnline);
    window.addEventListener('pwa-offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('pwa-online', handleOnline);
      window.removeEventListener('pwa-offline', handleOffline);
    };
  }, []);

  if (online || isStandalone() === false) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-warning)] text-[var(--color-secondary)] px-4 py-2 text-center text-sm font-medium animate-slide-down safe-area-inset-top">
      <div className="flex items-center justify-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <span>You're offline. Some features may be unavailable.</span>
      </div>
    </div>
  );
}