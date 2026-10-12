'use client';

import { RegistryData } from '@/hooks/useBeesData';

interface RegistrySectionProps {
  registry: RegistryData | null;
}

export function RegistrySection({ registry }: RegistrySectionProps) {
  if (!registry) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold text-[var(--text)] mb-4">Registry</h3>
        <p className="text-[var(--text-muted)]">No registry found on this network</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text)]">Registry</h3>
        <span className="badge badge-success">{registry.nodes.length} nodes</span>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-[var(--text-muted)]">Registry ID</span>
          <code className="font-mono text-[var(--text)] truncate max-w-[200px]">{registry.registryId}</code>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[var(--text-muted)]">Operator Lock</span>
          <code className="font-mono text-[var(--text)] truncate max-w-[200px]">{registry.operatorLockHash}</code>
        </div>
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-medium text-[var(--text)] mb-3">Registered Nodes</h4>
        {registry.nodes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-4">No nodes registered yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="pb-2 pr-4">Node ID</th>
                  <th className="pb-2 pr-4">Wallet</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Beats</th>
                  <th className="pb-2">Bytes</th>
                </tr>
              </thead>
              <tbody>
                {registry.nodes.map((node, i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[var(--text)] truncate max-w-[120px]">{node.nodeId.slice(0, 14)}…</td>
                    <td className="py-2 pr-4 font-mono text-[var(--text-muted)] truncate max-w-[120px]">{node.walletLockHash.slice(0, 14)}…</td>
                    <td className="py-2 pr-4">
                      <span className={`badge ${node.eligible ? 'badge-success' : 'badge-warning'}`}>
                        {node.eligible ? 'Eligible' : 'Ineligible'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--text)] tabular-nums">{node.beats.toLocaleString()}</td>
                    <td className="py-2 text-[var(--text)] tabular-nums">{formatBytes(node.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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