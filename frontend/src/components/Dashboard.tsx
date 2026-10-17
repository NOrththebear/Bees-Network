'use client';

import { useBeesData } from '@/hooks/useBeesData';
import { useFiberAccount } from '@/hooks/useFiberAccount';
import { StatsGrid } from './StatsGrid';
import { RegistrySection } from './RegistrySection';
import { EpochsSection } from './EpochsSection';
import { RewardsSection } from './RewardsSection';
import { BRAND } from '@/lib/config';

export function Dashboard() {
  const { lockHash } = useFiberAccount('testnet');
  const { registry, epochs, shares, activity, loading, error, refetch } = useBeesData(lockHash, 'testnet');

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-[var(--border)] rounded w-3/4 mb-2"></div>
              <div className="h-8 bg-[var(--border)] rounded w-1/2"></div>
            </div>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card animate-pulse h-64"></div>
          <div className="card animate-pulse h-64"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <div className="card-elevated max-w-md mx-auto">
          <svg className="w-12 h-12 mx-auto text-[var(--error)] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-lg font-semibold text-[var(--text)] mb-2">Failed to Load Data</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">{error}</p>
          <button onClick={refetch} className="btn-primary">Retry</button>
        </div>
      </div>
    );
  }

  const totalNodes = registry?.nodes.length || 0;
  const eligibleNodes = registry?.nodes.filter(n => n.eligible).length || 0;
  const totalEpochs = epochs.length;
  const latestEpoch = epochs[0];
  const totalShares = shares.length;
  const claimedShares = shares.filter(s => s.status === 'claimed').length;
  const liveShares = shares.filter(s => s.status === 'live').length;
  const totalPool = epochs.reduce((sum, e) => sum + e.pool, 0n);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text)]">Network Overview</h2>
            <p className="text-[var(--text-muted)] mt-1">Real-time data from Pudge Testnet</p>
          </div>
          <button onClick={refetch} className="btn-secondary" disabled={loading}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        <StatsGrid
          stats={[
            { label: 'Registered Nodes', value: totalNodes, subValue: `${eligibleNodes} eligible`, icon: 'nodes' },
            {
              label: 'Requests Served',
              value: activity ? activity.requestsServed.toLocaleString() : '—',
              subValue: activity ? `${activity.activeNodes} active now` : 'telemetry offline',
              icon: 'requests',
            },
            {
              label: 'Data Transferred',
              value: activity ? formatBytes(activity.dataTransferred) : '—',
              subValue: activity ? `${activity.tasksIssued.toLocaleString()} tasks issued` : 'telemetry offline',
              icon: 'data',
            },
            { label: 'Epochs Closed', value: totalEpochs, subValue: latestEpoch ? `Latest: #${latestEpoch.epochId}` : '—', icon: 'epochs' },
            { label: 'Reward Shares', value: totalShares, subValue: `${liveShares} live • ${claimedShares} claimed`, icon: 'shares' },
            { label: 'Total Pool', value: formatCKB(totalPool), subValue: 'CKB across epochs', icon: 'pool' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RegistrySection registry={registry} live={activity?.perNode} />
        <EpochsSection epochs={epochs} />
      </div>

      <RewardsSection shares={shares} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} KB`;
  return `${bytes} B`;
}

function formatCKB(shannons: bigint): string {
  const ckb = Number(shannons) / 100_000_000;
  if (ckb >= 1_000_000) return `${(ckb / 1_000_000).toFixed(2)}M`;
  if (ckb >= 1_000) return `${(ckb / 1_000).toFixed(2)}K`;
  return ckb.toLocaleString(undefined, { maximumFractionDigits: 4 });
}