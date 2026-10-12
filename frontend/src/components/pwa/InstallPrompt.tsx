'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { canInstall, promptInstall, isStandalone } from '@/lib/pwa';

export function InstallPrompt({ onDismiss }: { onDismiss?: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    
    const handleInstallable = () => setShow(true);
    const handleInstalled = () => setShow(false);

    window.addEventListener('pwa-installable', handleInstallable);
    window.addEventListener('pwa-installed', handleInstalled);

    return () => {
      window.removeEventListener('pwa-installable', handleInstallable);
      window.removeEventListener('pwa-installed', handleInstalled);
    };
  }, []);

  if (!show || isStandalone()) return null;

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (accepted) setShow(false);
  };

  const handleDismiss = () => {
    setShow(false);
    onDismiss?.();
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 max-w-md mx-auto z-50 safe-area-inset-bottom animate-slide-up">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)]">Install Bees Network</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Add to home screen for quick access to your hive
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" fullWidth onClick={handleDismiss}>
            Not Now
          </Button>
          <Button variant="primary" size="sm" fullWidth onClick={handleInstall}>
            Install
          </Button>
        </div>
      </div>
    </div>
  );
}