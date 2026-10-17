'use client';

import { useEffect, useState } from 'react';
import { useBeesData, formatAmount, formatAmountWithUnit } from '@/hooks/useBeesData';
import { useFiberAccount, formatFiberPubkey } from '@/hooks/useFiberAccount';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui';
import { Card } from '@/components/ui';
import { BeeSplashScreen } from '@/components/BeeSplashScreen';
import { NodeBee } from '@/components/NodeBee';
import Link from 'next/link';

// Absolute failsafe: no matter what stalls underneath (network, workers,
// cached code), the splash can never trap the user for longer than this.
const SPLASH_MAX_MS = 20000;

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

const ArrowIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
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

const ServerIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
  </svg>
);

const BoltIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

export default function Dashboard() {
  const {
    account,
    lockHash,
    fiberPubkey,
    channels,
    peers,
    refresh: refreshFiber,
  } = useFiberAccount('testnet');
  const { userHarvest, loading, error, refetch } = useBeesData(lockHash, 'testnet');
  const [splashExpired, setSplashExpired] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplashExpired(true), SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, []);

  if (loading && !userHarvest && !splashExpired) {
    return <BeeSplashScreen message="LOADING NETWORK DATA" />;
  }

  const harvest = userHarvest || {
    totalHoney: 0n,
    totalNectar: 0n,
    epoch: 0,
    networkQuality: 0,
    deviceId: account?.deviceId ?? 'BEE-XXXX-XXXX-XXXX',
    isConnected: false,
    userShares: [],
    userNode: undefined,
  };

  const creditsDisplay = formatAmountWithUnit(harvest.totalHoney);
  const pointsDisplay = formatAmount(harvest.totalNectar, 0);

  return (
    <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
      <Header title="Dashboard" settingsHref="/account" />

      <main className="max-w-md mx-auto space-y-6 pt-6 pb-8">
        <div className="absolute top-0 left-0 right-0 h-48 pointer-events-none overflow-hidden">
          <div className="honeycomb-bg h-full opacity-30" />
        </div>

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
            aria-label={harvest.isConnected ? 'Node active and serving requests' : 'Node inactive'}
          >
            {harvest.isConnected && (
              <>
                <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-[#FFD76A] opacity-40 animate-ping" />
                <span aria-hidden="true" className="absolute inset-0 rounded-full border border-[#FFE9A8] opacity-30 animate-ping [animation-delay:.7s]" />
              </>
            )}
            <NodeBee active={harvest.isConnected} className="relative w-20 h-auto" />
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
          {account && (
            <p className="text-[11px] font-mono text-[var(--color-text-muted)] mt-1 flex items-center justify-center gap-1">
              <BoltIcon /> Fiber {formatFiberPubkey(fiberPubkey)} · {channels.length} ch · {peers.length} peers
            </p>
          )}
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex gap-3">
            <Button variant="primary" fullWidth onClick={() => navigator.clipboard.writeText('https://bee.network/invite/' + harvest.deviceId)}>
              <span className="relative">COPY INVITE LINK</span>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--color-error)] rounded-full" />
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                refetch();
                refreshFiber();
              }}
            >
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
          {error && <p className="text-xs text-[var(--color-text-muted)] text-center">{error} — showing cached view.</p>}
        </div>
      </main>
    </div>
  );
}
