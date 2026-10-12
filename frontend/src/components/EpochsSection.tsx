'use client';

import { EpochData } from '@/hooks/useBeesData';

interface EpochsSectionProps {
  epochs: EpochData[];
}

export function EpochsSection({ epochs }: EpochsSectionProps) {
  if (epochs.length === 0) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold text-[var(--text)] mb-4">Epochs</h3>
        <p className="text-[var(--text-muted)]">No epochs closed yet</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-[var(--text)] mb-4">Epochs ({epochs.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="pb-2 pr-4">Epoch</th>
              <th className="pb-2 pr-4">Merkle Root</th>
              <th className="pb-2 pr-4">Pool</th>
              <th className="pb-2 pr-4">Rewards Root</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {epochs.map((epoch) => (
              <tr key={epoch.epochId} className="border-b border-[var(--border)]/50 last:border-0 hover:bg-[var(--surface-alt)]">
                <td className="py-3 pr-4 font-mono text-[var(--text)] tabular-nums">#{epoch.epochId}</td>
                <td className="py-3 pr-4 font-mono text-[var(--text-muted)] truncate max-w-[140px]">{epoch.merkleRoot}</td>
                <td className="py-3 pr-4 text-[var(--text)] tabular-nums">{formatCKB(epoch.pool)} CKB</td>
                <td className="py-3 pr-4 font-mono text-[var(--text-muted)] truncate max-w-[140px]">{epoch.rewardsRoot}</td>
                <td className="py-3 pr-4">
                  <span className={`badge ${epoch.status === 'live' ? 'badge-success' : 'badge-error'}`}>
                    {epoch.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <h4 className="text-sm font-medium text-[var(--text)] mb-2">Latest Epoch Details</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-muted)]">Merkle Root</p>
            <code className="font-mono text-[var(--text)] break-all">{epochs[0].merkleRoot}</code>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Evidence Hash</p>
            <code className="font-mono text-[var(--text)] break-all">{epochs[0].evidenceHash}</code>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Rewards Root</p>
            <code className="font-mono text-[var(--text)] break-all">{epochs[0].rewardsRoot}</code>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Pool</p>
            <code className="font-mono text-[var(--text)]">{formatCKB(epochs[0].pool)} CKB</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCKB(shannons: bigint): string {
  const ckb = Number(shannons) / 100_000_000;
  return ckb.toLocaleString(undefined, { maximumFractionDigits: 4 });
}