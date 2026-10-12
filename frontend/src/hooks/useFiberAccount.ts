'use client';

/**
 * Web5 account hook: one Bee account automatically provisions a Fiber account.
 *
 * - First visit: generates fiberKeyPair + ckbSecretKey, derives CKB lock/address,
 *   derives Bee nodeId = nodeIdFor(lockHash, deviceId), persists everything.
 * - Then starts the in-browser Fiber light client in the background and
 *   connects to WSS bootnodes (nodes are expected online most of the time,
 *   so the light client stays usable for instant payments).
 * - No extension-wallet popup is required for identity or for receiving rewards.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetworkKey } from '@/lib/config';
import { nodeIdFor } from '@/lib/bees';
import {
  ensureFiberKeys,
  deriveFiberIdentity,
  deriveLockHashSync,
  clearFiberKeys,
} from '@/lib/fiber-keys';
import {
  ensureFiberStarted,
  fiberNodeInfo,
  fiberListPeers,
  fiberListChannels,
  fiberConnectBootnodes,
  fiberConnectPeer,
  getFiberStatus,
  type FiberStatus,
} from '@/lib/fiber-client';
import { BEES_HUB, FIBER_BOOTNODES, ckbNetworkToFiber } from '@/lib/fiber-config';
import {
  registerWithHub,
  startLazyChannelLoop,
  type LazyChannelState,
} from '@/lib/fiber-lazy';

export interface FiberAccount {
  deviceId: string;
  lockHash: string;
  lockArgs: string;
  ckbAddress: string;
  nodeId: string;
  fiberPubkey: string | null;
}

interface ChannelSummary {
  channel_id: string;
  peerPubkey: string;
  local_balance: string;
  remote_balance: string;
  is_public: boolean;
  state_name?: string;
}

interface PeerSummary {
  pubkey: string;
  address: string;
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem('bees_device_id');
  if (!id) {
    const rand = Array.from({ length: 12 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
    id = `BEE-${rand.match(/.{1,4}/g)?.join('-') ?? 'XXXX-XXXX-XXXX'}`;
    localStorage.setItem('bees_device_id', id);
  }
  return id;
}

function createAccountSync(): FiberAccount | null {
  if (typeof window === 'undefined') return null;
  const deviceId = getOrCreateDeviceId();
  const keys = ensureFiberKeys();
  const { lockScript, lockHash } = deriveLockHashSync(keys.ckbSecretKeyHex);
  const nodeId = nodeIdFor(lockHash, deviceId);
  return {
    deviceId,
    lockHash,
    lockArgs: lockScript.args,
    ckbAddress: '',
    nodeId,
    fiberPubkey: null,
  };
}

export function useFiberAccount(network: NetworkKey = 'testnet') {
  // Lazy initializer (runs during render, not in an effect): instant account
  // so the dashboard can query registry/epoch cells before WASM loads.
  const [account, setAccount] = useState<FiberAccount | null>(createAccountSync);
  const [fiberStatus, setFiberStatus] = useState<FiberStatus>('idle');
  const [fiberError, setFiberError] = useState<string | null>(null);
  const [fiberPubkey, setFiberPubkey] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [lazyState, setLazyState] = useState<LazyChannelState>({
    kind: 'no-channel',
    detail: 'starting…',
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startingRef = useRef(false);

  // Resolve CKB address async (CCC import) without blocking first paint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = ensureFiberKeys();
        const id = await deriveFiberIdentity(keys.ckbSecretKeyHex, network);
        if (!cancelled) {
          setAccount((prev) =>
            prev ? { ...prev, ckbAddress: id.ckbAddress, lockHash: id.lockHash } : prev,
          );
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Account creation failed';
          // Defer to avoid sync setState-in-effect cascade.
          queueMicrotask(() => setFiberError(msg));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [network]);

  const refreshFiberState = useCallback(async () => {
    try {
      const info = await fiberNodeInfo().catch(() => null);
      if (info?.pubkey) {
        setFiberPubkey(info.pubkey as string);
        setAccount((prev) => (prev ? { ...prev, fiberPubkey: info.pubkey as string } : prev));
      }
      const peerRes = await fiberListPeers().catch(() => null);
      if (peerRes?.peers) {
        setPeers(
          (peerRes.peers as Array<{ pubkey: string; address: string }>).map((p) => ({
            pubkey: p.pubkey,
            address: p.address,
          })),
        );
      }
      const chanRes = await fiberListChannels({}).catch(() => null);
      if (chanRes?.channels) {
        setChannels(
          (chanRes.channels as Array<Record<string, unknown>>).map((c) => ({
            channel_id: String(c.channel_id ?? ''),
            peerPubkey: String((c as { pubkey?: string }).pubkey ?? ''),
            local_balance: String((c as { local_balance?: string }).local_balance ?? '0x0'),
            remote_balance: String((c as { remote_balance?: string }).remote_balance ?? '0x0'),
            is_public: Boolean((c as { is_public?: boolean }).is_public),
            state_name: String(
              ((c as { state?: { state_name?: string } }).state?.state_name ?? ''),
            ),
          })),
        );
      }
    } catch {
      // best-effort refresh; status surface stays on the card
    }
  }, []);

  // Step 2 (async, background): start Fiber WASM + connect bootnodes (+ hub
  // so the hub can later open the lazy channel over that peer session).
  useEffect(() => {
    if (!account || startingRef.current) return;
    startingRef.current = true;
    setFiberStatus('starting');
    let stopLazy: (() => void) | null = null;

    (async () => {
      try {
        const keys = ensureFiberKeys();
        await ensureFiberStarted({
          network,
          deviceId: account.deviceId,
          fiberKeyPairHex: keys.fiberKeyPairHex,
          ckbSecretKeyHex: keys.ckbSecretKeyHex,
        });
        setFiberStatus('ready');
        setFiberError(null);
        const fiberNet = ckbNetworkToFiber(network);
        await fiberConnectBootnodes(FIBER_BOOTNODES[fiberNet]);
        // Dial the coordinator hub too (user -> hub direction; browsers
        // can't listen). No channel yet — just the P2P session the hub
        // will use to open the lazy channel on first reward.
        const hub = BEES_HUB[fiberNet];
        if (hub?.pubkey) {
          try {
            if (hub.address) await fiberConnectPeer({ address: hub.address, save: true });
            else await fiberConnectPeer({ pubkey: hub.pubkey, save: true });
          } catch {
            // hub not deployed yet — bootnode session is enough for now
          }
        }
        await refreshFiberState();
        // Arm the lazy inbound loop: hub-opened UDT channels auto-accept
        // with 0 contribution, zero user steps.
        stopLazy = startLazyChannelLoop(network, (s) => {
          setLazyState(s);
          if (s.kind === 'accepting' || s.kind === 'pending-inbound') void refreshFiberState();
        });
        // Tell the hub who we are (best-effort outbox; never blocks).
        const info = await fiberNodeInfo().catch(() => null);
        const pubkey = (info as { pubkey?: string } | null)?.pubkey;
        if (pubkey && account) {
          void registerWithHub({
            fiber_pubkey: pubkey,
            node_id: account.nodeId,
            device_id: account.deviceId,
            ckb_address: account.ckbAddress,
            lock_hash: account.lockHash,
            network,
          });
        }
      } catch (err) {
        const { status, error } = getFiberStatus();
        setFiberStatus(status === 'idle' ? 'error' : status);
        setFiberError(error ?? (err instanceof Error ? err.message : String(err)));
      }
    })();
    return () => {
      stopLazy?.();
    };
  }, [account, network, refreshFiberState]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshFiberState();
      setFiberStatus(getFiberStatus().status);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshFiberState]);

  const resetAccount = useCallback(async () => {
    const { stopFiber } = await import('@/lib/fiber-client');
    await stopFiber();
    clearFiberKeys();
    localStorage.removeItem('bees_device_id');
    startingRef.current = false;
    setAccount(null);
    setFiberPubkey(null);
    setChannels([]);
    setPeers([]);
    setLazyState({ kind: 'no-channel', detail: 'account reset — new identity' });
    // Re-create fresh (Web5: a new account = a new Fiber identity).
    const deviceId = getOrCreateDeviceId();
    const keys = ensureFiberKeys();
    const { lockScript, lockHash } = deriveLockHashSync(keys.ckbSecretKeyHex);
    setAccount({
      deviceId,
      lockHash,
      lockArgs: lockScript.args,
      ckbAddress: '',
      nodeId: nodeIdFor(lockHash, deviceId),
      fiberPubkey: null,
    });
  }, []);

  return {
    account,
    // Drop-in replacements for the old wallet flow:
    lockHash: account?.lockHash,
    nodeId: account?.nodeId,
    deviceId: account?.deviceId,
    fiberPubkey,
    fiberStatus,
    fiberError,
    channels,
    peers,
    lazyState,
    isRefreshing,
    isReady: fiberStatus === 'ready',
    refresh,
    resetAccount,
  };
}

export function formatFiberPubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return '—';
  return `${pubkey.slice(0, 10)}…${pubkey.slice(-6)}`;
}
