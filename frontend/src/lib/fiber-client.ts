'use client';

/**
 * Singleton manager for the in-browser Fiber light client (@nervosnetwork/fiber-js).
 *
 * Design notes:
 * - fiber-js bundles WASM + 2 Web Workers and requires SharedArrayBuffer
 *   (Cross-Origin-Isolated via COOP/COEP headers in next.config.ts).
 * - Must only run on the client: all imports are dynamic inside ensureStarted().
 * - One instance per device (keyed by fiberDbPrefix(deviceId)).
 * - All RPCs degrade gracefully: if WASM/COOP is unavailable we report
 *   `unsupported` instead of crashing the dashboard.
 */

import type { NetworkKey } from './config';
import {
  browserizeFiberConfig,
  ckbNetworkToFiber,
  fiberCkbRpcUrl,
  fiberDbPrefix,
} from './fiber-config';

// Loose types so we don't hard-depend on fiber-js type exports at build time.
export type FiberStatus = 'idle' | 'starting' | 'ready' | 'error' | 'unsupported';

interface FiberInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

let fiber: FiberInstance | null = null;
let status: FiberStatus = 'idle';
let statusError: string | null = null;
let startPromise: Promise<FiberInstance> | null = null;
let startedDbPrefix: string | null = null;

export function getFiberStatus(): { status: FiberStatus; error: string | null } {
  return { status, error: statusError };
}

export function isCrossOriginIsolatedReady(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof SharedArrayBuffer === 'undefined') return false;
  // crossOriginIsolated is false when COOP/COEP headers are missing.
  return (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

function toBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function ensureFiberStarted(opts: {
  network: NetworkKey;
  deviceId: string;
  fiberKeyPairHex: string;
  ckbSecretKeyHex: string;
}): Promise<FiberInstance> {
  if (fiber && status === 'ready' && startedDbPrefix === fiberDbPrefix(opts.deviceId)) {
    return fiber;
  }
  if (startPromise && startedDbPrefix === fiberDbPrefix(opts.deviceId)) {
    return startPromise;
  }

  startedDbPrefix = fiberDbPrefix(opts.deviceId);
  status = 'starting';
  statusError = null;

  startPromise = (async () => {
    if (typeof window === 'undefined') {
      throw new Error('Fiber requires a browser environment');
    }
    if (typeof SharedArrayBuffer === 'undefined') {
      throw Object.assign(new Error('SharedArrayBuffer unavailable — Fiber needs COOP/COEP headers'), {
        code: 'UNSUPPORTED',
      });
    }

    const mod = await import('@nervosnetwork/fiber-js');
    const instance = new mod.Fiber() as FiberInstance;

    // Prefer the bundled default config (v0.9.1+), fall back to embedded YAML.
    // The bundled config ships TCP-only bootnodes, which browsers cannot
    // dial — rewrite them to the same peers' WSS endpoints first.
    const fiberNet = ckbNetworkToFiber(opts.network);
    const ckbRpc = fiberCkbRpcUrl(opts.network);
    let configYaml: string;
    if (typeof instance.getDefaultConfig === 'function') {
      configYaml = browserizeFiberConfig(instance.getDefaultConfig(fiberNet, ckbRpc), fiberNet);
    } else {
      configYaml = fallbackTestnetConfig(ckbRpc);
    }

    await instance.start(
      configYaml,
      toBytes(opts.fiberKeyPairHex),
      toBytes(opts.ckbSecretKeyHex),
      undefined,
      'info',
      fiberDbPrefix(opts.deviceId),
    );
    fiber = instance;
    status = 'ready';
    return instance;
  })().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    if (code === 'UNSUPPORTED' || /SharedArrayBuffer|cross-origin|isolat/i.test(msg)) {
      status = 'unsupported';
    } else {
      status = 'error';
    }
    statusError = msg;
    startPromise = null;
    throw err;
  });

  return startPromise;
}

export async function stopFiber(): Promise<void> {
  try {
    await fiber?.stop?.();
  } catch {
    // ignore
  } finally {
    fiber = null;
    startPromise = null;
    startedDbPrefix = null;
    status = 'idle';
    statusError = null;
  }
}

export function requireFiber(): FiberInstance {
  if (!fiber || status !== 'ready') {
    throw new Error(`Fiber not ready (status=${status}${statusError ? `: ${statusError}` : ''})`);
  }
  return fiber;
}

// ---------------------------------------------------------------------------
// Typed RPC helpers (thin wrappers over invokeCommand, matching
// crates/fiber-lib/src/rpc/README.md)
// ---------------------------------------------------------------------------

export async function fiberNodeInfo() {
  return requireFiber().nodeInfo();
}

export async function fiberListPeers() {
  return requireFiber().listPeers();
}

export async function fiberConnectPeer(params: { address?: string; pubkey?: string; save?: boolean }) {
  return requireFiber().connectPeer(params);
}

export async function fiberListChannels(params: { pubkey?: string; include_closed?: boolean } = {}) {
  return requireFiber().listChannels(params);
}

/**
 * Pending inbound channels (hub opened TO us, awaiting local accept).
 * The WASM RPC supports `only_pending` (rpc/channel.rs) even though the
 * fiber-js 0.9.1 TS type doesn't declare it yet — passthrough works.
 */
export async function fiberListPendingChannels(): Promise<{
  channels: Array<{
    channel_id: string;
    pubkey: string;
    funding_udt_type_script?: { code_hash: string; hash_type: string; args: string };
    local_balance: string;
    remote_balance: string;
    state: { state_name: string; state_flags: string };
    is_public: boolean;
    created_at: string;
  }>;
}> {
  const res = await requireFiber().invokeCommand('list_channels', [
    { only_pending: true },
  ]);
  return res as {
    channels: Array<{
      channel_id: string;
      pubkey: string;
      funding_udt_type_script?: { code_hash: string; hash_type: string; args: string };
      local_balance: string;
      remote_balance: string;
      state: { state_name: string; state_flags: string };
      is_public: boolean;
      created_at: string;
    }>;
  };
}

export async function fiberAcceptChannel(params: {
  temporary_channel_id: string;
  funding_amount: `0x${string}`;
}) {
  return requireFiber().acceptChannel(params);
}

export async function fiberAbandonChannel(channel_id: string) {
  return requireFiber().abandonChannel({ channel_id });
}

export async function fiberOpenChannel(params: {
  pubkey: string;
  funding_amount: `0x${string}`;
  public?: boolean;
}) {
  return requireFiber().openChannel(params);
}

export async function fiberNewInvoice(params: {
  amount: `0x${string}`;
  currency: 'Fibt' | 'Fibb' | 'Fibd';
  description?: string;
  payment_preimage: `0x${string}`;
  expiry?: `0x${string}`;
  udt_type_script?: { code_hash: `0x${string}`; hash_type: 'type' | 'data' | 'data1' | 'data2'; args: string };
}) {
  return requireFiber().newInvoice(params);
}

export async function fiberGetInvoice(payment_hash: `0x${string}`) {
  return requireFiber().getInvoice({ payment_hash });
}

export async function fiberSendPayment(params: {
  invoice?: string;
  target_pubkey?: string;
  amount?: `0x${string}`;
  keysend?: boolean;
  max_fee_amount?: `0x${string}`;
  timeout?: `0x${string}`;
}) {
  return requireFiber().sendPayment(params);
}

export async function fiberGetPayment(payment_hash: `0x${string}`) {
  return requireFiber().getPayment({ payment_hash });
}

/** Connect to all WSS bootnodes (best-effort, continues on individual failures). */
export async function fiberConnectBootnodes(bootnodes: string[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const address of bootnodes) {
    try {
      await fiberConnectPeer({ address, save: true });
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

// Fallback YAML (mirrors fiber-js README testnet example) if getDefaultConfig is absent.
function fallbackTestnetConfig(ckbRpcUrl: string): string {
  return `
fiber:
  listening_addr: "/ip4/127.0.0.1/tcp/8228"
  bootnode_addrs:
    - "/dns4/thrall.fiber.channel/tcp/443/wss/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
    - "/dns4/onyxia.fiber.channel/tcp/443/wss/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"
  announce_listening_addr: false
  chain: testnet
  scripts:
    - name: FundingLock
      script:
        code_hash: 0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code
rpc:
  listening_addr: "127.0.0.1:8227"
ckb:
  rpc_url: "${ckbRpcUrl}"
  udt_whitelist:
    - name: RUSD
      script:
        code_hash: 0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a
        hash_type: type
        args: 0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f
      auto_accept_amount: 1000000000
services:
  - fiber
  - rpc
  - ckb
`;
}
