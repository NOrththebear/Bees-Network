// @bees-network/ckb-client — pure coordinator helpers (no @ckb-ccc import).
// For live wiring see README "CCC integration" (Transaction.from,
// completeInputsByCapacity/ByUdt, completeFeeBy, findCellsByType,
// waitTransaction). All hashes mirror crates/bees-network-core.
import {
  ckbHashBytes,
  bytesToHex,
  hexToBytes,
  encodeRegistry,
  encodeEpoch,
  encodeShare,
  registryTypeArgs,
  epochTypeArgs,
  rewardsLockArgs,
} from "../../shared-ts/src/index.ts";

// v0.1 audited binaries (dist/, `python3 -c blake2b(person=ckb-default-hash)`):
export const CODE_HASHES = {
  registryType:
    "0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8",
  epochType:
    "0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1",
  rewardsLock:
    "0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84",
} as const;

export const HASH_TYPE_DATA2 = "data2" as const;

export interface ScriptDesc {
  codeHash: string;
  hashType: "data" | "type" | "data1" | "data2";
  args: string;
}

export function registryTypeScript(registryId: string, codeHash = CODE_HASHES.registryType): ScriptDesc {
  if (!/^0x[0-9a-fA-F]{64}$/.test(registryId)) throw new Error("registryId must be bytes32");
  return { codeHash, hashType: HASH_TYPE_DATA2, args: registryTypeArgs(registryId) };
}

export function epochTypeScript(
  epochId: number | bigint,
  registryId: string,
  codeHash = CODE_HASHES.epochType,
): ScriptDesc {
  return { codeHash, hashType: HASH_TYPE_DATA2, args: epochTypeArgs(epochId, registryId) };
}

export function rewardsLockScript(
  epochId: number | bigint,
  rewardsRoot: string,
  codeHash = CODE_HASHES.rewardsLock,
): ScriptDesc {
  return { codeHash, hashType: HASH_TYPE_DATA2, args: rewardsLockArgs(epochId, rewardsRoot) };
}

function le32(n: number): Uint8Array {
  const o = new Uint8Array(4);
  new DataView(o.buffer).setUint32(0, n, true);
  return o;
}

function le64(n: number | bigint): Uint8Array {
  const o = new Uint8Array(8);
  new DataView(o.buffer).setBigUint64(0, BigInt(n), true);
  return o;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const o = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of parts) {
    o.set(p, i);
    i += p.length;
  }
  return o;
}

/// REGISTRY_ID rule (must equal registry-type genesis check):
/// ckbhash(firstInputTxHash(32B) || firstInputIndex LE32 || outputIndex LE64=0).
export function computeRegistryId(firstInputTxHash: string, firstInputIndex: number): string {
  return bytesToHex(
    ckbHashBytes(concat(hexToBytes(firstInputTxHash), le32(firstInputIndex), le64(0))),
  );
}

export function buildRegistryGenesisData(registryId: string, operatorLockHash: string): Uint8Array {
  return encodeRegistry(registryId, operatorLockHash, []);
}

/// Minimum CKB (shannon) to fund a cell: occupied = 8 + lockLen + typeLen + dataLen.
/// Default lock = secp256k1_blake160 (32+20+1=53). Returns shannon as bigint + CKB string.
export function estimateCellCapacity(dataLen: number, lockLen = 53, typeLen?: number): { shannon: bigint; ckb: string } {
  const occupied = 8 + lockLen + (typeLen ?? 0) + dataLen;
  const margin = 10; // witness/size headroom; coordinator adds fee separately
  const total = BigInt(occupied + margin) * 100_000_000n;
  return { shannon: total, ckb: `${occupied + margin}` };
}

/// Full v0.1 claim witness: WitnessArgs{lock:None, input_type:Some(fixvec(proof)),
/// output_type:None}, hex-encoded. The on-chain script parses input_type and folds
/// the concatenated 32B siblings.
export function encodeProofForWitness(proofHex: string[]): string {
  const raw = concat(...proofHex.map(hexToBytes));
  if (raw.length % 32 !== 0) throw new Error("proof length must be multiple of 32");
  const field = new Uint8Array(4 + raw.length);
  new DataView(field.buffer).setUint32(0, raw.length, true);
  field.set(raw, 4);
  const total = 16 + field.length;
  const o = new Uint8Array(total);
  const dv = new DataView(o.buffer);
  dv.setUint32(0, total, true);
  dv.setUint32(4, 16, true);
  dv.setUint32(8, 16, true);
  dv.setUint32(12, 16 + field.length, true);
  o.set(field, 16);
  return bytesToHex(o);
}

export { encodeRegistry, encodeEpoch, encodeShare };
