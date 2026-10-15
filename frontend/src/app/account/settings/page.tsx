'use client';

import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui';
import { Toggle } from '@/components/ui';
import { Input } from '@/components/ui';
import { Button } from '@/components/ui';
import { useState, useEffect } from 'react';
import { isTauri, tauriInvoke } from '@/lib/tauri';
import { ensureFiberKeys, deriveLockHashSync } from '@/lib/fiber-keys';

const RocketIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.484 16.886a.5.5 0 01-.14-.88l8-10a.5.5 0 01.882.14l4.111 4.11a.5.5 0 01-.14.88l-1.57 1.571a4.5 4.5 0 01-6.364 0l-1.57-1.57a.5.5 0 01-.14-.88z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v8m0-8h8m-8 0l3-3m-3 3l-3 3m0-8v8m0 0l3-3m-3 3l-3-3" />
  </svg>
);

const RefreshIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const NotificationsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const AnalyticsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const BugIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3M11 10V3M15 10V3M9 14l6 6M12 14l-3 3M15 14l3 3M12 8h.01M12 16h.01" />
  </svg>
);

const WalletIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a7 7 0 01-7 7M21 12a7 7 0 00-7 7M21 12a7 7 0 01-7-7M21 12a7 7 0 00-7-7M12 5a7 7 0 017 7M12 5a7 7 0 00-7 7M12 5a7 7 0 01-7-7M12 5a7 7 0 007-7z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 17v-4" />
  </svg>
);

const KeyIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
  </svg>
);

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const AlertIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export default function AppSettings() {
  const [autoStart, setAutoStart] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [mockMode, setMockMode] = useState(false);

  // Wallet state (auto-derived from Fiber keys)
  const [walletAddress, setWalletAddress] = useState('');
  const [walletLockHash, setWalletLockHash] = useState('');
  const [walletPublicKey, setWalletPublicKey] = useState('');
  const [walletKeychainId, setWalletKeychainId] = useState('bee-network-wallet');
  const [walletInitialized, setWalletInitialized] = useState(false);
  const [walletInitializing, setWalletInitializing] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccess, setWalletSuccess] = useState(false);
  // Evaluated once on mount (post-hydration) so the UI deterministically
  // reflects whether we run inside the Tauri webview or a plain browser.
  const [inTauri, setInTauri] = useState(false);

  useEffect(() => {
    setAutoStart(localStorage.getItem('bees_auto_start') === 'true');
    setAutoUpdate(localStorage.getItem('bees_auto_update') !== 'false');
    setNotifications(localStorage.getItem('bees_notifications') !== 'false');
    setAnalytics(localStorage.getItem('bees_analytics') === 'true');
    setMockMode(localStorage.getItem('bees_mock_mode') === 'true');
  }, []);

  // Auto-initialize wallet from Fiber keys when in Tauri
  useEffect(() => {
    const tauri = isTauri();
    setInTauri(tauri);
    if (tauri) {
      initWalletFromFiberKeys();
    }
  }, []);

  const initWalletFromFiberKeys = async () => {
    try {
      // Get the CKB secret key that frontend already generated/stored
      const fiberKeys = ensureFiberKeys();
      const { lockHash: expectedLockHash } = deriveLockHashSync(fiberKeys.ckbSecretKeyHex);

      setWalletInitializing(true);
      setWalletError(null);
      setWalletSuccess(false);

      // Send to Tauri to derive full identity, store in keyring, and save config.
      // NOTE: Tauri v2 exposes Rust command params to JS in camelCase
      // (ckb_secret_key_hex -> ckbSecretKeyHex). Snake_case keys are rejected
      // with "missing required key". Response fields stay snake_case (serde).
      const wallet = await tauriInvoke<{
        address: string;
        lock_hash: string;
        public_key: string;
        keychain_id: string;
      }>('init_wallet_from_frontend', {
        ckbSecretKeyHex: fiberKeys.ckbSecretKeyHex,
        keychainId: 'bee-network-wallet',
      });

      if (
        expectedLockHash &&
        wallet.lock_hash &&
        expectedLockHash.toLowerCase() !== wallet.lock_hash.toLowerCase()
      ) {
        throw new Error(
          `Wallet mismatch: frontend lock ${expectedLockHash} != backend lock ${wallet.lock_hash}`
        );
      }

      setWalletAddress(wallet.address);
      setWalletLockHash(wallet.lock_hash);
      setWalletPublicKey(wallet.public_key);
      setWalletKeychainId(wallet.keychain_id);
      setWalletInitialized(true);
      setWalletSuccess(true);
      setTimeout(() => setWalletSuccess(false), 3000);
    } catch (err) {
      const msg =
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message || 'Failed to initialize wallet'
            : 'Failed to initialize wallet';
      setWalletError(msg);
    } finally {
      setWalletInitializing(false);
    }
  };

  const handleRegisterNode = async () => {
    if (!isTauri()) {
      setWalletError('Node registration only available in desktop app');
      return;
    }
    if (!walletLockHash) {
      setWalletError('Wallet not initialized');
      return;
    }
    setWalletError(null);
    try {
      const nodeId = await tauriInvoke<string>('register_node');
      setWalletSuccess(true);
      setTimeout(() => setWalletSuccess(false), 3000);
      alert(`Node registered: ${nodeId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register node';
      setWalletError(msg);
    }
  };

  const handleClaimRewards = async () => {
    if (!isTauri()) {
      setWalletError('Reward claiming only available in desktop app');
      return;
    }
    if (!walletLockHash) {
      setWalletError('Wallet not initialized');
      return;
    }
    setWalletError(null);
    try {
      const amount = await tauriInvoke<number>('claim_rewards');
      alert(`Claimed ${amount} CKB (shannons)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to claim rewards';
      setWalletError(msg);
    }
  };

  const handleAutoStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoStart(checked);
    localStorage.setItem('bees_auto_start', checked.toString());
  };

  const handleAutoUpdateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoUpdate(checked);
    localStorage.setItem('bees_auto_update', checked.toString());
  };

  const handleNotificationsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setNotifications(checked);
    localStorage.setItem('bees_notifications', checked.toString());
  };

  const handleAnalyticsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAnalytics(checked);
    localStorage.setItem('bees_analytics', checked.toString());
  };

  const handleMockModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setMockMode(checked);
    localStorage.setItem('bees_mock_mode', checked.toString());
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
      <Header
        title="App Settings"
        showBack
        backHref="/account"
      />

      <main className="max-w-md mx-auto space-y-4 pt-4 pb-8">
        {/* Wallet Section - Auto-derived from Fiber/Web5 identity */}
        <Card className="border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5">
          <div className="flex items-center gap-3 mb-4">
            <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <WalletIcon />
            </span>
            <span className="font-medium text-[var(--color-text)]">CKB Wallet (Auto-derived)</span>
          </div>
          
          <div className="space-y-3">
            {!walletInitialized && !walletInitializing && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertIcon className="text-amber-700 flex-shrink-0" />
                <div className="flex-1 text-sm text-amber-800">
                  <p className="font-medium">Wallet not linked to desktop app</p>
                  <p>Click "Link Wallet" to securely transfer your Web5 identity to the node.</p>
                </div>
                <Button variant="primary" onClick={initWalletFromFiberKeys} disabled={walletInitializing} className="flex-shrink-0">
                  {walletInitializing ? 'Linking...' : 'Link Wallet'}
                </Button>
              </div>
            )}

            {walletInitialized && (
              <>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">CKB Address</label>
                    <Input
                      value={walletAddress}
                      readOnly
                      className="bg-[var(--color-bg)] cursor-default"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Lock Hash</label>
                    <Input
                      value={walletLockHash}
                      readOnly
                      className="bg-[var(--color-bg)] cursor-default font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Public Key (compressed)</label>
                    <Input
                      value={walletPublicKey}
                      readOnly
                      className="bg-[var(--color-bg)] cursor-default font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Keychain ID</label>
                    <Input
                      value={walletKeychainId}
                      readOnly
                      className="bg-[var(--color-bg)] cursor-default"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="secondary" onClick={handleRegisterNode} disabled={walletInitializing} fullWidth>
                    Register Node
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={handleClaimRewards} disabled={walletInitializing} fullWidth>
                    Claim Rewards
                  </Button>
                </div>
              </>
            )}

            {walletInitializing && !walletInitialized && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--color-primary)] border-t-transparent" />
                <span>Linking wallet to desktop app...</span>
              </div>
            )}

            {walletError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertIcon /> {walletError}
              </p>
            )}
            {walletSuccess && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckIcon /> Wallet linked successfully
              </p>
            )}

            {!inTauri && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Wallet linking requires the desktop app. Install the Tauri app to connect your Web5 identity.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <RocketIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Enable Auto Start</span>
            </div>
            <Toggle checked={autoStart} onChange={handleAutoStartChange} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <RefreshIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Enable Auto Update</span>
            </div>
            <Toggle checked={autoUpdate} onChange={handleAutoUpdateChange} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <NotificationsIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Push Notifications</span>
            </div>
            <Toggle checked={notifications} onChange={handleNotificationsChange} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <AnalyticsIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Usage Analytics</span>
            </div>
            <Toggle checked={analytics} onChange={handleAnalyticsChange} />
          </div>
        </Card>

        <Card className="border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-amber-100 text-amber-700">
                <BugIcon />
              </span>
              <div>
                <span className="font-medium text-[var(--color-text)]">Mock Data Mode</span>
                <p className="text-xs text-[var(--color-text-muted)]">Simulate node data for testing</p>
              </div>
            </div>
            <Toggle checked={mockMode} onChange={handleMockModeChange} />
          </div>
        </Card>
      </main>
    </div>
  );
}