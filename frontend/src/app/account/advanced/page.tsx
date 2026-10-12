'use client';

import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui';
import { Button } from '@/components/ui';
import { useBeesData } from '@/hooks/useBeesData';
import { useFiberAccount } from '@/hooks/useFiberAccount';

const WifiIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const TrashIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const ChevronIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const AlertIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const PauseIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ServerIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
  </svg>
);

export default function AdvancedSettings() {
  const { account, lockHash: userLockHash, fiberStatus, fiberError, resetAccount } = useFiberAccount('testnet');
  const { registry, userHarvest, loading } = useBeesData(userLockHash, 'testnet');

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
        <Header title="Advanced Settings" showBack backHref="/account" />
        <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
          <div className="flex flex-col items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--color-primary)] border-t-transparent" />
            <p className="mt-4 text-[var(--color-text-muted)]">Loading settings...</p>
          </div>
        </main>
      </div>
    );
  }

  // Get user's node from registry
  const userNode = userLockHash && registry?.nodes 
    ? registry.nodes.find(n => n.walletLockHash.toLowerCase() === userLockHash.toLowerCase())
    : registry?.nodes[0];

  const isRegistered = !!userNode;

  return (
    <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
      <Header
        title="Advanced Settings"
        showBack
        backHref="/account"
      />

      <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
        <Card>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <PauseIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">PAUSE NODE</span>
            </div>
            <ChevronIcon />
          </div>
          {isRegistered && userNode && (
            <div className="pt-4 border-t border-[var(--color-border)]">
              <p className="text-sm text-[var(--color-text-muted)]">
                Node: <span className="font-mono">{userNode.nodeId.slice(0, 12)}...</span>
              </p>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Requests: {userNode.beats} | Data: {(userNode.bytes / 1024 / 1024).toFixed(2)} MB
              </p>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Status: <span className={userNode.eligible ? 'text-green-600' : 'text-amber-600'}>
                  {userNode.eligible ? 'Eligible for credits' : 'Not eligible'}
                </span>
              </p>
            </div>
          )}
          {!isRegistered && (
            <div className="pt-4 border-t border-[var(--color-border)] text-center text-sm text-[var(--color-text-muted)]">
              {account ? `Fiber ${fiberStatus} — node registration follows automatically.` : 'Creating Web5 account…'}
              {fiberError && <p className="text-xs text-amber-700 mt-1">{fiberError}</p>}
            </div>
          )}
        </Card>

        <Card className="bg-amber-50/50 border-amber-200">
          <div className="flex gap-3">
            <span className="p-2 rounded-lg bg-amber-100 text-amber-700 flex-shrink-0 mt-0.5">
              <AlertIcon />
            </span>
            <div className="flex-1 text-sm text-amber-800">
              <p className="font-medium mb-1">Permanent Action Warning</p>
              <p>
                Deleting your account will permanently remove your node from the network. 
                All unclaimed intelligence credits will be forfeited and cannot be recovered. 
                This action cannot be undone.
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-col items-center">
          <Button variant="destructive" fullWidth className="max-w-xs gap-2" disabled={!isRegistered} onClick={resetAccount}>
            <TrashIcon />
            DELETE ACCOUNT
          </Button>
          {!isRegistered && (
            <p className="text-xs text-[var(--color-text-muted)] mt-2 text-center max-w-xs">
              No registered node found. Your Web5 + Fiber identity is ready; registration follows.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}