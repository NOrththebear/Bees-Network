'use client';

import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui';
import { Card } from '@/components/ui';
import { useBeesData } from '@/hooks/useBeesData';
import { useFiberAccount, formatFiberPubkey } from '@/hooks/useFiberAccount';
import { formatAmountWithUnit } from '@/hooks/useBeesData';

const UserIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const MailIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const ChevronIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const InfoIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ChatIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const GearIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
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

const HistoryIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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

const BoltIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

export default function Account() {
  const { account, lockHash: userLockHash, fiberPubkey, fiberStatus, channels } = useFiberAccount('testnet');
  const { registry, userHarvest, loading, error } = useBeesData(userLockHash, 'testnet');

  const deviceId = account?.deviceId
    ?? (typeof window !== 'undefined'
      ? localStorage.getItem('bees_device_id') || 'BEE-7X9K-M2P4'
      : 'BEE-7X9K-M2P4');

  // Get user's node from registry (match by Fiber-derived lock hash)
  const userNode = userLockHash && registry?.nodes
    ? registry.nodes.find(n => n.walletLockHash.toLowerCase() === userLockHash.toLowerCase())
    : registry?.nodes[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
        <Header title="Account" showBack backHref="/" />
        <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
          <div className="flex flex-col items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--color-primary)] border-t-transparent" />
            <p className="mt-4 text-[var(--color-text-muted)]">Loading account...</p>
          </div>
        </main>
      </div>
    );
  }

  const creditsDisplay = formatAmountWithUnit(userHarvest?.totalHoney || 0n);
  const pointsDisplay = formatAmountWithUnit(userHarvest?.totalNectar || 0n);

  return (
    <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
      <Header
        title="Account"
        showBack
        backHref="/"
      />

      <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
        {/* Web5 Account / Fiber identity */}
        <Card>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-green-100 text-green-700">
                  <CheckIcon />
                </span>
                <div>
                  <p className="text-sm text-green-600">Web5 Account · Fiber {fiberStatus}</p>
                  <p className="font-medium text-green-800 font-mono text-xs">
                    {formatFiberPubkey(fiberPubkey)} · {channels.length} channels
                  </p>
                </div>
              </div>
              <ChevronIcon />
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <MailIcon />
                </span>
                <div>
                  <p className="text-sm text-[var(--color-text-muted)]">CKB Address (auto-created)</p>
                  <p className="font-medium text-[var(--color-text)] truncate max-w-[200px] font-mono text-xs">
                    {account?.ckbAddress || 'Deriving…'}
                  </p>
                </div>
              </div>
              <ChevronIcon />
            </div>

            {userNode && (
              <>
                <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                      <ServerIcon />
                    </span>
                    <div>
                      <p className="text-sm text-[var(--color-text-muted)]">Node ID</p>
                      <p className="font-medium text-[var(--color-text)] font-mono text-xs truncate max-w-[200px]">
                        {userNode.nodeId.slice(0, 16)}...
                      </p>
                    </div>
                  </div>
                  <span className={`badge ${userNode.eligible ? 'badge-success' : 'badge-warning'}`}>
                    {userNode.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                      <HistoryIcon />
                    </span>
                    <div>
                      <p className="text-sm text-[var(--color-text-muted)]">Node Stats</p>
                      <p className="font-medium text-[var(--color-text)]">
                        {userNode.beats} requests · {(userNode.bytes / 1024 / 1024).toFixed(2)} MB transferred
                      </p>
                    </div>
                  </div>
                  <ChevronIcon />
                </div>
              </>
            )}
            
            {!userNode && (
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                    <ServerIcon />
                  </span>
                  <div>
                    <p className="text-sm text-[var(--color-text-muted)]">Node ID</p>
                    <p className="font-medium text-[var(--color-text)] font-mono text-xs truncate max-w-[200px]">
                      {account ? 'Registering…' : 'Not registered'}
                    </p>
                  </div>
                </div>
                <ChevronIcon />
              </div>
            )}
          </div>
        </Card>

        {/* Observation Summary */}
        {userHarvest && userHarvest.isConnected && (
          <Card className="bg-gradient-to-r from-[var(--color-primary)]/5 to-amber-50 border-[var(--color-primary)]/20">
            <p className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Current Observation (Epoch {userHarvest.epoch})</p>
            <div className="flex gap-4">
              <div className="flex-1">
                <p className="text-2xl font-bold text-[var(--color-text)]">{creditsDisplay}</p>
                <p className="text-xs text-[var(--color-text-muted)]">INTELLIGENCE CREDITS</p>
              </div>
              <div className="flex-1">
                <p className="text-xl font-bold text-[var(--color-text)]">{pointsDisplay}</p>
                <p className="text-xs text-[var(--color-text-muted)]">OBSERVATION POINTS</p>
              </div>
            </div>
          </Card>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" fullWidth>
            <InfoIcon className="w-4 h-4" />
            FAQ
          </Button>
          <Button variant="secondary" fullWidth>
            <InfoIcon className="w-4 h-4" />
            ABOUT BEE NETWORK
          </Button>
        </div>

        <div className="text-center">
          <p className="text-sm text-[var(--color-text-muted)] max-w-xs mx-auto">
            Need help? Reach out via our support channel in the Developer Console.
          </p>
        </div>

        <Card>
          <div className="space-y-0">
            <Link
              href="/account/payments"
              className="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0 transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <BoltIcon />
                </span>
                <span className="font-medium text-[var(--color-text)]">Payments</span>
              </div>
              <ChevronIcon />
            </Link>
            <Link
              href="/account/advanced"
              className="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0 transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <GearIcon />
                </span>
                <span className="font-medium text-[var(--color-text)]">Advanced Settings</span>
              </div>
              <ChevronIcon />
            </Link>
            <Link
              href="/account/settings"
              className="flex items-center justify-between py-3 transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <GearIcon />
                </span>
                <span className="font-medium text-[var(--color-text)]">App Settings</span>
              </div>
              <ChevronIcon />
            </Link>
          </div>
        </Card>

        <div className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-3 text-xs text-[var(--color-text-muted)]">
            <Link href="#" className="hover:text-[var(--color-primary)] transition-colors">Privacy Policy</Link>
            <span>|</span>
            <Link href="#" className="hover:text-[var(--color-primary)] transition-colors">Terms & Conditions</Link>
          </div>
          <div className="flex items-center justify-center gap-3 text-xs text-[var(--color-text-muted)]">
            <Link href="#" className="hover:text-[var(--color-primary)] transition-colors">Uninstallation Guide</Link>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Bee Network v1.0.0 · Device: <span className="font-mono">{deviceId}</span>
          </p>
        </div>
      </main>
    </div>
  );
}