// PWA utilities for Bees Network

import { isTauri } from './tauri';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isInstallable = false;

export function initPWA(): Promise<void> {
  return new Promise((resolve) => {
    // Register service worker — but never inside the Tauri desktop app, where
    // assets are served from the embedded bundle and a SW cache would pin the
    // UI to a stale build.
    if ('serviceWorker' in navigator && !isTauri()) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed silently
      });
    }

    // Listen for beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      isInstallable = true;
      window.dispatchEvent(new CustomEvent('pwa-installable', { detail: true }));
    });

    // Track install
    window.addEventListener('appinstalled', () => {
      isInstallable = false;
      deferredPrompt = null;
      window.dispatchEvent(new CustomEvent('pwa-installed'));
    });

    // Online/offline detection
    window.addEventListener('online', () => {
      window.dispatchEvent(new CustomEvent('pwa-online'));
    });
    window.addEventListener('offline', () => {
      window.dispatchEvent(new CustomEvent('pwa-offline'));
    });

    resolve();
  });
}

export function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return Promise.resolve(false);

  return deferredPrompt.prompt().then(() => {
    return deferredPrompt!.userChoice.then((choice) => {
      deferredPrompt = null;
      isInstallable = false;
      return choice.outcome === 'accepted';
    });
  });
}

export function canInstall(): boolean {
  return isInstallable;
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as any).standalone === true;
}

export function isOnline(): boolean {
  return navigator.onLine;
}