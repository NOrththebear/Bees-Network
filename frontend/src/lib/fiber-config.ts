'use client';

/**
 * Fiber Network configuration for Bee Network.
 *
 * Sources (in docs.nervos.org workspace):
 * - fiber/fiber-js/README.md : testnet bootnodes + RUSD whitelist + start() example
 * - fiber/docs/network-nodes.md : public nodes (channel counterparties)
 * - fiber/docs/fiber-node-wss.md : browser must use wss:// transports
 * - fiber/crates/fiber-lib/src/rpc/README.md : invoice/payment/channel RPCs
 */

import type { NetworkKey } from './config';
import { NETWORK } from './config';

export type FiberNetwork = 'testnet' | 'mainnet';

export function ckbNetworkToFiber(network: NetworkKey): FiberNetwork {
  return network === 'devnet' ? 'testnet' : network;
}

export function fiberCurrencyFor(network: NetworkKey): 'Fibt' | 'Fibb' | 'Fibd' {
  // Invoice HRP: fibt = testnet, fibb = mainnet, fibd = dev (see docs/specs/payment-invoice.md)
  const n = network as string;
  if (n === 'devnet') return 'Fibd';
  if (n === 'mainnet') return 'Fibb';
  return 'Fibt';
}

/** WSS bootnodes from fiber-js README (browser-reachable, do NOT use TCP here). */
export const FIBER_BOOTNODES: Record<FiberNetwork, string[]> = {
  testnet: [
    '/dns4/thrall.fiber.channel/tcp/443/wss/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy',
    '/dns4/onyxia.fiber.channel/tcp/443/wss/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV',
  ],
  mainnet: [
    '/dns4/garrosh.fiber.channel/tcp/443/wss/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v',
    '/dns4/sylvanas.fiber.channel/tcp/443/wss/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2',
  ],
};

/**
 * TCP → WSS rewrite pairs for the bundled fiber-js default config.
 *
 * Verified against @nervosnetwork/fiber-js dist: its testnet bootnodes are
 * bare TCP (/ip4/…/tcp/8228) with the SAME peer IDs as the WSS endpoints
 * above (IPs match thrall/onyxia DNS). Browsers cannot dial TCP, so the
 * client rewrites them before start() — otherwise the light client boots
 * isolated with zero reachable peers.
 */
export const BROWSER_BOOTNODE_REWRITES: Record<FiberNetwork, Array<{ tcp: string; wss: string }>> = {
  testnet: [
    {
      tcp: '/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy',
      wss: '/dns4/thrall.fiber.channel/tcp/443/wss/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy',
    },
    {
      tcp: '/ip4/16.163.7.105/tcp/8228/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV',
      wss: '/dns4/onyxia.fiber.channel/tcp/443/wss/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV',
    },
  ],
  mainnet: [
    {
      tcp: '/ip4/43.199.24.44/tcp/8228/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v',
      wss: '/dns4/garrosh.fiber.channel/tcp/443/wss/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v',
    },
    {
      tcp: '/ip4/54.255.71.126/tcp/8228/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2',
      wss: '/dns4/sylvanas.fiber.channel/tcp/443/wss/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2',
    },
  ],
};

/** Apply the TCP → WSS rewrite + disable announce (browsers can't listen). */
export function browserizeFiberConfig(yaml: string, network: FiberNetwork): string {
  let out = yaml;
  for (const { tcp, wss } of BROWSER_BOOTNODE_REWRITES[network]) {
    out = out.split(tcp).join(wss);
  }
  out = out.replace('announce_listening_addr: true', 'announce_listening_addr: false');
  return out;
}

/**
 * Public nodes that auto-accept channels (docs/network-nodes.md).
 * Bootnodes are discovery-only — open channels against these.
 */
export const FIBER_PUBLIC_NODES: Record<
  FiberNetwork,
  Array<{ name: string; pubkey: string; minFundingShannon: bigint; inboundShannon: bigint }>
> = {
  testnet: [
    {
      name: 'fiber-testnet-public-bottle',
      pubkey: '02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71',
      minFundingShannon: 49_900_000_000n,
      inboundShannon: 25_000_000_000n,
    },
    {
      name: 'fiber-testnet-public-bracer',
      pubkey: '0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc',
      minFundingShannon: 49_900_000_000n,
      inboundShannon: 25_000_000_000n,
    },
  ],
  mainnet: [
    {
      name: 'fiber-mainnet-public-ca',
      pubkey: '03a8d7da8d0934363dbc17f52c872e8d833016415266eabb3527439c5dd17adc6b',
      minFundingShannon: 49_900_000_000n,
      inboundShannon: 25_000_000_000n,
    },
    {
      name: 'fiber-mainnet-public-tokyo',
      pubkey: '033a69e5be369dab43aefa96fa729d83c571ccb066f312136c6ab2d354fcc028f9',
      minFundingShannon: 49_900_000_000n,
      inboundShannon: 25_000_000_000n,
    },
  ],
};

/** CKB RPC used by the in-browser Fiber light client (must be a trusted endpoint). */
export function fiberCkbRpcUrl(network: NetworkKey): string {
  return NETWORK[network].rpc;
}

/** IndexedDB prefix per device — keeps multiple Bee accounts isolated. */
export function fiberDbPrefix(deviceId: string): string {
  const safe = deviceId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48);
  return `/bees-${safe}`;
}

/** Hex helpers for Fiber RPC (all amounts are 0x-prefixed hex). */
export function toHexU128(v: bigint | number): `0x${string}` {
  return `0x${BigInt(v).toString(16)}`;
}

export function fromHexU128(h: string): bigint {
  if (!h) return 0n;
  try {
    return BigInt(h);
  } catch {
    return 0n;
  }
}

/** Default channel open params tuned for always-online Bee nodes. */
export const FIBER_DEFAULTS = {
  // 4h TLC expiry delta (matches fnn default, allows multi-hop)
  tlcExpiryDeltaMs: 4 * 60 * 60 * 1000,
  // 0.1% forwarding fee default
  tlcFeeProportionalMillionths: 1000,
  maxTlcNumberInFlight: 125,
} as const;

// ---------------------------------------------------------------------------
// Lazy inbound channels ("counterfactual fiber account", ERC-4337 style)
//
// Join = free: the browser only opens a P2P peer connection (no channel,
// no on-chain tx, no funds). The Fiber pubkey is the counterfactual identity,
// like an undeployed ERC-4337 sender address.
//
// The FIRST reward triggers activation, fully hub-driven:
//   1. user creates a reward invoice (embeds payee pubkey + UDT script)
//   2. coordinator hub opens a UDT channel TO the user and funds it entirely
//   3. user auto-accepts with 0 contribution (UDT whitelist path —
//      crates/fiber-lib/src/fiber/network.rs:1377-1391, is_udt_type_auto_accept
//      in crates/fiber-lib/src/ckb/contracts.rs:454)
//   4. after L1 funding confirmation (one-time "deployment" delay, hub-paid),
//      hub pays the invoice; all later rewards stream instantly.
//
// Why UDT, not CKB: CKB accept REQUIRES the acceptor to contribute >=
// reserved_capacity (channel.rs:get_funding_and_reserved_amount), so a
// zero-cost inbound CKB channel is impossible. UDT accept allows 0.
// See docs/lazy-channels note in fiber-lazy.ts.
// ---------------------------------------------------------------------------

export interface RewardUdt {
  name: string;
  script: { code_hash: `0x${string}`; hash_type: 'type'; args: string };
  /** Hub must fund >= this for the user's client to auto-accept. */
  autoAcceptAmount: bigint;
}

/** RUSD on testnet (matches fiber default WASM config whitelist). */
export const BEES_REWARD_UDT: Record<FiberNetwork, RewardUdt> = {
  testnet: {
    name: 'RUSD',
    script: {
      code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
      hash_type: 'type',
      args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
    },
    autoAcceptAmount: 1_000_000_000n,
  },
  // TODO(mainnet): replace with the USDI deployment the hub whitelists.
  mainnet: {
    name: 'USDI',
    script: {
      code_hash: '0xbfa35a9c38a676682b65ade8f02be164d48632281477e36f8dc2f41f79e56bfc',
      hash_type: 'type',
      args: '0xd591ebdc69626647e056e13345fd830c8b876bb06aa07ba610479eb77153ea9f',
    },
    autoAcceptAmount: 10_000_000n,
  },
};

/**
 * Coordinator (Bee hub) the browser dials on startup so the hub can open the
 * lazy channel over the existing peer session later. Browsers can't listen,
 * so the DIAL direction must always be user -> hub.
 *
 * Override with env (no redeploy needed when the hub moves):
 *   NEXT_PUBLIC_BEES_HUB_PUBKEY, NEXT_PUBLIC_BEES_HUB_ADDRESS
 */
export interface HubDescriptor {
  pubkey: string;
  /** WSS multiaddr the browser dials (hub must announce a /wss addr). */
  address: string;
}

const ENV_HUB_PUBKEY =
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_BEES_HUB_PUBKEY : undefined;
const ENV_HUB_ADDRESS =
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_BEES_HUB_ADDRESS : undefined;

export const BEES_HUB: Record<FiberNetwork, HubDescriptor | null> = {
  // Placeholder until the Bee coordinator fnn is deployed: dials still go to
  // public bootnodes; lazy-channel polling stays armed and activates the
  // moment a hub opens a channel to this pubkey.
  testnet: ENV_HUB_PUBKEY
    ? { pubkey: ENV_HUB_PUBKEY, address: ENV_HUB_ADDRESS ?? '' }
    : null,
  mainnet: null,
};

/** Coordinator registration endpoint (hub learns pubkey -> nodeId mapping). */
export function beesHubRegistrationUrl(): string | null {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BEES_HUB_API) {
    return process.env.NEXT_PUBLIC_BEES_HUB_API as string;
  }
  return null;
}

export const LAZY_CHANNEL = {
  /** How often to poll list_channels(only_pending) for hub-opened channels. */
  pollIntervalMs: 20_000,
  /** UDT accept contributes exactly 0 (hub funds everything). */
  zeroFunding: '0x0' as `0x${string}`,
} as const;
