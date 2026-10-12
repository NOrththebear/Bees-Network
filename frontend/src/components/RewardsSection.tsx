'use client';

import { ShareData, EpochData } from '@/hooks/useBeesData';

interface RewardsSectionProps {
  shares: ShareData[];
  epochs: EpochData[];
}

export function RewardsSection({ shares, epochs }: RewardsSectionProps) {
  if (shares.length === 0) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold text-[var(--text)] mb-4">Reward Shares</h3>
        <p className="text-[var(--text-muted)]">No reward shares found</p>
      </div>
    );
  }

  const liveShares = shares.filter(s => s.status === 'live');
  const claimedShares = shares.filter(s => s.status === 'claimed');

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text)]">Reward Shares ({shares.length})</h3>
        <div className="flex items-center gap-3">
          <span className="badge badge-success">{liveShares.length} Live</span>
          <span className="badge badge-warning">{claimedShares.length} Claimed</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="pb-2 pr-4">Epoch</th>
              <th className="pb-2 pr-4">Node ID</th>
              <th className="pb-2 pr-4">Wallet</th>
              <th className="pb-2 pr-4">Points (Net/Up)</th>
              <th className="pb-2 pr-4">Bytes</th>
              <th className="pb-2 pr-4">Amount</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((share, i) => (
              <tr key={i} className="border-b border-[var(--border)]/50 last:border-0 hover:bg-[var(--surface-alt)]">
                <td className="py-2 pr-4 font-mono text-[var(--text)] tabular-nums">#{share.epochId}</td>
                <td className="py-2 pr-4 font-mono text-[var(--text)] truncate max-w-[100px]">{share.nodeId.slice(0, 14)}…</td>
                <td className="py-2 pr-4 font-mono text-[var(--text-muted)] truncate max-w-[100px]">{share.walletLockHash.slice(0, 14)}…</td>
                <td className="py-2 pr-4 text-[var(--text)] tabular-nums">{share.netPts} / {share.upPts}</td>
                <td className="py-2 pr-4 text-[var(--text)] tabular-nums">{formatBytes(share.bytes)}</td>
                <td className="py-2 pr-4 text-[var(--text)] tabular-nums">{formatCKB(share.amount)} CKB</td>
                <td className="py-2 pr-4">
                  <span className={`badge ${share.status === 'live' ? 'badge-success' : 'badge-warning'}`}>
                    {share.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <h4 className="text-sm font-medium text-[var(--text)] mb-3">Claim Verification</h4>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          To claim rewards, the node operator provides a Merkle proof for their share leaf.
          The Rewards Lock script verifies the proof against the epoch's rewards_root,
          cross-checks the Epoch Cell in CellDeps, and enforces wallet-bound payout.
        </p>
        <div className="bg-[var(--surface-alt)] rounded-lg p-4 font-mono text-xs text-[var(--text-muted)] overflow-x-auto">
          <pre>{`// Claim witness (input_type):
// proof = concatenated 32-byte siblings
// RewardsLock verifies: fold(leaf, proof) == rewards_root
// Requires: Epoch Cell in cell_deps with matching rewards_root
// Output lock == share.wallet_lock_hash (anti-theft)`}</pre>
        </div>
      </div>
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
  return ckb.toLocaleString(undefined, { maximumFractionDigits: 4 });
}