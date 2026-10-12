import { blake2b } from '@noble/hashes/blake2.js';
import { CODE_HASHES, POINTS_CONFIG } from './config';
import type { NetworkKey } from './config';

const te = new TextEncoder();

/** ckbhash = Blake2b-256(personal="ckb-default-hash") */
export function ckbHash(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32, personalization: te.encode('ckb-default-hash') });
}

export function ckbHashHex(data: Uint8Array): string {
  return '0x' + Buffer.from(ckbHash(data)).toString('hex');
}

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}

export function le64(v: number | bigint): Uint8Array {
  const arr = new Uint8Array(8);
  const view = new DataView(arr.buffer);
  view.setBigUint64(0, BigInt(v), true);
  return arr;
}

export function le128(v: number | bigint): Uint8Array {
  const arr = new Uint8Array(16);
  const view = new DataView(arr.buffer);
  view.setBigUint64(0, BigInt(v) & 0xffffffffffffffffn, true);
  view.setBigUint64(8, (BigInt(v) >> 64n) & 0xffffffffffffffffn, true);
  return arr;
}

/** nodeIdFor(wallet_lock_hash_hex_lower, install_uuid) = ckbhash("lockhash:uuid") */
export function nodeIdFor(walletLockHex: string, installUuid: string): string {
  const cleanHex = walletLockHex.toLowerCase().replace(/^0x/, '');
  const preimage = te.encode(`0x${cleanHex}:${installUuid}`);
  return ckbHashHex(preimage);
}

/** Points calculation (matches bees-network-core) */
export function computePoints(bytes: number, beats: number): { netPts: number; upPts: number } {
  const net = Math.min(Math.floor(bytes / POINTS_CONFIG.bytesPerNetPt), POINTS_CONFIG.maxNetPerDay);
  const up = Math.min(Math.floor(beats / POINTS_CONFIG.beatsPerUpPt), POINTS_CONFIG.maxUpPerDay);
  return { netPts: net, upPts: up };
}

/** Points ledger leaf: ckbhash(node_id || net_pts LE8 || up_pts LE8 || bytes LE8) */
export function pointsLeaf(nodeIdHex: string, netPts: number, upPts: number, bytes: number): string {
  const pre = new Uint8Array(32 + 8 + 8 + 8);
  pre.set(hexToBytes(nodeIdHex), 0);
  pre.set(le64(netPts), 32);
  pre.set(le64(upPts), 40);
  pre.set(le64(bytes), 48);
  return ckbHashHex(pre);
}

/** Rewards leaf: ckbhash(epoch LE8 || node_id || wallet || net LE8 || up LE8 || bytes LE8 || amount LE16) */
export function rewardLeaf(
  epochId: number,
  nodeIdHex: string,
  walletLockHex: string,
  netPts: number,
  upPts: number,
  bytes: number,
  amount: bigint
): string {
  const pre = new Uint8Array(8 + 32 + 32 + 8 + 8 + 8 + 16);
  let offset = 0;
  pre.set(le64(epochId), offset); offset += 8;
  pre.set(hexToBytes(nodeIdHex), offset); offset += 32;
  pre.set(hexToBytes(walletLockHex), offset); offset += 32;
  pre.set(le64(netPts), offset); offset += 8;
  pre.set(le64(upPts), offset); offset += 8;
  pre.set(le64(bytes), offset); offset += 8;
  pre.set(le128(amount), offset);
  return ckbHashHex(pre);
}

/** Sorted-pair merkle hash */
function sortPairHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const cmp = Buffer.from(a).compare(Buffer.from(b));
  const lo = cmp <= 0 ? a : b;
  const hi = cmp <= 0 ? b : a;
  const pre = new Uint8Array(64);
  pre.set(lo, 0);
  pre.set(hi, 32);
  return ckbHash(pre);
}

/** Sorted-pair Merkle root (matches bees-network-core) */
export function merkleRoot(leavesHex: string[]): string {
  if (leavesHex.length === 0) return '0x' + '00'.repeat(32);
  let level = leavesHex.map(hexToBytes).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  if (level.length === 1) return bytesToHex(level[0]);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sortPairHash(a, b));
    }
    level = next;
  }
  return bytesToHex(level[0]);
}

/** Merkle proof for leaf at index */
export function merkleProof(leavesHex: string[], index: number): string[] {
  if (leavesHex.length === 0 || index >= leavesHex.length) return [];
  if (leavesHex.length === 1) return [];
  let level = leavesHex.map(hexToBytes).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const target = hexToBytes(leavesHex[index]);
  let idx = level.findIndex((x) => Buffer.from(x).equals(Buffer.from(target)));
  const proof: Uint8Array[] = [];
  while (level.length > 1) {
    const sibIdx = idx % 2 === 0
      ? (idx + 1 < level.length ? idx + 1 : idx)
      : idx - 1;
    proof.push(level[sibIdx]);
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sortPairHash(a, b));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof.map(bytesToHex);
}

/** Verify merkle proof */
export function verifyProof(leafHex: string, proofHex: string[], rootHex: string): boolean {
  let h = hexToBytes(leafHex);
  for (const p of proofHex) {
    h = sortPairHash(h, hexToBytes(p));
  }
  return bytesToHex(h) === rootHex;
}

/** Canonical JSON (sorted keys) */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

/** Evidence hash: ckbhash(canonical_json_bytes) */
export function evidenceHash(evidence: object): string {
  return ckbHashHex(te.encode(canonicalJson(evidence)));
}

/** Registry Type script args: REGISTRY_ID (32B) */
export function registryTypeArgs(registryId: string) {
  return {
    codeHash: CODE_HASHES.registry,
    hashType: 'data2' as const,
    args: registryId,
  };
}

/** Epoch Type script args: epoch LE8 || REGISTRY_ID (40B) */
export function epochTypeArgs(epochId: number, registryId: string) {
  const args = '0x' + le64(epochId).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '') + registryId.slice(2);
  return {
    codeHash: CODE_HASHES.epoch,
    hashType: 'data2' as const,
    args,
  };
}

/** Rewards Lock script args: epoch LE8 || rewards_root (40B) */
export function rewardsLockArgs(epochId: number, rewardsRoot: string) {
  const args = '0x' + le64(epochId).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '') + rewardsRoot.slice(2);
  return {
    codeHash: CODE_HASHES.rewards,
    hashType: 'data2' as const,
    args,
  };
}

/** Registry genesis data: registry_id || operator_lock_hash || count(0) */
export function buildRegistryGenesisData(registryId: string, operatorLockHash: string): Uint8Array {
  const out = new Uint8Array(32 + 32 + 4);
  out.set(hexToBytes(registryId), 0);
  out.set(hexToBytes(operatorLockHash), 32);
  // count = 0 (u32 LE)
  out[64] = 0; out[65] = 0; out[66] = 0; out[67] = 0;
  return out;
}

/** Encode Registry data */
export function encodeRegistry(
  registryId: string,
  operatorLockHash: string,
  nodes: Array<{ nodeId: string; walletLockHash: string; eligible: boolean; beats: number; bytes: number }>
): Uint8Array {
  const sorted = [...nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const headerSize = 32 + 32 + 4;
  const entrySize = 32 + 32 + 1 + 8 + 8;
  const out = new Uint8Array(headerSize + sorted.length * entrySize);
  let offset = 0;
  out.set(hexToBytes(registryId), offset); offset += 32;
  out.set(hexToBytes(operatorLockHash), offset); offset += 32;
  out.set(le64(sorted.length).slice(0, 4), offset); offset += 4; // u32 count
  for (const n of sorted) {
    out.set(hexToBytes(n.nodeId), offset); offset += 32;
    out.set(hexToBytes(n.walletLockHash), offset); offset += 32;
    out[offset++] = n.eligible ? 1 : 0;
    out.set(le64(n.beats), offset); offset += 8;
    out.set(le64(n.bytes), offset); offset += 8;
  }
  return out;
}

/** Encode Epoch data: "BEEP01" || epoch LE8 || registry_id || merkle_root || evidence || pool LE16 || rewards_root */
export function encodeEpoch(
  epochId: number,
  registryId: string,
  merkleRootHex: string,
  evidenceHashHex: string,
  pool: bigint,
  rewardsRootHex: string
): Uint8Array {
  const MAGIC = te.encode('BEEP01'); // 6 bytes
  const out = new Uint8Array(6 + 8 + 32 + 32 + 32 + 16 + 32);
  let offset = 0;
  out.set(MAGIC, offset); offset += 6;
  out.set(le64(epochId), offset); offset += 8;
  out.set(hexToBytes(registryId), offset); offset += 32;
  out.set(hexToBytes(merkleRootHex), offset); offset += 32;
  out.set(hexToBytes(evidenceHashHex), offset); offset += 32;
  out.set(le128(pool), offset); offset += 16;
  out.set(hexToBytes(rewardsRootHex), offset);
  return out;
}

/** Encode Share data (112B == leaf preimage) */
export function encodeShare(
  epochId: number,
  nodeIdHex: string,
  walletLockHex: string,
  netPts: number,
  upPts: number,
  bytes: number,
  amount: bigint
): Uint8Array {
  const out = new Uint8Array(8 + 32 + 32 + 8 + 8 + 8 + 16);
  let offset = 0;
  out.set(le64(epochId), offset); offset += 8;
  out.set(hexToBytes(nodeIdHex), offset); offset += 32;
  out.set(hexToBytes(walletLockHex), offset); offset += 32;
  out.set(le64(netPts), offset); offset += 8;
  out.set(le64(upPts), offset); offset += 8;
  out.set(le64(bytes), offset); offset += 8;
  out.set(le128(amount), offset);
  return out;
}

/** Encode rewards witness proof for input_type */
export function encodeProofForWitness(proofHex: string[]): Uint8Array {
  const total = proofHex.length * 32;
  const out = new Uint8Array(4 + total); // molecule fixvec: count LE32 + items
  const view = new DataView(out.buffer);
  view.setUint32(0, proofHex.length, true);
  for (let i = 0; i < proofHex.length; i++) {
    out.set(hexToBytes(proofHex[i]), 4 + i * 32);
  }
  return out;
}

/** Compute REGISTRY_ID via Type-ID rule: blake2b(first_input_outpoint || output_index=0) */
export function computeRegistryId(firstTxHash: string, firstIndex: number): string {
  const pre = new Uint8Array(36 + 8);
  pre.set(hexToBytes(firstTxHash), 0);
  const view = new DataView(pre.buffer, 36);
  view.setBigUint64(0, BigInt(firstIndex), true);
  return ckbHashHex(pre);
}