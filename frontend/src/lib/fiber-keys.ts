'use client';

/**
 * Web5 account keys for Bee Network + Fiber.
 *
 * One local account automatically provisions:
 * - fiberKeyPair (32B): Fiber P2P identity (pubkey = payment identity)
 * - ckbSecretKey (32B): CKB funding key (lock script = on-chain identity)
 *
 * Both are generated with crypto.getRandomValues and persisted to localStorage.
 * The CKB lock/address are derived locally (no extension wallet needed).
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { LOCKS } from './config';
import type { NetworkKey } from './config';
import { ckbHashHex, hexToBytes, bytesToHex } from './bees';

const STORAGE_KEY = 'bees_fiber_keys_v1';

export interface FiberKeys {
  fiberKeyPairHex: `0x${string}`;
  ckbSecretKeyHex: `0x${string}`;
  createdAt: number;
}

export interface DerivedFiberIdentity {
  /** secp256k1 lock script for funding / registry */
  lockScript: { codeHash: string; hashType: 'type'; args: string };
  lockHash: string;
  ckbAddress: string;
  ckbPubkeyCompressedHex: string;
}

function random32(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

export function generateFiberKeys(): FiberKeys {
  return {
    fiberKeyPairHex: bytesToHex(random32()) as `0x${string}`,
    ckbSecretKeyHex: bytesToHex(random32()) as `0x${string}`,
    createdAt: Date.now(),
  };
}

export function loadFiberKeys(): FiberKeys | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FiberKeys;
    if (!parsed.fiberKeyPairHex || !parsed.ckbSecretKeyHex) return null;
    if (hexToBytes(parsed.fiberKeyPairHex).length !== 32) return null;
    if (hexToBytes(parsed.ckbSecretKeyHex).length !== 32) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFiberKeys(keys: FiberKeys): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function clearFiberKeys(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Ensure an account exists — auto-create on first run (Web5 UX, no wallet popup). */
export function ensureFiberKeys(): FiberKeys {
  const existing = loadFiberKeys();
  if (existing) return existing;
  const fresh = generateFiberKeys();
  saveFiberKeys(fresh);
  return fresh;
}

/** blake160(pubkey) */
function blake160(pubkey: Uint8Array): Uint8Array {
  return blake2b(pubkey, { dkLen: 20 });
}

/**
 * Derive secp256k1 lock + lockHash + address from the CKB secret key.
 * Uses @ckb-ccc/core for script hashing + address derivation (via Signer),
 * with a pure-local fallback so account creation never blocks on network.
 */
export async function deriveFiberIdentity(
  ckbSecretKeyHex: string,
  network: NetworkKey = 'testnet',
): Promise<DerivedFiberIdentity> {
  const secret = hexToBytes(ckbSecretKeyHex);
  const pubkeyCompressed = secp256k1.getPublicKey(secret, true);
  const args = `0x${Buffer.from(blake160(pubkeyCompressed)).toString('hex')}`;
  const lockScript = {
    codeHash: LOCKS.secp256k1.codeHash,
    hashType: 'type' as const,
    args,
  };

  // lockHash = ckbhash(molecule Script). ccc.Script.hash() does exactly this.
  let lockHash: string;
  try {
    const { Script } = await import('@ckb-ccc/core');
    lockHash = Script.from(lockScript).hash().toString();
  } catch {
    lockHash = ckbHashHex(encodeScriptMolecule(lockScript));
  }

  // Address via CCC signer (offline derivation, no RPC call for address itself).
  let ckbAddress = '';
  try {
    const core = await import('@ckb-ccc/core');
    const isMainnet = (network as string) === 'mainnet';
    const ClientCls = isMainnet ? core.ClientPublicMainnet : core.ClientPublicTestnet;
    const signer = new core.SignerCkbPrivateKey(
      new ClientCls(),
      ckbSecretKeyHex as `0x${string}`,
    );
    ckbAddress = await signer.getRecommendedAddress();
  } catch {
    ckbAddress = '';
  }

  return {
    lockScript,
    lockHash,
    ckbAddress,
    ckbPubkeyCompressedHex: `0x${Buffer.from(pubkeyCompressed).toString('hex')}`,
  };
}

/** Synchronous lockHash only (for nodeId derivation before async address resolves). */
export function deriveLockHashSync(ckbSecretKeyHex: string): {
  lockScript: { codeHash: string; hashType: 'type'; args: string };
  lockHash: string;
} {
  const secret = hexToBytes(ckbSecretKeyHex);
  const pubkeyCompressed = secp256k1.getPublicKey(secret, true);
  const args = `0x${Buffer.from(blake160(pubkeyCompressed)).toString('hex')}`;
  const lockScript = {
    codeHash: LOCKS.secp256k1.codeHash,
    hashType: 'type' as const,
    args,
  };
  return { lockScript, lockHash: ckbHashHex(encodeScriptMolecule(lockScript)) };
}

/** Molecule-encode a CKB Script (for ckbhash when CCC is unavailable). */
function encodeScriptMolecule(script: { codeHash: string; hashType: string; args: string }): Uint8Array {
  const codeHash = hexToBytes(script.codeHash);
  const hashTypeByte = script.hashType === 'type' ? 1 : script.hashType === 'data1' ? 2 : script.hashType === 'data2' ? 4 : 0;
  const args = hexToBytes(script.args);
  // table header: total_size + 3 offsets
  const headerLen = 4 + 4 * 3;
  const argsWithLen = 4 + args.length;
  const total = headerLen + 32 + 1 + argsWithLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total, true);
  view.setUint32(4, headerLen, true);
  view.setUint32(8, headerLen + 32, true);
  view.setUint32(12, headerLen + 32 + 1, true);
  out.set(codeHash, headerLen);
  out[headerLen + 32] = hashTypeByte;
  view.setUint32(headerLen + 32 + 1, args.length, true);
  out.set(args, headerLen + 32 + 1 + 4);
  return out;
}
