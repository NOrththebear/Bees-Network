'use client';

/**
 * Lazy inbound channels — ERC-4337-style activation for Bee nodes.
 *
 * Mental model: joining the network is FREE (peer connection only, like a
 * counterfactual account address). The channel is "deployed" lazily during
 * the FIRST payment, opened AND funded by the coordinator hub — the user
 * never signs funding, never locks funds, never clicks more than "claim".
 *
 * Protocol grounding (fiber/ in docs.nervos.org workspace):
 * - Receiver auto-accept: network.rs:1367-1391 — UDT channels auto-accept
 *   with acceptor contribution 0 when `is_udt_type_auto_accept` holds
 *   (contracts.rs:454: whitelisted script + amount >= auto_accept_amount).
 * - CKB channels can NOT zero-accept: channel.rs:get_funding_and_reserved_amount
 *   rejects acceptor funding < reserved_capacity. => rewards MUST be UDT
 *   (RUSD testnet / USDI mainnet) for the zero-cost path.
 * - Pending inbound visibility without event subscription:
 *   rpc/channel.rs:list_channels(only_pending=true) returns in-memory
 *   `to_be_accepted_channels` as NegotiatingFunding entries. fiber-js 0.9.1
 *   TS types omit `only_pending` but the WASM RPC honors it (passthrough).
 * - Payments need ChannelReady (funding confirmed on L1). First payout pays
 *   a one-time confirmation delay ("deployment", hub-paid); the protocol even
 *   retries queued payments on ChannelReady (network.rs ChannelReady scan).
 * - Direction: browsers can't listen, so the user dials the hub (peer
 *   session); the hub opens the channel OVER that session. Hub can never
 *   dial a browser. Users must be online at first-payout time — true for
 *   Bee nodes by design; otherwise payout waits for next online window.
 * - Pending accepts are IN-MEMORY (lost on restart) — the hub must retry
 *   open_channel if no accept lands (see COORDINATOR CONTRACT below).
 *
 * COORDINATOR CONTRACT (hub operator = standard fnn, no custom code):
 *   1. Learn pubkey: POST /bees/v1/nodes {fiber_pubkey, node_id, device_id,
 *      ckb_address} (this module sends it; hub stores mapping).
 *   2. On first reward for an unknown/chanelless pubkey:
 *      open_channel {pubkey, funding_amount >= RUSD auto_accept (1e9),
 *        funding_udt_type_script: RUSD, public: false}
 *      (private: no gossip spam, no routing through user channels).
 *   3. Wait for ChannelReady on the funding outpoint (or rely on the
 *      built-in ChannelReady payment-retry by sending with retries).
 *   4. send_payment {invoice} where invoice = user's reward invoice
 *      (payee pubkey + RUSD script embedded).
 *   5. If accept never lands (user restarted mid-handshake), re-open:
 *      the user polls only_pending and accepts with 0x0, so a second
 *      open_channel after a grace period recovers cleanly; abandon the
 *      stale attempt if needed.
 * Economics: hub locks ~auto_accept_min UDT + CKB capacity per user
 * (like a paymaster stake), amortized over all future streaming
 * micropayments on the same channel. Recycle idle channels via
 * shutdown_channel. Watchtower covers user-offline windows.
 */

import type { NetworkKey } from './config';
import {
  BEES_REWARD_UDT,
  LAZY_CHANNEL,
  beesHubRegistrationUrl,
  ckbNetworkToFiber,
} from './fiber-config';
import { fiberAcceptChannel, fiberListPendingChannels } from './fiber-client';

export type LazyChannelState =
  | { kind: 'no-channel'; detail: string }
  | { kind: 'pending-inbound'; count: number; channelIds: string[] }
  | { kind: 'accepting'; channelIds: string[] }
  | { kind: 'active'; channelIds: string[] }
  | { kind: 'needs-hub'; detail: string };

const REG_OUTBOX_KEY = 'bees_hub_reg_outbox_v1';

interface RegistrationPayload {
  fiber_pubkey: string;
  node_id: string;
  device_id: string;
  ckb_address: string;
  lock_hash: string;
  network: NetworkKey;
  queuedAt: number;
}

/**
 * Best-effort registration with the coordinator hub (HTTP outbox).
 * Never throws — a missing hub only means "first payout waits", the
 * node itself works fully offline otherwise.
 */
export async function registerWithHub(payload: Omit<RegistrationPayload, 'queuedAt'>): Promise<boolean> {
  const url = beesHubRegistrationUrl();
  const body: RegistrationPayload = { ...payload, queuedAt: Date.now() };
  if (!url) {
    enqueueRegistration(body);
    return false;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/bees/v1/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`hub ${res.status}`);
    return true;
  } catch {
    enqueueRegistration(body);
    return false;
  }
}

/** Retry queued registrations (called on each lazy-loop tick). */
export async function flushRegistrationOutbox(): Promise<void> {
  const url = beesHubRegistrationUrl();
  if (!url) return;
  let outbox: RegistrationPayload[] = [];
  try {
    outbox = JSON.parse(localStorage.getItem(REG_OUTBOX_KEY) ?? '[]') as RegistrationPayload[];
  } catch {
    outbox = [];
  }
  if (outbox.length === 0) return;
  const remaining: RegistrationPayload[] = [];
  // Keep only the newest payload per pubkey (registration is idempotent).
  const latest = new Map<string, RegistrationPayload>();
  for (const p of outbox) latest.set(p.fiber_pubkey, p);
  for (const p of latest.values()) {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/bees/v1/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      if (!res.ok) throw new Error(`hub ${res.status}`);
    } catch {
      remaining.push(p);
    }
  }
  try {
    localStorage.setItem(REG_OUTBOX_KEY, JSON.stringify(remaining));
  } catch {
    // storage full/blocked — drop silently, re-queue next tick
  }
}

function enqueueRegistration(p: RegistrationPayload): void {
  try {
    const outbox = JSON.parse(localStorage.getItem(REG_OUTBOX_KEY) ?? '[]') as RegistrationPayload[];
    outbox.push(p);
    localStorage.setItem(REG_OUTBOX_KEY, JSON.stringify(outbox.slice(-20)));
  } catch {
    // ignore — registration is best-effort
  }
}

function isRewardUdtChannel(
  udt: { code_hash: string; hash_type: string; args: string } | undefined,
  network: NetworkKey,
): boolean {
  if (!udt) return false;
  const want = BEES_REWARD_UDT[ckbNetworkToFiber(network)];
  return (
    udt.code_hash.toLowerCase() === want.script.code_hash.toLowerCase() &&
    udt.args.toLowerCase() === want.script.args.toLowerCase()
  );
}

/**
 * One lazy-loop tick: accept any hub-opened UDT channels with 0 contribution.
 * Returns the observed state. CKB-denominated inbound requests are reported
 * (they need user funds — by design we never auto-fund those).
 */
export async function lazyChannelTick(network: NetworkKey): Promise<LazyChannelState> {
  await flushRegistrationOutbox().catch(() => {});
  let pending: Awaited<ReturnType<typeof fiberListPendingChannels>>['channels'] = [];
  try {
    pending = (await fiberListPendingChannels()).channels ?? [];
  } catch {
    return { kind: 'needs-hub', detail: 'light client not ready' };
  }
  if (pending.length === 0) {
    return { kind: 'no-channel', detail: 'no inbound channel yet — created automatically on first reward' };
  }
  const udtOnes = pending.filter((c) => isRewardUdtChannel(c.funding_udt_type_script, network));
  if (udtOnes.length === 0) {
    return {
      kind: 'needs-hub',
      detail: `${pending.length} inbound request(s), none in reward UDT — waiting for hub`,
    };
  }
  const accepted: string[] = [];
  for (const c of udtOnes) {
    try {
      // Zero-contribution accept: hub funded everything (UDT path allows 0,
      // unlike CKB which requires reserved_capacity).
      await fiberAcceptChannel({
        temporary_channel_id: c.channel_id,
        funding_amount: LAZY_CHANNEL.zeroFunding,
      });
      accepted.push(c.channel_id);
    } catch {
      // Hub may have abandoned/retried; next tick reconciles.
    }
  }
  if (accepted.length > 0) {
    return { kind: 'accepting', channelIds: accepted };
  }
  return {
    kind: 'pending-inbound',
    count: udtOnes.length,
    channelIds: udtOnes.map((c) => c.channel_id),
  };
}

/** Start the background lazy loop; returns a stop function. */
export function startLazyChannelLoop(
  network: NetworkKey,
  onState: (s: LazyChannelState) => void,
  intervalMs: number = LAZY_CHANNEL.pollIntervalMs,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = async () => {
    if (stopped || document.hidden) return;
    try {
      onState(await lazyChannelTick(network));
    } catch {
      // never let the loop die on transient RPC errors
    }
  };
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
