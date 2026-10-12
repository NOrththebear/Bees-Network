'use client';

import { useEffect } from 'react';
import { initPWA, isStandalone } from '@/lib/pwa';
import { InstallPrompt } from './InstallPrompt';
import { OfflineIndicator } from './OfflineIndicator';

export function PWAProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPWA();
  }, []);

  if (typeof window === 'undefined') return <>{children}</>;

  return (
    <>
      {children}
      <OfflineIndicator />
      <InstallPrompt />
    </>
  );
}