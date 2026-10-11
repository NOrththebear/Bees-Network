// XUDT on devnet: deploy canonical binary -> owner-mint -> non-owner conservation test.
// Binding model v0.1: share cells (rewards-lock, 112B) stay points-only; XUDT moves
// in separate cells (xUDT requires 16B amount data). Coordinator binds amounts off-chain.
// Usage: node xudt.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { rpc, b2h, scriptHash, sendAndWait, getLive } from "./chain.mjs";

const SECP = { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type" };
const OP = { ...SECP, args: "0x8e42b1999f265a0078503c4acec4d5e134534297" };
const N1 = { ...SECP, args: "0x758d311c8483e0602dfad7b69d9053e3f917457d" };
const OP_HASH = scriptHash(OP);
const SECP_DEP = { out_point: { tx_hash: "0xdc8d59fe746daa17330f885650c840517b7b47425815a78dac06d2cf7c4b9f05", index: "0x0" }, dep_type: "dep_group" };
const XUDT_CODE = "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95";
const XUDT = { code_hash: XUDT_CODE, hash_type: "data1", args: "" };
XUDT.args = OP_HASH.slice(0, 66) + "00000000"; // owner_lock_hash(32B) + flags u32 LE = 0
const SHANNON = 100_000_000n;
const CKB = (n) => "0x" + (BigInt(n) * SHANNON).toString(16);
const SH = (bi) => "0x" + BigInt(bi).toString(16);
const hx = (b) => `0x${b.toString(16)}`;
const U128 = (n) => { const o = Buffer.alloc(16); o.writeBigUInt64LE(BigInt(n), 0); return `0x${o.toString("hex")}`; };

const J = existsSync("journal-xudt.json") ? JSON.parse(readFileSync("journal-xudt.json", "utf8")) : { spent: [], deploy: null };
const save = () => writeFileSync("journal-xudt.json", JSON.stringify(J, null, 2));
async function tip() { return parseInt((await rpc("get_tip_header")).number); }

// operator lock hash via always-success code already deployed? read main journal for code cells + change
const MAIN = JSON.parse(readFileSync("journal.json", "utf8"));
async function opCells(n) {
  // fresh mature #0 cellbases, excluding spent in BOTH journals
  const t = await tip();
  const out = [];
  const spent = new Set([...(J.spent ?? []), ...(MAIN.spent ?? [])]);
  for (let bno = 0; bno <= t - 45 && out.length < n; bno++) {
    const b = await rpc("get_block_by_number", [hx(bno)]);
    const cb = b.transactions[0];
    for (let i = 0; i < cb.outputs.length; i++) {
      if (cb.outputs[i].lock.args === OP.args) {
        const op = { tx_hash: cb.hash, index: hx(i) };
        if (spent.has(op.tx_hash + ":" + op.index)) continue;
        const live = await rpc("get_live_cell", [op, false]);
        if (live.status === "live") { out.push(op); spent.add(op.tx_hash + ":" + op.index); }
      }
    }
  }
  if (out.length < n) throw new Error(`only ${out.length} funding cells`);
  J.spent = [...(J.spent ?? []), ...out.map((o) => o.tx_hash + ":" + o.index)];
  return out;
}

async function buildTx({ inputs, outputs, outputsData, cellDeps, label }) {
  const { groupInputsByLock, signSighashGroups } = await import("./chain.mjs");
  const { readFileSync: _r } = await import("node:fs");
  void _r;
  const withLocks = [];
  for (const op of inputs) {
    const live = await getLive(op);
    withLocks.push({ outPoint: op, _lock: live.cell.output.lock, capacity: live.cell.output.capacity });
  }
  const inCap = withLocks.reduce((a, c) => a + BigInt(c.capacity), 0n);
  const outCap = outputs.reduce((a, o) => a + BigInt(o.capacity), 0n);
  if (inCap < outCap) throw new Error(`${label}: in<out`);
  const KEYS = { [OP_HASH]: "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6" };
  const tx = {
    version: "0x0", cell_deps: cellDeps, header_deps: [],
    inputs: withLocks.map((c) => ({ previous_output: c.outPoint, since: "0x0", _lock: c._lock })),
    outputs: outputs.map((o) => ({ capacity: o.capacity, lock: o.lock, ...(o.type ? { type: o.type } : {}) })),
    outputs_data: outputsData,
    witnesses: withLocks.map(() => "0x"),
  };
  await signSighashGroups(tx, KEYS);
  for (const g of groupInputsByLock(tx)) {
    const { scriptHash: sh } = await import("./chain.mjs");
    if (KEYS[sh(g.lock)] && tx.witnesses[g.idxs[0]] === "0x") throw new Error(`${label}: unsigned`);
  }
  const clean = { version: tx.version, cell_deps: tx.cell_deps, header_deps: tx.header_deps,
    inputs: tx.inputs.map(({ _lock, ...i }) => i), outputs: tx.outputs,
    outputs_data: tx.outputs_data, witnesses: tx.witnesses };
  const hash = await sendAndWait(clean, label);
  save();
  return hash;
}
async function findTx(pred, back = 20) {
  const t = await tip();
  for (let n = t; n > t - back && n >= 0; n--) {
    const b = await rpc("get_block_by_number", [hx(n)]);
    for (const tx of b.transactions) if (pred(tx)) return tx;
  }
  return null;
}

async function main() {
  console.log("tip:", await tip(), "xudt owner:", XUDT.args.slice(0, 20) + "..");

  if (!J.xudtCode) {
    const funds = await opCells(1);
    const data = `0x${readFileSync("../dist/xudt").toString("hex")}`;
    const live = await getLive(funds[0]);
    const inCap = BigInt(live.cell.output.capacity);
    const codeCap = BigInt(33696 + 300) * SHANNON;
    await buildTx({
      inputs: funds,
      outputs: [
        { capacity: SH(codeCap), lock: OP },
        { capacity: SH(inCap - codeCap - 2n * SHANNON), lock: OP },
      ],
      outputsData: [data, "0x"],
      cellDeps: [SECP_DEP], label: "XUDT deploy-code",
    });
    const tx = await findTx((t) => t.outputs_data[0]?.length === 2 + 33696 * 2);
    if (!tx) throw new Error("deploy tx not found");
    J.xudtCode = { tx_hash: tx.hash, index: "0x0" };
    J.opChange = { tx_hash: tx.hash, index: "0x1" };
    save();
    console.log("xudt code cell:", J.xudtCode);
  }
  const xudtDep = { out_point: J.xudtCode, dep_type: "code" };

  if (!J.mint) {
    // owner-mode mint 1,000,000 units to operator (no xudt inputs, owner lock present)
    const live = await getLive(J.opChange);
    const inCap = BigInt(live.cell.output.capacity);
    const cellCap = BigInt(500) * SHANNON;
    await buildTx({
      inputs: [J.opChange],
      outputs: [
        { capacity: SH(cellCap), lock: OP, type: XUDT },
        { capacity: SH(inCap - cellCap - 2n * SHANNON), lock: OP },
      ],
      outputsData: [U128(1_000_000), "0x"],
      cellDeps: [SECP_DEP, xudtDep], label: "XUDT mint-1M",
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.type?.code_hash === XUDT_CODE));
    if (!tx) throw new Error("mint tx not found");
    const i = tx.outputs.findIndex((o) => o.type?.code_hash === XUDT_CODE);
    J.mint = { tx_hash: tx.hash, index: hx(i) };
    J.opChange = { tx_hash: tx.hash, index: hx(1 - i) };
    save();
    console.log("minted 1M to:", J.mint);
  }

  if (!J.moved) {
    // owner-mode move 1000 units into an always-success cell (staging non-owner funds)
    const { scriptHash: sh } = await import("./chain.mjs");
    const bin = readFileSync("../dist/always-success");
    const { blake2b } = await import("@noble/hashes/blake2b");
    const te = new TextEncoder();
    const ah = `0x${Buffer.from(blake2b(bin, { dkLen: 32, personalization: te.encode("ckb-default-hash") })).toString("hex")}`;
    const AL = { code_hash: ah, hash_type: "data2", args: "0x" };
    const live = await getLive(J.mint);
    const funds = await opCells(1);
    const liveF = await getLive(funds[0]);
    const inCap = BigInt(live.cell.output.capacity) + BigInt(liveF.cell.output.capacity);
    const c1 = BigInt(2000) * SHANNON, rest = 1_000_000 - 1000;
    // NOTE: input carries 1M, outputs 1000 + 999000 (conservation also holds; owner mode anyway)
    await buildTx({
      inputs: [J.mint, funds[0]],
      outputs: [
        { capacity: SH(c1), lock: AL, type: XUDT },
        { capacity: SH(inCap - c1 - 2n * SHANNON), lock: OP, type: XUDT },
      ],
      outputsData: [U128(1000), U128(rest)],
      cellDeps: [SECP_DEP, xudtDep], label: "XUDT stage-1000",
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.lock?.args === "0x" && o.type?.code_hash === XUDT_CODE));
    if (!tx) throw new Error("stage tx not found");
    const i = tx.outputs.findIndex((o) => o.lock?.args === "0x" && o.type?.code_hash === XUDT_CODE);
    J.moved = { tx_hash: tx.hash, index: hx(i) };
    J.opXudt = { tx_hash: tx.hash, index: hx(1 - i) };
    J.alwaysLock = AL;
    save();
    console.log("staged 1000 in always cell:", J.moved);
  }

  if (!J.split) {
    // STRICT non-owner conservation: always-cell(1000, no owner anywhere) -> N1(600) + always(400)
    const live = await getLive(J.moved);
    const inCap = BigInt(live.cell.output.capacity);
    const cN = BigInt(300) * SHANNON, cA = BigInt(300) * SHANNON;
    await buildTx({
      inputs: [J.moved],
      outputs: [
        { capacity: SH(cN), lock: N1, type: XUDT },
        { capacity: SH(inCap - cN - 2n * SHANNON), lock: J.alwaysLock, type: XUDT },
      ],
      outputsData: [U128(600), U128(400)],
      cellDeps: [xudtDep,
        { out_point: MAIN.code["always-success"], dep_type: "code" }], label: "XUDT split-600-400",
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.lock?.args === N1.args && o.type?.code_hash === XUDT_CODE));
    if (!tx) throw new Error("split tx not found");
    J.split = { tx_hash: tx.hash };
    save();
    console.log("non-owner split committed:", J.split.tx_hash);
  }

  // verify amounts
  const n1cell = await findTx((t) => t.outputs.some((o) => o.lock?.args === N1.args && o.type?.code_hash === XUDT_CODE));
  const i = n1cell.outputs.findIndex((o) => o.lock?.args === N1.args);
  const amtHex = n1cell.outputs_data[i];
  const amt = Buffer.from(amtHex.slice(2), "hex").readBigUInt64LE(0);
  console.log("N1 XUDT balance:", amt.toString(), "(expect 600)");
  if (amt !== 600n) throw new Error("amount mismatch");
  console.log("XUDT DONE");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
