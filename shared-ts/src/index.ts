// @relaymesh/ckb-shared — mirrors crates/relaymesh-core (blake2b personal=ckb-default-hash).
// No @ckb-ccc dependency here; ckb-client/ holds chain wiring.
import { blake2b } from "@noble/hashes/blake2b";

export const ZERO32 = `0x${"00".repeat(32)}`;
export const EPOCH_MAGIC = "RMEP01";
export const POINTS = {
  bytesPerNetPt: 102_400,
  beatsPerUpPt: 20,
  maxNetPerDay: 500,
  maxUpPerDay: 144,
} as const;

const te = new TextEncoder();

export function ckbHashBytes(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32, personalization: te.encode("ckb-default-hash") });
}

export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 !== 0) throw new Error("odd hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return `0x${Buffer.from(b).toString("hex")}`;
}

export function ckbHashHexOfBytes(data: Uint8Array): string {
  return bytesToHex(ckbHashBytes(data));
}

export function isByte32Hex(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

export function computePoints(bytes: number, beats: number): { netPts: number; upPts: number } {
  return {
    netPts: Math.min(POINTS.maxNetPerDay, Math.floor(bytes / POINTS.bytesPerNetPt)),
    upPts: Math.min(POINTS.maxUpPerDay, Math.floor(beats / POINTS.beatsPerUpPt)),
  };
}

export function nodeIdFor(walletLockHashLower: string, installUUID: string): string {
  const pre = `${walletLockHashLower.toLowerCase()}:${installUUID}`;
  return bytesToHex(ckbHashBytes(te.encode(pre)));
}

function le64(n: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return out;
}

function le128(n: number | bigint): Uint8Array {
  let v = BigInt(n);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function cmpHex(a: string, b: string): number {
  return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
}

// Points-ledger leaf: ckbhash(node_id || net LE8 || up LE8 || bytes LE8)
export function pointsLeaf(nodeId: string, netPts: number, upPts: number, bytes: number): string {
  return bytesToHex(ckbHashBytes(concat(hexToBytes(nodeId), le64(netPts), le64(upPts), le64(bytes))));
}

// Rewards-claim leaf: ckbhash(epoch LE8 || node || wallet || net || up || bytes || amount LE16)
export function rewardLeaf(
  epochId: number | bigint,
  nodeId: string,
  walletLockHash: string,
  netPts: number | bigint,
  upPts: number | bigint,
  bytes: number | bigint,
  amount: number | bigint,
): string {
  return bytesToHex(
    ckbHashBytes(
      concat(
        le64(epochId),
        hexToBytes(nodeId),
        hexToBytes(walletLockHash),
        le64(netPts),
        le64(upPts),
        le64(bytes),
        le128(amount),
      ),
    ),
  );
}

function sortPairHash(aHex: string, bHex: string): string {
  const [lo, hi] = cmpHex(aHex, bHex) <= 0 ? [aHex, bHex] : [bHex, aHex];
  return bytesToHex(ckbHashBytes(concat(hexToBytes(lo), hexToBytes(hi))));
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return ZERO32;
  let level = [...leaves].sort(cmpHex);
  if (level.length === 1) return level[0];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sortPairHash(a, b));
    }
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves: string[], index: number): string[] {
  if (leaves.length <= 1) return [];
  if (index < 0 || index >= leaves.length) throw new Error("bad index");
  let level = [...leaves].sort(cmpHex);
  let idx = level.indexOf(leaves[index]);
  if (idx === -1) throw new Error("leaf not found");
  const proof: string[] = [];
  while (level.length > 1) {
    const sib = idx % 2 === 0 ? (idx + 1 < level.length ? level[idx + 1] : level[idx]) : level[idx - 1];
    proof.push(sib);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sortPairHash(a, b));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  let h = leaf;
  for (const s of proof) h = sortPairHash(h, s);
  return h.toLowerCase() === root.toLowerCase();
}

// Canonical JSON (sorted keys) + evidence hash = ckbhash of those bytes.
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) {
        out[k] = sort((x as Record<string, unknown>)[k]);
      }
      return out;
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

export function evidenceHash(canonicalJsonStr: string): string {
  return bytesToHex(ckbHashBytes(te.encode(canonicalJsonStr)));
}

// ---- v0.1 fixed-pack codecs (must match crates/relaymesh-core/src/codec.rs) ----

export interface NodeEntry {
  nodeId: string;
  walletLockHash: string;
  eligible: boolean;
  beats: number | bigint;
  bytes: number | bigint;
}

export function encodeRegistry(registryId: string, operatorLockHash: string, nodes: NodeEntry[]): Uint8Array {
  const sorted = [...nodes].sort((a, b) => cmpHex(a.nodeId, b.nodeId));
  const parts: Uint8Array[] = [hexToBytes(registryId), hexToBytes(operatorLockHash)];
  const n = new Uint8Array(4);
  new DataView(n.buffer).setUint32(0, sorted.length, true);
  parts.push(n);
  for (const e of sorted) {
    parts.push(
      concat(
        hexToBytes(e.nodeId),
        hexToBytes(e.walletLockHash),
        new Uint8Array([e.eligible ? 1 : 0]),
        le64(e.beats),
        le64(e.bytes),
      ),
    );
  }
  return concat(...parts);
}

export function encodeEpoch(
  epochId: number | bigint,
  registryId: string,
  merkleRootHex: string,
  evidenceHashHex: string,
  pool: number | bigint,
  rewardsRoot: string,
): Uint8Array {
  return concat(
    te.encode(EPOCH_MAGIC),
    le64(epochId),
    hexToBytes(registryId),
    hexToBytes(merkleRootHex),
    hexToBytes(evidenceHashHex),
    le128(pool),
    hexToBytes(rewardsRoot),
  );
}

export function encodeShare(
  epochId: number | bigint,
  nodeId: string,
  walletLockHash: string,
  netPts: number | bigint,
  upPts: number | bigint,
  bytes: number | bigint,
  amount: number | bigint,
): Uint8Array {
  return concat(
    le64(epochId),
    hexToBytes(nodeId),
    hexToBytes(walletLockHash),
    le64(netPts),
    le64(upPts),
    le64(bytes),
    le128(amount),
  );
}

// Rewards args: epoch LE8 || root(32). Registry args: registryId(32). Epoch args: epoch LE8 || registryId.
export function registryTypeArgs(registryId: string): string {
  return registryId;
}
export function epochTypeArgs(epochId: number | bigint, registryId: string): string {
  return bytesToHex(concat(le64(epochId), hexToBytes(registryId)));
}
export function rewardsLockArgs(epochId: number | bigint, rewardsRoot: string): string {
  return bytesToHex(concat(le64(epochId), hexToBytes(rewardsRoot)));
}
