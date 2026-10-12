'use client';

/**
 * Fiber payments screen (Account → Payments).
 *
 * Deliberately lean: rewards arrive automatically over the hub-opened lazy
 * channel, so there is no invoice creation here. This panel covers channel
 * status and sending.
 */

import { useState } from 'react';
import { Card, Button, Input } from './ui';
import {
  fiberSendPayment,
  fiberGetPayment,
  fiberOpenChannel,
  fiberConnectPeer,
} from '@/lib/fiber-client';
import { fromHexU128, toHexU128, FIBER_PUBLIC_NODES, ckbNetworkToFiber } from '@/lib/fiber-config';
import type { LazyChannelState } from '@/lib/fiber-lazy';
import type { NetworkKey } from '@/lib/config';

interface Props {
  network: NetworkKey;
  fiberReady: boolean;
  channels: Array<{ channel_id: string; peerPubkey: string; local_balance: string; remote_balance: string; is_public: boolean; state_name?: string }>;
  peers: Array<{ pubkey: string; address: string }>;
  lazyState: LazyChannelState;
  onRefresh: () => void;
}

function lazyLine(lazyState: LazyChannelState): string {
  switch (lazyState.kind) {
    case 'no-channel':
      return 'No channel yet — one opens automatically on your first reward.';
    case 'pending-inbound':
      return 'Reward channel incoming — accepting…';
    case 'accepting':
      return 'Channel accepted — confirming on-chain (one-time).';
    case 'active':
      return 'Reward channel active.';
    case 'needs-hub':
      return lazyState.detail;
  }
}

export function FiberPaymentsSection({ network, fiberReady, channels, peers, lazyState, onRefresh }: Props) {
  const [payInvoice, setPayInvoice] = useState('');
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!payInvoice.trim()) return;
    setBusy('pay');
    setError(null);
    setPayStatus('Sending…');
    try {
      const res = await fiberSendPayment({ invoice: payInvoice.trim() });
      const hash = (res as { payment_hash?: string }).payment_hash ?? '';
      setPayStatus(`Sent (${(res as { status?: string }).status ?? 'unknown'})`);
      if (hash) {
        setTimeout(async () => {
          try {
            const p = await fiberGetPayment(hash as `0x${string}`);
            setPayStatus(`Status: ${(p as { status?: string }).status ?? '?'}`);
          } catch {
            // ignore poll errors
          }
        }, 3000);
      }
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPayStatus(null);
    } finally {
      setBusy(null);
    }
  };

  const handleOpenChannel = async (pubkey: string) => {
    setBusy(`open-${pubkey}`);
    setError(null);
    try {
      await fiberOpenChannel({
        pubkey,
        funding_amount: toHexU128(60_000_000_000n),
        public: true,
      });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = async (pubkey: string) => {
    setBusy(`peer-${pubkey}`);
    setError(null);
    try {
      await fiberConnectPeer({ pubkey, save: true });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const publicNodes = FIBER_PUBLIC_NODES[ckbNetworkToFiber(network)];

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">Payments</h3>
        <span className={`badge ${fiberReady ? 'badge-success' : 'badge-warning'}`}>
          {fiberReady ? `${channels.length} ch · ${peers.length} peers` : 'Starting…'}
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">{lazyLine(lazyState)}</p>

      {channels.length > 0 && (
        <div className="space-y-2 mb-4">
          {channels.slice(0, 5).map((c) => (
            <div key={c.channel_id} className="p-2 rounded-lg bg-[var(--color-surface-alt)] text-xs font-mono">
              <p className="truncate text-[var(--color-text)]">{c.channel_id.slice(0, 24)}…</p>
              <p className="text-[var(--color-text-muted)]">
                {(Number(fromHexU128(c.local_balance)) / 1e8).toFixed(2)} /{' '}
                {(Number(fromHexU128(c.remote_balance)) / 1e8).toFixed(2)} CKB · {c.state_name || '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">Send</h4>
      <Input value={payInvoice} onChange={(e) => setPayInvoice(e.target.value)} placeholder="Paste invoice…" />
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        className="mt-2"
        disabled={!fiberReady || busy !== null || !payInvoice.trim()}
        onClick={handlePay}
      >
        {busy === 'pay' ? 'Sending…' : 'Pay'}
      </Button>
      {payStatus && <p className="text-xs font-mono mt-2 text-[var(--color-text)]">{payStatus}</p>}

      <details className="mt-4">
        <summary className="text-sm text-[var(--color-text-muted)] cursor-pointer">Advanced: manual channel</summary>
        <div className="space-y-2 mt-2">
          {publicNodes.map((n) => (
            <div key={n.pubkey} className="flex items-center gap-2 text-xs">
              <span className="font-mono truncate flex-1 text-[var(--color-text-muted)]">{n.name}</span>
              <Button variant="secondary" size="sm" disabled={!fiberReady || busy !== null} onClick={() => handleConnect(n.pubkey)}>
                {busy === `peer-${n.pubkey}` ? '…' : 'Connect'}
              </Button>
              <Button variant="primary" size="sm" disabled={!fiberReady || busy !== null} onClick={() => handleOpenChannel(n.pubkey)}>
                {busy === `open-${n.pubkey}` ? '…' : 'Open'}
              </Button>
            </div>
          ))}
        </div>
      </details>

      {error && <p className="text-xs text-[var(--color-error)] mt-3">{error}</p>}
    </Card>
  );
}
