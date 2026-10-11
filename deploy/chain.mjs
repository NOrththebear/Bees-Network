// Minimal CKB chain layer: RPC, Molecule serializers, sighash_all signer.
// No @ckb-ccc dependency (kept lean for devnet); mirrors docs how-tos/how-to-sign-a-tx.
import { blake2b } from "@noble/hashes/blake2b";

export const RPC = process.env.CKB_RPC ?? "http://127.0.0.1:8124";
const te = new TextEncoder();
const PERSON = te.encode("ckb-default-hash");

export function ckbHash(data) {
  return blake2b(data, { dkLen: 32, personalization: PERSON });
}
export const b2h = (b) => `0x${Buffer.from(b).toString("hex")}`;
export const h2b = (h) => Uint8Array.from(Buffer.from(h.startsWith("0x") ? h.slice(2) : h, "hex"));

export async function rpc(method, params = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

// ---------- Molecule builders (little-endian) ----------
function u32(n) { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, Number(n), true); return o; }
function u64(n) { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(n), true); return o; }
function concat(...ps) { const o = new Uint8Array(ps.reduce((a, p) => a + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; }
function table(fields) {
  // fields: Uint8Array[] -> total|offsets|concat
  let off = 4 + 4 * fields.length;
  const o = new Uint8Array(off + fields.reduce((a, f) => a + f.length, 0));
  const dv = new DataView(o.buffer);
  dv.setUint32(0, o.length, true);
  let p = off;
  fields.forEach((f, i) => { dv.setUint32(4 + i * 4, p, true); p += f.length; });
  o.set(concat(...fields), off);
  return o;
}
function fixvec(items) {
  // fixed-size items: count|concat
  return concat(u32(items.length), ...items);
}
function dynvec(items) {
  // dynamic items: total|offsets|concat
  return table(items);
}
const Bytes = (hex) => { const b = h2b(hex); return concat(u32(b.length / 1), b); };
// NOTE: Bytes fixvec header is item COUNT == byte length for byte items.
function Byte32(hex) { const b = h2b(hex); if (b.length !== 32) throw new Error("Byte32 len"); return b; }

export function molScript(s) {
  // table{code_hash:Byte32, hash_type:byte, args:Bytes}
  const args = h2b(s.args);
  const argsVec = concat(u32(args.length), args);
  return table([Byte32(s.code_hash), Uint8Array.of(hashTypeByte(s.hash_type)), argsVec]);
}
function hashTypeByte(ht) { return { data: 0, type: 1, data1: 2, data2: 4 }[ht] ?? (() => { throw new Error("ht"); })(); }

// NOTE: tx/script hashes are computed via `ckb-cli molecule encode` (reference
// implementation) piped into ckbhash. Hand-rolled serializers below disagree
// with consensus on several layouts (CellInput is since-first; empty CellDepVec
// encodes as 4 zero bytes), so deploy tooling does NOT rely on them for hashes.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
let __tmpN = 0;
function cliEncode(type, json) {
  const p = `/tmp/ckb-enc-${process.pid}-${__tmpN++}.json`;
  writeFileSync(p, JSON.stringify(json));
  const out = execSync(`ckb-cli molecule encode --type ${type} --json-path ${p} --output-format json`, { encoding: "utf8" });
  return h2b(JSON.parse(out));
}
export function scriptHash(s) {
  return b2h(ckbHash(cliEncode("Script", { code_hash: s.code_hash, hash_type: s.hash_type, args: s.args })));
}

function ScriptOpt(s) { return s == null ? new Uint8Array(0) : molScript(s); }
export function molCellOutput(o) {
  return table([u64(o.capacity), molScript(o.lock), ScriptOpt(o.type ?? null)]);
}
function molOutPoint(op) { return concat(Byte32(op.tx_hash), u32(parseInt(op.index))); }
function molCellInput(i) { return table([molOutPoint(i.previous_output), u64(i.since)]); }
function molCellDep(d) { return table([molOutPoint(d.out_point), Uint8Array.of(d.dep_type === "dep_group" ? 1 : 0)]); }
export function molTx(tx) {
  // RawTransaction (no witnesses) for tx_hash; full tx appends witnesses BytesVec.
  return table([
    u32(parseInt(tx.version)),
    dynvec(tx.cell_deps.map(molCellDep)),
    fixvec(tx.header_deps.map(Byte32)),
    dynvec(tx.inputs.map(molCellInput)),
    dynvec(tx.outputs.map(molCellOutput)),
    dynvec(tx.outputs_data.map(Bytes)),
  ]);
}
export function txHash(tx) {
  const { version, cell_deps, header_deps, inputs, outputs, outputs_data } = tx;
  const clean = {
    version, cell_deps: cell_deps.map(stripKeys), header_deps,
    inputs: inputs.map(stripKeys), outputs: outputs.map(stripKeys), outputs_data,
  };
  return b2h(ckbHash(cliEncode("RawTransaction", clean)));
}
function stripKeys(o) {
  if (Array.isArray(o)) return o.map(stripKeys);
  if (o && typeof o === "object") {
    return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, stripKeys(v)]));
  }
  return o;
}
export function txSize(tx) {
  const wit = dynvec(tx.witnesses.map(Bytes));
  return molTx(tx).length + wit.length;
}

// ---------- sighash_all signing ----------
export function groupInputsByLock(tx) {
  const groups = new Map(); // lockHash -> [inputIdx]
  tx.inputs.forEach((inp, i) => {
    const lock = inp._lock; // caller attaches resolved lock script
    const h = scriptHash(lock);
    if (!groups.has(h)) groups.set(h, { lock, idxs: [] });
    groups.get(h).idxs.push(i);
  });
  return [...groups.values()];
}

export function molWitnessArgs(lockHexOrNull, inputHexOrNull, outputHexOrNull) {
  const enc = (h) => {
    if (h == null) return new Uint8Array(0);
    const raw = h2b(h);
    return concat(u32(raw.length), raw);
  };
  return b2h(table([enc(lockHexOrNull), enc(inputHexOrNull), enc(outputHexOrNull)]));
}
const ZERO_LOCK = `0x${"00".repeat(65)}`;

/** Sign all sighash groups in tx with given privkeys (map lockHash->privkeyHex).
 *  Non-sighash groups (e.g. rewards-lock, type-only) must already have final witnesses. */
export async function signSighashGroups(tx, keyByLockHash) {
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  const hash = txHash(tx);
  for (const g of groupInputsByLock(tx)) {
    const privkey = keyByLockHash[g.lock ? scriptHash(g.lock) : ""];
    if (!privkey) continue; // not a sighash group we sign (e.g. rewards-lock inputs)
    // One signature per group, in the FIRST witness of the group; other
    // members hashed as-is (per how-tos/how-to-sign-a-tx).
    const first = g.idxs[0];
    const prevMeta = tx._witMeta?.[first] ?? {};
    tx.witnesses[first] = molWitnessArgs(ZERO_LOCK, prevMeta.input ?? null, prevMeta.output ?? null);
    const covered = [tx.witnesses[first]];
    for (const i of g.idxs.slice(1)) covered.push(tx.witnesses[i]); // as-is
    for (let i = tx.inputs.length; i < tx.witnesses.length; i++) covered.push(tx.witnesses[i]);
    let msg = h2b(hash);
    for (const w of covered) {
      const wb = h2b(w);
      msg = concat(msg, u64(wb.length), wb);
    }
    const sig = secp256k1.sign(ckbHash(msg), h2b(privkey));
    const rec = sig.recovery ?? 0;
    const compact = concat(
      Uint8Array.from(Buffer.from(sig.r.toString(16).padStart(64, "0"), "hex")),
      Uint8Array.from(Buffer.from(sig.s.toString(16).padStart(64, "0"), "hex")),
      Uint8Array.of(rec),
    );
    tx.witnesses[first] = molWitnessArgs(b2h(compact), prevMeta.input ?? null, prevMeta.output ?? null);
  }
  return tx;
}

export async function sendAndWait(tx, label) {
  const hash = await rpc("send_transaction", [tx, "passthrough"]);
  console.log(`${label}: sent ${hash} (${txSize(tx)} bytes)`);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await rpc("get_transaction", [hash]);
    const s = st.tx_status.status;
    if (s === "committed") {
      console.log(`${label}: COMMITTED in block ${st.tx_status.block_number}`);
      return hash;
    }
    if (["rejected", "unknown"].includes(s)) throw new Error(`${label}: tx ${s}: ${JSON.stringify(st)}`);
  }
  throw new Error(`${label}: not committed in 240s`);
}

export async function getLive(outPoint) {
  const cell = await rpc("get_live_cell", [outPoint, true]);
  if (cell.status !== "live") throw new Error(`cell not live: ${JSON.stringify(outPoint)}`);
  return cell;
}
