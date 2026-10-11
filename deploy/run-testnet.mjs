// RelayMesh CKB TESTNET (Pudge) lifecycle.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { rpc, scriptHash, signSighashGroups, sendAndWait, getLive } from "./chain.mjs";
import {
  nodeIdFor, computePoints, encodeRegistry, encodeEpoch, encodeShare,
  rewardLeaf, merkleRoot, merkleProof, canonicalJson, evidenceHash,
  epochTypeArgs, rewardsLockArgs, pointsLeaf,
} from "../shared-ts/src/index.ts";
import { computeRegistryId, encodeProofForWitness } from "../ckb-client/src/client.ts";

const SECP = { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type" };
const OP = { ...SECP, args: "0x8e42b1999f265a0078503c4acec4d5e134534297" };
const N1 = { ...SECP, args: "0x758d311c8483e0602dfad7b69d9053e3f917457d" };
const N2 = { ...SECP, args: "0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557" };
const KEYS = { [scriptHash(OP)]: "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6", [scriptHash(N1)]: "0x9f315d5a9618a39fdc487c7a67a8581d40b045bd7a42d83648ca80ef3b2cb4a1", [scriptHash(N2)]: "0x59ddda57ba06d6e9c5fa9040bdb98b4b098c2fce6520d39f51bc5e825364697a" };
const SECP_DEP = { out_point: { tx_hash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37", index: "0x0" }, dep_type: "dep_group" };
const CODE = {
  registry: "0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8",
  epoch: "0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1",
  rewards: "0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84",
  always: "0xf9f720d4042162130a856dcd8a7c626f5bf5c4b5f11cce2b81f5536b9fe52463",
  xudt: "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
};
const OP_HASH = scriptHash(OP);
const XUDT = { code_hash: CODE.xudt, hash_type: "data1", args: OP_HASH.slice(0, 66) + "00000000" };
const SHANNON = 100_000_000n;
const CKB = (n) => "0x" + (BigInt(n) * SHANNON).toString(16);
const SH = (bi) => "0x" + BigInt(bi).toString(16);
const hx = (b) => `0x${b.toString(16)}`;
const U128 = (n) => { const o = Buffer.alloc(16); let v = BigInt(n); for (let i = 0; i < 16; i++) { o[i] = Number(v & 0xffn); v >>= 8n; } return `0x${o.toString("hex")}`; };
const EPOCH_ID = 497585;

const J = existsSync("journal-testnet.json") ? JSON.parse(readFileSync("journal-testnet.json", "utf8")) : { spent: [] };
const save = () => writeFileSync("journal-testnet.json", JSON.stringify(J, null, 2));
async function tip() { return parseInt((await rpc("get_tip_header")).number); }

// Known type-free faucet cells for OP lock (indexer lags/caps, so hardcoded
// from faucet-api txs; verified live via get_live_cell).
const FAUCET_CELLS = [
  { tx_hash: "0x6bc27813711e13d28ba7216328feca9a5793f4c0de31e55f6fea3f064e263cfc", index: "0x0" }, // 80k
  { tx_hash: "0xf43c5c041385a3ffadd3be475358edff8bb70a7c7ebb68702af2473dae3ca0cb", index: "0x0" }, // 40k
  { tx_hash: "0x7539a2a5402d1333a5d3f7070de20973ad29684e6b6252b8c90c5f84d870f05d", index: "0x0" }, // 20k
  { tx_hash: "0xbd2acd66fba7b7ef2fe4b71414acf4ea5f77944313d5b364be2f483996188d07", index: "0x0" }, // 10k
];
async function fundCells(minCKB, count) {
  const min = BigInt(minCKB) * SHANNON;
  const out = [];
  for (const op of FAUCET_CELLS) {
    if (out.length >= count) break;
    const key = op.tx_hash + ":" + op.index;
    if (J.spent.includes(key)) continue;
    const live = await rpc("get_live_cell", [op, false]);
    if (live.status !== "live") continue;
    if (live.cell.output.type) continue;
    if (BigInt(live.cell.output.capacity) < min) continue;
    out.push(op);
  }
  if (out.length < count) {
    // fallback: indexer scan for anything missed
    const res = await rpc("get_cells", [{ script: OP, script_type: "lock", script_search_mode: "exact" }, "asc", "0x64"]);
    for (const c of res.objects) {
      if (out.length >= count) break;
      const op = c.out_point;
      const key = op.tx_hash + ":" + op.index;
      if (J.spent.includes(key)) continue;
      if (c.output.type) continue;
      if (BigInt(c.output.capacity) < min) continue;
      out.push(op);
    }
  }
  if (out.length < count) throw new Error(`only ${out.length} faucet cells >= ${minCKB} CKB`);
  return out;
}
function markSpent(ops) { for (const o of ops) J.spent.push(o.tx_hash + ":" + o.index); save(); }

async function buildTx({ inputs, outputs, outputsData, cellDeps, label, keys = KEYS }) {
  const { groupInputsByLock } = await import("./chain.mjs");
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
  await signSighashGroups(tx, keys);
  for (const g of groupInputsByLock(tx)) {
    const { scriptHash: sh } = await import("./chain.mjs");
    if (keys[sh(g.lock)] && tx.witnesses[g.idxs[0]] === "0x") throw new Error(`${label}: unsigned`);
  }
  const clean = { version: tx.version, cell_deps: tx.cell_deps, header_deps: tx.header_deps,
    inputs: tx.inputs.map(({ _lock, ...i }) => i), outputs: tx.outputs,
    outputs_data: tx.outputs_data, witnesses: tx.witnesses };
  const hash = await sendAndWait(clean, label);
  markSpent(withLocks.map((c) => c.outPoint));
  return hash;
}
async function findTx(pred, back = 40) {
  const t = await tip();
  for (let n = t; n > t - back && n >= 0; n--) {
    const b = await rpc("get_block_by_number", [hx(n)]);
    for (const tx of b.transactions) if (pred(tx)) return tx;
  }
  return null;
}

async function main() {
  console.log("tip:", await tip(), "rpc:", process.env.CKB_RPC);
  if (!J.code) {
    const funds = await fundCells(1, 4); // consolidate: 80k+40k+20k+10k
    const bins = ["registry-type", "epoch-type", "rewards-lock", "always-success", "xudt"];
    const datas = bins.map((b) => `0x${readFileSync(`../dist/${b}`).toString("hex")}`);
    const caps = [26404, 15628, 21844, 1292, 33996];
    let inCap = 0n;
    for (const f of funds) inCap += BigInt((await getLive(f)).cell.output.capacity);
    const outs = caps.map((c) => ({ capacity: CKB(c + 50), lock: OP }));
    outs.push({ capacity: SH(inCap - outs.reduce((a, o) => a + BigInt(o.capacity), 0n) - 3n * SHANNON), lock: OP });
    await buildTx({ inputs: funds, outputs: outs, outputsData: [...datas, "0x"], cellDeps: [SECP_DEP], label: "T1 deploy-5" });
    const tx = await findTx((t) => t.outputs.length === 6 && t.outputs_data[4]?.length === 2 + 33696 * 2);
    if (!tx) throw new Error("deploy tx not found");
    J.code = {};
    bins.forEach((b, i) => { J.code[b] = { tx_hash: tx.hash, index: hx(i) }; });
    J.change = { tx_hash: tx.hash, index: hx(5) };
    save();
    console.log("code:", JSON.stringify(J.code));
  }
  const codeDep = (b) => ({ out_point: J.code[b], dep_type: "code" });
  const xudtDep = { out_point: J.code["xudt"], dep_type: "code" };

  if (!J.mint) {
    const inCap = BigInt((await getLive(J.change)).cell.output.capacity);
    await buildTx({
      inputs: [J.change],
      outputs: [
        { capacity: CKB(500), lock: OP, type: XUDT },
        { capacity: SH(inCap - BigInt(CKB(500)) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [U128(1000000000000000000000000n), "0x"],
      cellDeps: [SECP_DEP, xudtDep], label: "T2 mint-1M-tRELAY",
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.type?.code_hash === CODE.xudt));
    const i = tx.outputs.findIndex((o) => o.type?.code_hash === CODE.xudt);
    J.mint = { tx_hash: tx.hash, index: hx(i) };
    J.change = { tx_hash: tx.hash, index: hx(1 - i) };
    save();
    console.log("mint:", J.mint);
  }

  if (!J.registry) {
    const inCap = BigInt((await getLive(J.change)).cell.output.capacity);
    const rid = computeRegistryId(J.change.tx_hash, parseInt(J.change.index));
    const rType = { code_hash: CODE.registry, hash_type: "data2", args: rid };
    const gdata = `0x${Buffer.from(encodeRegistry(rid, OP_HASH, [])).toString("hex")}`;
    await buildTx({
      inputs: [J.change],
      outputs: [
        { capacity: CKB(500), lock: OP, type: rType },
        { capacity: SH(inCap - BigInt(CKB(500)) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [gdata, "0x"],
      cellDeps: [SECP_DEP, codeDep("registry-type")], label: "T3 registry-genesis",
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.type?.args === rid));
    const ri = tx.outputs.findIndex((o) => o.type?.args === rid);
    J.registry = { id: rid, cell: { tx_hash: tx.hash, index: hx(ri) }, type: rType };
    J.change = { tx_hash: tx.hash, index: hx(1 - ri) };
    save();
    console.log("registry:", rid);
  }

  async function register(nodeLock, uuid, label) {
    const prev = await getLive(J.registry.cell);
    const raw = Buffer.from(prev.cell.data.content.slice(2), "hex");
    const cnt = raw.readUInt32LE(64);
    const entries = [];
    for (let i = 0; i < cnt; i++) {
      const o = 68 + i * 81;
      entries.push({
        nodeId: `0x${raw.subarray(o, o + 32).toString("hex")}`,
        walletLockHash: `0x${raw.subarray(o + 32, o + 64).toString("hex")}`,
        eligible: raw[o + 64] === 1,
        beats: raw.readBigUInt64LE(o + 65), bytes: raw.readBigUInt64LE(o + 73),
      });
    }
    const { scriptHash: sh } = await import("./chain.mjs");
    const nid = nodeIdFor(sh(nodeLock), uuid);
    if (entries.some((e) => e.nodeId.toLowerCase() === nid.toLowerCase())) {
      console.log(`${label}: already registered`);
      return nid;
    }
    entries.push({ nodeId: nid, walletLockHash: sh(nodeLock), eligible: true, beats: 20, bytes: 204800 });
    const next = `0x${Buffer.from(encodeRegistry(J.registry.id, OP_HASH, entries)).toString("hex")}`;
    const inCap = BigInt(prev.cell.output.capacity) + BigInt((await getLive(J.change)).cell.output.capacity);
    await buildTx({
      inputs: [J.registry.cell, J.change],
      outputs: [
        { capacity: CKB(700), lock: OP, type: J.registry.type },
        { capacity: SH(inCap - BigInt(CKB(700)) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [next, "0x"],
      cellDeps: [SECP_DEP, codeDep("registry-type")], label,
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.type?.args === J.registry.id && t.outputs_data[t.outputs.indexOf(o)]?.length > prev.cell.data.content.length));
    const i = tx.outputs.findIndex((o) => o.type?.args === J.registry.id);
    J.registry.cell = { tx_hash: tx.hash, index: hx(i) };
    J.change = { tx_hash: tx.hash, index: hx(1 - i) };
    save();
    console.log(`${label}: ${nid.slice(0, 14)}..`);
    return nid;
  }
  if (!J.n1) { J.n1 = await register(N1, "node-1-uuid", "T4 register-n1"); save(); }
  if (!J.n2) { J.n2 = await register(N2, "node-2-uuid", "T5 register-n2"); save(); }

  if (!J.epoch) {
    const totals = [
      { nodeId: J.n1, bytes: 204800, beats: 20 },
      { nodeId: J.n2, bytes: 102400, beats: 0 },
    ].map((t) => ({ ...t, ...computePoints(t.bytes, t.beats) }));
    const leaves = totals.map((t) => pointsLeaf(t.nodeId, t.netPts, t.upPts, t.bytes));
    const mroot = merkleRoot(leaves);
    const evidence = { schema: "bees-network/epoch-v1", chainId: "ckb-pudge-testnet", epochId: EPOCH_ID, perNode: totals, jobsSample: [], spotChecks: [] };
    const evHash = evidenceHash(canonicalJson(evidence));
    const POOL = 100000000000000000000n;
    const { scriptHash: sh } = await import("./chain.mjs");
    const rLeaves = totals.map((t) => rewardLeaf(EPOCH_ID, t.nodeId, sh(t.nodeId === J.n1 ? N1 : N2), t.netPts, t.upPts, t.bytes, 0));
    const rRoot = merkleRoot(rLeaves);
    const epochArgs = epochTypeArgs(EPOCH_ID, J.registry.id);
    const eType = { code_hash: CODE.epoch, hash_type: "data2", args: epochArgs };
    const edata = `0x${Buffer.from(encodeEpoch(EPOCH_ID, J.registry.id, mroot, evHash, POOL, rRoot)).toString("hex")}`;
    const inCap = BigInt((await getLive(J.change)).cell.output.capacity);
    await buildTx({
      inputs: [J.change],
      outputs: [
        { capacity: CKB(300), lock: OP, type: eType },
        { capacity: SH(inCap - BigInt(CKB(300)) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [edata, "0x"],
      cellDeps: [SECP_DEP, codeDep("epoch-type")], label: "T6 epoch-close",
    });
    const tx = await findTx((t) => t.outputs.some((o) => o.type?.args === epochArgs));
    const i = tx.outputs.findIndex((o) => o.type?.args === epochArgs);
    const pts = totals.map((t) => BigInt(t.netPts + t.upPts));
    const tot = pts.reduce((a, b) => a + b, 0n);
    const shares = totals.map((t, k) => ({ ...t, amount: tot === 0n ? 0n : (POOL * pts[k]) / tot }));
    J.epoch = { id: EPOCH_ID, cell: { tx_hash: tx.hash, index: hx(i) }, type: eType, root: mroot, evHash, rRoot, totals, shares: shares.map((s) => ({ ...s, amount: s.amount.toString() })) };
    save();
    console.log(`T6: root=${mroot.slice(0, 18)}.. pool=100 tRELAY`);
  }

  if (!J.claimXudt) {
    // T7': fund from old-T7 change only; XUDT amounts are a FRESH owner-mode
    // mint inline (owner lock present among inputs, no xudt inputs).
    // Share data carries amount 0 to match the epoch's rRoot (amount-0 leaves);
    // XUDT cells carry real value, bound off-chain (v0.1 model).
    // (A previous T7 wrote amount-carrying share data; its cells are abandoned.)
    const wOf = (nid) => (nid === J.n1 ? scriptHash(N1) : scriptHash(N2));
    const outs = [], datas = [];
    for (const s of J.epoch.shares) {
      const lock = { code_hash: CODE.rewards, hash_type: "data2", args: rewardsLockArgs(EPOCH_ID, J.epoch.rRoot) };
      datas.push(`0x${Buffer.from(encodeShare(EPOCH_ID, s.nodeId, wOf(s.nodeId), s.netPts, s.upPts, s.bytes, 0)).toString("hex")}`);
      outs.push({ capacity: CKB(300), lock });
      datas.push(U128(s.amount));
      outs.push({ capacity: CKB(300), lock: wOf(s.nodeId) === scriptHash(N1) ? N1 : N2, type: XUDT });
    }
    const inCap = BigInt((await getLive(J.change)).cell.output.capacity);
    const sum = outs.reduce((a, o) => a + BigInt(o.capacity), 0n);
    await buildTx({
      inputs: [J.change],
      outputs: [...outs, { capacity: SH(inCap - sum - 3n * SHANNON), lock: OP }],
      outputsData: [...datas, "0x"],
      cellDeps: [SECP_DEP, xudtDep], label: "T7 fund-claims+xudt",
    });
    const tx = await findTx((t) => t.outputs.length === 5 && t.outputs[0].lock?.code_hash === CODE.rewards);
    J.claimXudt = {
      shares: [0, 2].map((i) => ({ tx_hash: tx.hash, index: hx(i) })),
      xudts: [1, 3].map((i) => ({ tx_hash: tx.hash, index: hx(i) })),
    };
    J.change = { tx_hash: tx.hash, index: hx(4) };
    save();
    console.log("T7: funded 2 shares + 2 XUDT cells");
  }

  if (!J.claimed) {
    // NOTE: leaves use amount 0 to match the epoch's rRoot (amount-0 leaves).
    const s = { ...J.epoch.shares[0], amount: 0n };
    const s2 = { ...J.epoch.shares[1], amount: 0n };
    const { scriptHash: sh } = await import("./chain.mjs");
    const l0 = rewardLeaf(EPOCH_ID, s.nodeId, sh(N1), s.netPts, s.upPts, s.bytes, s.amount);
    const l1 = rewardLeaf(EPOCH_ID, s2.nodeId, sh(N2), s2.netPts, s2.upPts, s2.bytes, s2.amount);
    const proof = merkleProof([l0, l1], 0);
    const witRewards = encodeProofForWitness(proof);
    const cShare = await getLive(J.claimXudt.shares[0]);
    const cXudt = await getLive(J.claimXudt.xudts[0]);
    const fCell = await getLive(J.change); // own change covers fee+payout (faucet exhausted)
    const funds = [J.change];
    const inCap = [cShare, cXudt, fCell].reduce((a, c) => a + BigInt(c.cell.output.capacity), 0n);
    const realAmount = BigInt(J.epoch.shares[0].amount); // XUDT value moves; proof uses amount-0 leaves
    const tx = {
      version: "0x0",
      cell_deps: [
        { out_point: J.code["rewards-lock"], dep_type: "code" },
        { out_point: J.epoch.cell, dep_type: "code" },
        xudtDep, SECP_DEP,
      ],
      header_deps: [],
      inputs: [
        { previous_output: J.claimXudt.shares[0], since: "0x0", _lock: cShare.cell.output.lock },
        { previous_output: J.claimXudt.xudts[0], since: "0x0", _lock: cXudt.cell.output.lock },
        { previous_output: funds[0], since: "0x0", _lock: fCell.cell.output.lock },
      ],
      outputs: [
        { capacity: SH(inCap - BigInt(CKB(300)) - 3n * SHANNON), lock: N1 },
        { capacity: CKB(300), lock: N1, type: XUDT },
      ],
      outputs_data: ["0x", U128(realAmount)],
      witnesses: [witRewards, "0x", "0x"],
    };
    tx._witMeta = { 2: {} };
    await signSighashGroups(tx, KEYS);
    const clean = { version: tx.version, cell_deps: tx.cell_deps, header_deps: tx.header_deps,
      inputs: tx.inputs.map(({ _lock, ...i }) => i), outputs: tx.outputs,
      outputs_data: tx.outputs_data, witnesses: tx.witnesses };
    const hash = await sendAndWait(clean, "T8 claim-n1+xudt");
    markSpent([J.claimXudt.shares[0], J.claimXudt.xudts[0], funds[0]]);
    J.claimed = { tx: hash, amount: realAmount.toString() };
    save();
  }

  console.log("--- verify ---");
  console.log("registry live:", (await getLive(J.registry.cell)).cell.data.content.length);
  console.log("epoch live:", (await getLive(J.epoch.cell)).cell.data.content.length);
  console.log("share0 (expect dead):", (await rpc("get_live_cell", [J.claimXudt.shares[0], false])).status);
  const xudtCell = await getLive(J.claimXudt.xudts[1]);
  console.log("n2 xudt live, data:", xudtCell.cell.data.content);
  console.log("claim tx:", J.claimed.tx);
  console.log("TESTNET DONE");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
