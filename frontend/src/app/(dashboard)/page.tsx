'use client';

import { useBeesData, formatAmountWithUnit } from '@/hooks/useBeesData';
import { useWallet, type WalletType } from '@/hooks/useWallet';
import { getWallet } from '@/lib/wallet';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui';
import { Card } from '@/components/ui';
import Link from 'next/link';
import { useState } from 'react';

const HoneycombIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l6.9 3.45L12 11.09 5.1 7.63 12 4.18zM4 8.82l7 3.5v7.36l-7-3.5V8.82zm9 10.86v-7.36l7-3.5v7.36l-7 3.5z" />
  </svg>
);

const ObservationIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2zm0 12H7v-5h10v5z" />
  </svg>
);

const PowerIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19v-7a2 2 0 00-2-2H7a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v2a2 2 0 002 2h5a2 2 0 012 2v5a2 2 0 01-2 2h-3a2 2 0 00-2 2v2" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

const ArrowIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const WalletIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12V7H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 01-2 2h-5v5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12v6m0 0l3-3m-3 3l-3-3m9-3h.01M18 12v6m0 0l3-3m-3 3l-3-3m-9 3V9m0 0l3-3m-3 3l-3-3" />
  </svg>
);

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const WifiIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const WifiOffIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7M17 17l4 4M21 21l-4-4M3 3l18 18" />
  </svg>
);

const GlobeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
);

const ServerIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
  </svg>
);

export default function Dashboard() {
  const { connectedWallet, connect, disconnect, availableWallets, isConnecting, error: walletError, clearError } = useWallet();
  const userLockHash = connectedWallet?.lockHash;
  const { userHarvest, loading, error, refetch } = useBeesData(userLockHash, 'testnet');
  const [showWalletModal, setShowWalletModal] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface)] pt-16 pb-24 px-4 safe-area-top safe-area-bottom">
        <Header title="Dashboard" settingsHref="/account" />
        <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
          <div className="flex flex-col items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--color-primary)] border-t-transparent" />
            <p className="mt-4 text-[var(--color-text-muted)]">Loading network data...</p>
          </div>
        </main>
      </div>
    );
  }

  const harvest = userHarvest || {
    totalHoney: 0n,
    totalNectar: 0n,
    epoch: 0,
    networkQuality: 0,
    deviceId: 'BEE-XXXX-XXXX-XXXX',
    isConnected: false,
    userShares: [],
    userNode: undefined,
  };

  const creditsDisplay = formatAmountWithUnit(harvest.totalHoney);
  const pointsDisplay = formatAmountWithUnit(harvest.totalNectar);

  const handleConnectWallet = async (type: string) => {
    try {
      await connect(type as any);
      setShowWalletModal(false);
      clearError();
    } catch (err) {
      console.error('Wallet connect failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pt-16 pb-24 px-4 safe-area-top safe-area-bottom">
      <Header
        title="Dashboard"
        settingsHref="/account"
        leftAction={
          !connectedWallet && (
            <Button variant="ghost" size="sm" className="p-1.5" onClick={() => setShowWalletModal(true)} aria-label="Connect wallet">
              <WalletIcon />
            </Button>
          )
        }
      />

      <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
        <div className="absolute top-0 left-0 right-0 h-48 pointer-events-none overflow-hidden">
          <div className="honeycomb-bg h-full opacity-30" />
        </div>

        {/* Wallet Connection Status */}
        {!connectedWallet && (
          <Card className="relative z-10 bg-gradient-to-r from-[var(--color-primary)]/5 to-amber-50 border-[var(--color-primary)]/20">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <WalletIcon />
              </span>
              <div className="flex-1">
                <p className="font-medium text-[var(--color-text)]">Connect Wallet</p>
                <p className="text-xs text-[var(--color-text-muted)]">Link your CKB wallet to view node status</p>
              </div>
              <Button variant="primary" size="sm" onClick={() => setShowWalletModal(true)} disabled={isConnecting}>
                {isConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
            {walletError && (
              <p className="text-xs text-[var(--color-error)] mt-2">{walletError}</p>
            )}
          </Card>
        )}

        {connectedWallet && (
          <Card className="relative z-10 bg-green-50/50 border-green-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-green-100 text-green-700">
                  <CheckIcon />
                </span>
                <div>
                  <p className="font-medium text-green-800">Wallet Connected</p>
                  <p className="text-xs text-green-600 font-mono">{connectedWallet.name} · {connectedWallet.address.slice(0, 10)}...{connectedWallet.address.slice(-6)}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={disconnect} className="text-green-700">
                Disconnect
              </Button>
            </div>
          </Card>
        )}

        <div className="relative z-10 text-center mb-2">
          <p className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            Epoch {harvest.epoch} Observation:
          </p>
          <div className="flex items-center justify-center gap-6 mt-2">
            <div className="flex items-baseline gap-2">
              <span className="p-2 rounded-xl bg-gradient-to-br from-[var(--color-primary)]/20 to-amber-100 text-[var(--color-primary)]">
                <HoneycombIcon />
              </span>
              <div className="text-left">
                <p className="text-2xl font-bold text-[var(--color-text)] tabular-nums flex items-baseline gap-1">
                  {creditsDisplay}
                  <span className="text-xs font-normal text-[var(--color-text-muted)] ml-1">CREDITS</span>
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">Intelligence credits earned</p>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="p-2 rounded-xl bg-gradient-to-br from-amber-100 to-[var(--color-primary)]/20 text-amber-600">
                <ObservationIcon />
              </span>
              <div className="text-left">
                <p className="text-xl font-bold text-[var(--color-text)] tabular-nums flex items-baseline gap-1">
                  {pointsDisplay}
                  <span className="text-xs font-normal text-[var(--color-text-muted)] ml-1">POINTS</span>
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">Observation points</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center mb-6">
          <button 
            className={`relative w-36 h-36 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${
              harvest.isConnected 
                ? 'bg-gradient-to-br from-[var(--color-primary)] to-amber-400 shadow-xl shadow-[var(--color-primary)]/30 animate-pulse-gold'
                : 'bg-[var(--color-border)] shadow-lg'
            }`}
            disabled={!harvest.isConnected}
          >
            <PowerIcon />
          </button>
          <p className="mt-4 text-lg font-bold text-[var(--color-text)]">
            {harvest.isConnected ? 'Node Active' : 'Node Inactive'}
          </p>
        </div>

        {/* Node Status Card */}
        {harvest.userNode && (
          <Card className="relative z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <ServerIcon />
                </span>
                <div>
                  <p className="font-medium text-[var(--color-text)]">Your Node</p>
                  <p className="text-xs text-[var(--color-text-muted)] font-mono">
                    {harvest.userNode.nodeId.slice(0, 12)}...{harvest.userNode.nodeId.slice(-8)}
                  </p>
                </div>
              </div>
              <span className={`badge ${harvest.userNode.eligible ? 'badge-success' : 'badge-warning'}`}>
                {harvest.userNode.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 text-center">
              <div className="p-3 rounded-lg bg-[var(--color-surface-alt)]">
                <p className="text-2xl font-bold text-[var(--color-text)]">{harvest.userNode.beats}</p>
                <p className="text-xs text-[var(--color-text-muted)]">Requests Served</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--color-surface-alt)]">
                <p className="text-2xl font-bold text-[var(--color-text)]">{(harvest.userNode.bytes / 1024 / 1024).toFixed(2)} MB</p>
                <p className="text-xs text-[var(--color-text-muted)]">Data Transferred</p>
              </div>
            </div>
          </Card>
        )}

        <Card className="relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={harvest.isConnected ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}>
                {harvest.isConnected ? <WifiIcon /> : <WifiOffIcon />}
              </span>
              <span className="text-sm font-medium text-[var(--color-text)]">Network Quality:</span>
            </div>
            <span className="text-lg font-bold text-[var(--color-success)]">{harvest.networkQuality}%</span>
          </div>
          <div className="mt-2 h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-primary)] to-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${harvest.networkQuality}%` }}
            />
          </div>
        </Card>

        <div className="relative z-10 text-center">
          <p className="text-sm text-[var(--color-text-muted)] max-w-xs mx-auto">
            {harvest.isConnected 
              ? 'Your node is serving requests. Intelligence flow is optimal for this observation cycle.'
              : 'Connect your node to start contributing observations.'
            }
          </p>
          <p className="text-xs font-mono text-[var(--color-text-muted)] mt-2">
            Device: <span className="font-mono">{harvest.deviceId}</span>
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex gap-3">
            <Button variant="primary" fullWidth onClick={() => navigator.clipboard.writeText('https://bee.network/invite/' + harvest.deviceId)}>
              <span className="relative">COPY INVITE LINK</span>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--color-error)] rounded-full" />
            </Button>
            <Button variant="secondary" fullWidth onClick={refetch}>
              REFRESH
            </Button>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
            <span>Developer Console</span>
            <Link
              href="https://bee.network"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 transition-colors"
              aria-label="Open developer console"
            >
              <ArrowIcon />
            </Link>
          </div>
        </div>

        {/* Wallet Connect Modal */}
        {showWalletModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-slide-up">
            <div className="bg-[var(--surface)] rounded-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">Connect Wallet</h2>
                <button onClick={() => setShowWalletModal(false)} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">Choose a CKB wallet to connect</p>
              <div className="space-y-2">
                {availableWallets.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-[var(--color-text-muted)] mb-3">No compatible wallets detected</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Install UniSat, JoyID, OKX Wallet, or .bit extension</p>
                  </div>
                ) : (
                  availableWallets.map((type: WalletType) => {
                    const wallet = getWallet(type);
                    return (
                      <Button
                        key={type}
                        variant="secondary"
                        fullWidth
                        onClick={() => handleConnectWallet(type)}
                        disabled={isConnecting}
                        className="justify-start gap-3"
                      >
                        <span className="text-2xl">{wallet.icon}</span>
                        <span className="font-medium">{wallet.name}</span>
                      </Button>
                    );
                  })
                )}
              </div>
              {walletError && (
                <p className="text-xs text-[var(--color-error)] mt-3 text-center">{walletError}</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}