// One-off recovery: redeploy the three contract code cells.
//
// WHY: the original code cells (tx 0x6b6f...:0x0/0x1) are OP-locked and have
// no type script, so funding collectors (both the JS coordinator's pickFunding
// and the Rust SDK's DefaultCellCollector) treated them as spendable change and
// consumed them. `data2` code hashes are derived from CELL DATA, so redeploying
// the same bytes preserves every existing type/lock reference; only the dep
// outpoint changes.
//
// FIX: the new code cells are locked with a dedicated "code lock" (a secp lock
// whose key is NOT used for funding), so no funding path can ever spend them.
//
// Usage: CKB_RPC=https://testnet.ckb.dev node recover-code.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { rpc, scriptHash, signSighashGroups, sendAndWait, getLive, groupInputsByLock, ckbHash, b2h } from "./chain.mjs";

const SECP = { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type" };
const OP = { ...SECP, args: "0x8e42b1999f265a0078503c4acec4d5e134534297" };
const OP_KEY = "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6";
const SECP_DEP = { out_point: { tx_hash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37", index: "0x0" }, dep_type: "dep_group" };
const OLD_CODE_TX = "0x6b6f4f43bff47259f6603b5658db61e3e350d7e98ad98639063f6073646f8173";
const SHANNON = 100_000_000n;
const CKB = (n) => "0x" + (BigInt(n) * SHANNON).toString(16);
const SH = (bi) => "0x" + BigInt(bi).toString(16);
const hx = (b) => `0x${b.toString(16)}`;

// Redeploy in this order so the Rust CODE_TX_HASH indices stay 0/1/2.
const BINS = ["registry-type", "epoch-type", "rewards-lock"];

const J = JSON.parse(readFileSync("journal-testnet.json", "utf8"));

// Load or create a dedicated code key (never used for funding).
const KEY_FILE = "code-key.json";
let codePriv;
if (existsSync(KEY_FILE)) {
  codePriv = JSON.parse(readFileSync(KEY_FILE, "utf8")).privkey;
} else {
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  const raw = secp256k1.utils.randomPrivateKey();
  codePriv = b2h(raw);
  writeFileSync(KEY_FILE, JSON.stringify({ privkey: codePriv }, null, 2));
  console.log("generated code key ->", KEY_FILE);
}
const { secp256k1 } = await import("@noble/curves/secp256k1");
const codePub = secp256k1.getPublicKey(Buffer.from(codePriv.slice(2), "hex"), true);
const codeArgs = b2h(ckbHash(codePub).slice(0, 20));
const CODE_LOCK = { ...SECP, args: codeArgs };
console.log("code lock:", JSON.stringify(CODE_LOCK));

const KEYS = { [scriptHash(OP)]: OP_KEY };

// Outpoints that must never be selected as funding.
function protectedOutpoints() {
  const set = new Set();
  for (let i = 0; i <= 4; i++) set.add(`${OLD_CODE_TX}:${hx(i)}`);
  const c = J.codeV2 ?? J.code ?? {};
  for (const v of Object.values(c)) if (v?.tx_hash) set.add(`${v.tx_hash}:${v.index}`);
  return set;
}

async function collectFunding(minShannons, excluded) {
  const out = [];
  let cap = 0n;
  let cursor = null;
  for (let page = 0; page < 80; page++) {
    const params = [{ script: OP, script_type: "lock", script_search_mode: "exact" }, "asc", "0x64"];
    if (cursor) params.push(cursor);
    const res = await rpc("get_cells", params);
    for (const c of res.objects) {
      if (c.output.type) continue; // typed cells can't fund
      const key = `${c.out_point.tx_hash}:${c.out_point.index}`;
      if (excluded.has(key)) continue;
      out.push(c.out_point);
      cap += BigInt(c.output.capacity);
      if (cap >= minShannons) break;
    }
    if (cap >= minShannons) break;
    if (!res.last_cursor || res.objects.length === 0) break;
    cursor = res.last_cursor;
  }
  if (cap < minShannons) throw new Error(`insufficient funding: have ${cap}, need ${minShannons}`);
  return { outPoints: out, cap };
}

async function buildTx({ inputs, outputs, outputsData, cellDeps, label }) {
  const withLocks = [];
  for (const op of inputs) {
    const live = await getLive(op);
    withLocks.push({ outPoint: op, _lock: live.cell.output.lock, capacity: live.cell.output.capacity });
  }
  const inCap = withLocks.reduce((a, c) => a + BigInt(c.capacity), 0n);
  const outCap = outputs.reduce((a, o) => a + BigInt(o.capacity), 0n);
  if (inCap < outCap) throw new Error(`${label}: in<out`);
  const tx = {
    version: "0x0", cell_deps: cellDeps, header_deps: [],
    inputs: withLocks.map((c) => ({ previous_output: c.outPoint, since: "0x0", _lock: c._lock })),
    outputs: outputs.map((o) => ({ capacity: o.capacity, lock: o.lock, ...(o.type ? { type: o.type } : {}) })),
    outputs_data: outputsData,
    witnesses: withLocks.map(() => "0x"),
  };
  await signSighashGroups(tx, KEYS);
  for (const g of groupInputsByLock(tx)) {
    if (KEYS[scriptHash(g.lock)] && tx.witnesses[g.idxs[0]] === "0x") throw new Error(`${label}: unsigned`);
  }
  const clean = {
    version: tx.version, cell_deps: tx.cell_deps, header_deps: tx.header_deps,
    inputs: tx.inputs.map(({ _lock, ...i }) => i), outputs: tx.outputs,
    outputs_data: tx.outputs_data, witnesses: tx.witnesses,
  };
  return sendAndWait(clean, label);
}

async function main() {
  // Idempotency: if codeV2 is recorded and all cells are live, do nothing.
  if (J.codeV2) {
    const ok = await Promise.all(Object.values(J.codeV2).map(async (o) =>
      (await rpc("get_live_cell", [o, false])).status === "live"));
    if (ok.every(Boolean)) {
      console.log("codeV2 already deployed and live:", JSON.stringify(J.codeV2));
      return;
    }
  }

  const datas = BINS.map((b) => `0x${readFileSync(`../dist/${b}`).toString("hex")}`);
  const caps = BINS.map((b) => Math.ceil(readFileSync(`../dist/${b}`).length) + 350); // CKB headroom
  const outputs = BINS.map((b, i) => ({ capacity: CKB(caps[i]), lock: CODE_LOCK }));
  const datasOut = [...datas];

  let need = outputs.reduce((a, o) => a + BigInt(o.capacity), 0n) + 2n * SHANNON;
  const fund = await collectFunding(need, protectedOutpoints());
  const change = fund.cap - outputs.reduce((a, o) => a + BigInt(o.capacity), 0n) - 2n * SHANNON;
  outputs.push({ capacity: SH(change), lock: OP });
  datasOut.push("0x");

  console.log(`funding: ${fund.outPoints.length} cell(s), ${Number(fund.cap) / 1e8} CKB`);
  const hash = await buildTx({
    inputs: fund.outPoints,
    outputs,
    outputsData: datasOut,
    cellDeps: [SECP_DEP],
    label: "recover-code (registry/epoch/rewards)",
  });

  J.codeV2 = {};
  BINS.forEach((b, i) => { J.codeV2[b] = { tx_hash: hash, index: hx(i) }; });
  writeFileSync("journal-testnet.json", JSON.stringify(J, null, 2));
  console.log("NEW CODE TX:", hash);
  console.log("codeV2:", JSON.stringify(J.codeV2, null, 2));
  console.log("=> set CODE_TX_HASH in crates/bee-node/src/chain.rs to this hash");
  console.log("=> set CODE.epoch/CODE.rewards dep outpoints in deploy/coordinator.mjs to :0x1/:0x2");
}

main().catch((e) => { console.error("FATAL:", e?.stack ?? e); process.exit(1); });
