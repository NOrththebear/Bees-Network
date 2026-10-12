'use client';

import { Header } from '@/components/layout/Header';
import { FiberPaymentsSection } from '@/components/FiberPaymentsSection';
import { useFiberAccount } from '@/hooks/useFiberAccount';

export default function Payments() {
  const { fiberStatus, channels, peers, lazyState, refresh } = useFiberAccount('testnet');

  return (
    <div className="min-h-screen bg-[var(--surface)] page-pad px-4">
      <Header title="Payments" showBack backHref="/account" />
      <main className="max-w-md mx-auto space-y-6 pt-4 pb-8">
        <FiberPaymentsSection
          network="testnet"
          fiberReady={fiberStatus === 'ready'}
          channels={channels}
          peers={peers}
          lazyState={lazyState}
          onRefresh={refresh}
        />
      </main>
    </div>
  );
}
