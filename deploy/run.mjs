// RelayMesh CKB devnet lifecycle: deploy -> registry -> register x2 -> epoch -> fund -> claim.
// State in journal.json (resume-safe). All OutPoints tracked manually (no indexer).
// Usage: node run.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  rpc, b2h, h2b, scriptHash, molWitnessArgs, signSighashGroups,
  sendAndWait, getLive, txHash,
} from "./chain.mjs";
import {
  nodeIdFor, computePoints, encodeRegistry, encodeEpoch, encodeShare,
  rewardLeaf, merkleRoot, merkleProof, canonicalJson, evidenceHash,
  epochTypeArgs, rewardsLockArgs,
} from "../shared-ts/src/index.ts";
import { computeRegistryId } from "../ckb-client/src/client.ts";

const SECP = { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type" };
const OP = { ...SECP, args: "0x8e42b1999f265a0078503c4acec4d5e134534297" };
const N1 = { ...SECP, args: "0x758d311c8483e0602dfad7b69d9053e3f917457d" };
const N2 = { ...SECP, args: "0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557" };
const KEYS = Object.fromEntries(
  Object.entries({
    [scriptHash(OP)]: process.env.OP_PRIVKEY,
    [scriptHash(N1)]: process.env.N1_PRIVKEY,
    [scriptHash(N2)]: process.env.N2_PRIVKEY,
  }).filter(([, v]) => !!v),
);
const SECP_DEP = { out_point: { tx_hash: "0xdc8d59fe746daa17330f885650c840517b7b47425815a78dac06d2cf7c4b9f05", index: "0x0" }, dep_type: "dep_group" };
const CODE = {
  registry: "0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8",
  epoch: "0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1",
  rewards: "0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84",
  always: "0xf9f720d4042162130a856dcd8a7c626f5bf5c4b5f11cce2b81f5536b9fe52463",
};
const SHANNON = 100_000_000n;
const CKB = (n) => "0x" + (BigInt(n) * SHANNON).toString(16);
const SH = (bi) => "0x" + BigInt(bi).toString(16);
const hx = (b) => `0x${b.toString(16)}`;

const J = existsSync("journal.json") ? JSON.parse(readFileSync("journal.json", "utf8")) : { spent: [], cells: {} };
const save = () => writeFileSync("journal.json", JSON.stringify(J, null, 2));
const OP_HASH = scriptHash(OP);

async function tip() {
  return parseInt((await rpc("get_tip_header")).number);
}
// Collect mature, unspent #0 cellbase cells (scan blocks; skip spent).
async function fundingCells(need) {
  const t = await tip();
  const out = [];
  for (let n = 0; n <= t - 45 && out.length < need; n++) {
    const b = await rpc("get_block_by_number", [hx(n)]);
    const cb = b.transactions[0];
    for (let i = 0; i < cb.outputs.length; i++) {
      const o = cb.outputs[i];
      if (o.lock.args === OP.args) {
        const op = { tx_hash: cb.hash, index: hx(i) };
        const key = op.tx_hash + ":" + op.index;
        if (J.spent.includes(key)) continue;
        const live = await rpc("get_live_cell", [op, false]);
        if (live.status === "live") out.push({ outPoint: op, capacity: live.cell.output.capacity, data: live.cell.data?.content ?? "0x" });
      }
    }
  }
  if (out.length < need) throw new Error(`only ${out.length} mature funding cells (tip ${t})`);
  return out;
}
function markSpent(ops) { for (const o of ops) J.spent.push(o.tx_hash + ":" + o.index); save(); }

// Build + sign + send a tx from (input cells with locks) to outputs.
async function buildTx({ inputs, outputs, outputsData, cellDeps, label }) {
  // inputs: [{outPoint, lock, type?, since?}]
  const withLocks = [];
  for (const inp of inputs) {
    const live = await getLive(inp.outPoint);
    withLocks.push({ ...inp, _lock: live.cell.output.lock, capacity: live.cell.output.capacity });
  }
  const inCap = withLocks.reduce((a, c) => a + BigInt(c.capacity), 0n);
  const outCap = outputs.reduce((a, o) => a + BigInt(o.capacity), 0n);
  if (inCap < outCap) throw new Error(`${label}: in ${inCap} < out ${outCap}`);
  const tx = {
    version: "0x0",
    cell_deps: cellDeps,
    header_deps: [],
    inputs: withLocks.map((c) => ({ previous_output: c.outPoint, since: c.since ?? "0x0", _lock: c._lock })),
    outputs: outputs.map((o) => ({ capacity: o.capacity, lock: o.lock, ...(o.type ? { type: o.type } : {}) })),
    outputs_data: outputsData,
    witnesses: withLocks.map(() => "0x"),
  };
  await signSighashGroups(tx, KEYS);
  const { groupInputsByLock } = await import("./chain.mjs");
  for (const g of groupInputsByLock(tx)) {
    if (KEYS[scriptHash(g.lock)] && tx.witnesses[g.idxs[0]] === "0x") {
      throw new Error(`${label}: signed group missing signature`);
    }
  }
  const clean = Object.fromEntries(Object.entries(tx).filter(([k]) => !k.startsWith("_")));
  clean.inputs = clean.inputs.map(({ _lock, ...i }) => i);
  const hash = await sendAndWait(clean, label);
  markSpent(withLocks.map((c) => c.outPoint));
  return hash;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EPOCH_ID = 497585;
async function main() {
  console.log("tip:", await tip());
  if (!J.code) {
    // TX1: deploy 4 code cells
    const funds = await fundingCells(2);
    const bins = ["registry-type", "epoch-type", "rewards-lock", "always-success"];
    const datas = bins.map((b) => `0x${readFileSync(`../dist/${b}`).toString("hex")}`);
    const outs = datas.map((d) => ({
      capacity: CKB(Math.ceil((d.length - 2) / 2) + 300), lock: OP,
    }));
    outs.push({ capacity: CKB(100000), lock: OP }); // change buffer
    const inCap = funds.slice(0, 2).reduce((a, c) => a + BigInt(c.capacity), 0n);
    outs[outs.length - 1].capacity = SH(inCap - outs.slice(0, 4).reduce((a, o) => a + BigInt(o.capacity), 0n) - 2n * SHANNON);
    await buildTx({
      inputs: funds.slice(0, 2).map((f) => ({ outPoint: f.outPoint })),
      outputs: outs, outputsData: [...datas, "0x"],
      cellDeps: [SECP_DEP], label: "TX1 deploy-code",
    });
    const h1 = (await rpc("get_tip_header")).number;
    J.deployTip = h1;
    // discover code outpoints: last tx outputs 0..3 — need tx hash; refetch via tip block scan
    const t = await tip();
    let found = null;
    for (let n = t; n > t - 15 && !found; n--) {
      const b = await rpc("get_block_by_number", [hx(n)]);
      for (const tx of b.transactions) {
        if (tx.outputs.length === 5 && tx.outputs_data[0]?.length > 40000) found = tx;
      }
    }
    if (!found) throw new Error("deploy tx not found");
    J.code = {};
    bins.forEach((b, i) => { J.code[b] = { tx_hash: found.hash, index: hx(i) }; });
    J.change = { tx_hash: found.hash, index: hx(4) };
    save();
    console.log("code cells:", JSON.stringify(J.code));
  }
  const codeDep = (b) => ({ out_point: J.code[b], dep_type: "code" });

  if (!J.registry) {
    // TX2: registry genesis (first input = change cell for Type-ID)
    const funds = await fundingCells(1);
    const first = J.change;
    const live0 = await getLive(first);
    const rid = computeRegistryId(first.tx_hash, parseInt(first.index));
    const rType = { code_hash: CODE.registry, hash_type: "data2", args: rid };
    const gdata = `0x${Buffer.from(encodeRegistry(rid, OP_HASH, [])).toString("hex")}`;
    const inCap = BigInt(live0.cell.output.capacity) + BigInt((await getLive(funds[0].outPoint)).cell.output.capacity);
    const regCap = CKB(500);
    await buildTx({
      inputs: [{ outPoint: first }, { outPoint: funds[0].outPoint }],
      outputs: [
        { capacity: regCap, lock: OP, type: rType },
        { capacity: SH(inCap - BigInt(regCap) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [gdata, "0x"],
      cellDeps: [SECP_DEP, codeDep("registry-type")], label: "TX2 registry-genesis",
    });
    const t = await tip();
    let found = null;
    for (let n = t; n > t - 15 && !found; n--) {
      const b = await rpc("get_block_by_number", [hx(n)]);
      for (const tx of b.transactions) {
        if (tx.outputs.some((o) => o.type?.args === rid)) found = tx;
      }
    }
    if (!found) throw new Error("genesis tx not found");
    const ri = found.outputs.findIndex((o) => o.type?.args === rid);
    J.registry = { id: rid, cell: { tx_hash: found.hash, index: hx(ri) }, type: rType };
    J.change = { tx_hash: found.hash, index: hx(1 - ri) };
    save();
    console.log("registry:", rid);
  }

  async function syncRegistry() {
    // Resync J.registry.cell to the live tip-most registry cell (repair stale
    // pointers after a crash between commit and journal update).
    const t = await tip();
    let best = null;
    for (let n = t; n > t - 40 && n >= 0; n--) {
      const b = await rpc("get_block_by_number", [hx(n)]);
      for (const tx of b.transactions) {
        for (let i = 0; i < tx.outputs.length; i++) {
          const o = tx.outputs[i];
          if (o.type?.args === J.registry.id) {
            const op = { tx_hash: tx.hash, index: hx(i) };
            const live = await rpc("get_live_cell", [op, false]);
            if (live.status === "live" && (!best || tx.outputs_data[i].length > best.len)) {
              best = { cell: op, len: tx.outputs_data[i].length };
            }
          }
        }
      }
    }
    if (!best) throw new Error("syncRegistry: no live registry cell found");
    J.registry.cell = best.cell;
    save();
  }
  async function register(nodeLock, uuid, prevCell, label) {
    const funds = await fundingCells(1);
    const prev = await getLive(prevCell);
    const prevData = prev.cell.data.content;
    // decode prev nodes via shared-ts? use core counts: parse count at [64..68]
    const raw = Buffer.from(prevData.slice(2), "hex");
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
    const { nodeIdFor } = await import("../shared-ts/src/index.ts");
    const wh = scriptHash(nodeLock);
    const nid = nodeIdFor(wh, uuid);
    if (entries.some((e) => e.nodeId.toLowerCase() === nid.toLowerCase())) {
      console.log(`${label}: node already registered, skipping`);
      return nid;
    }
    entries.push({ nodeId: nid, walletLockHash: wh, eligible: true, beats: 20, bytes: 204800 });
    const { encodeRegistry: enc } = await import("../shared-ts/src/index.ts");
    const next = `0x${Buffer.from(enc(J.registry.id, OP_HASH, entries)).toString("hex")}`;
    const inCap = BigInt(prev.cell.output.capacity) + BigInt((await getLive(funds[0].outPoint)).cell.output.capacity);
    const regCap = CKB(600);
    await buildTx({
      inputs: [{ outPoint: prevCell }, { outPoint: funds[0].outPoint }],
      outputs: [
        { capacity: regCap, lock: OP, type: J.registry.type },
        { capacity: SH(inCap - BigInt(regCap) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [next, "0x"],
      cellDeps: [SECP_DEP, codeDep("registry-type")], label,
    });
    const t = await tip();
    for (let n = t; n > t - 15; n--) {
      const b = await rpc("get_block_by_number", [hx(n)]);
      for (const tx of b.transactions) {
        const i = tx.outputs.findIndex((o) => o.type?.args === J.registry.id);
        if (i >= 0 && tx.outputs_data[i]?.length > prevData.length) {
          J.registry.cell = { tx_hash: tx.hash, index: hx(i) };
          const ci = i === 0 ? 1 : 0;
          J.change = { tx_hash: tx.hash, index: hx(ci) };
          save();
          console.log(`${label}: node ${nid.slice(0, 12)}.. registered`);
          return nid;
        }
      }
    }
    throw new Error(`${label}: register tx not found`);
  }
  if (!J.n1) {
    await syncRegistry();
    J.n1 = await register(N1, "node-1-uuid", J.registry.cell, "TX3 register-n1"); save();
  }
  if (!J.n2) {
    await syncRegistry();
    J.n2 = await register(N2, "node-2-uuid", J.registry.cell, "TX4 register-n2"); save();
  }

  if (!J.epoch) {
    // TX5: epoch close
    const funds = await fundingCells(1);
    const shared = await import("../shared-ts/src/index.ts");
    const totals = [
      { nodeId: J.n1, bytes: 204800, beats: 20 },
      { nodeId: J.n2, bytes: 102400, beats: 0 },
    ].map((t) => ({ ...t, ...shared.computePoints(t.bytes, t.beats) }));
    const leaves = totals.map((t) => shared.pointsLeaf(t.nodeId, t.netPts, t.upPts, t.bytes));
    const root = shared.merkleRoot(leaves);
    const evidence = {
      schema: "bees-network/epoch-v1", chainId: "ckb-devnet", epochId: EPOCH_ID,
      perNode: totals, jobsSample: [], spotChecks: [],
    };
    const evHash = shared.evidenceHash(shared.canonicalJson(evidence));
    const rLeaves = totals.map((t) => shared.rewardLeaf(EPOCH_ID, t.nodeId,
      t.nodeId === J.n1 ? scriptHash(N1) : scriptHash(N2), t.netPts, t.upPts, t.bytes, 0));
    const rRoot = shared.merkleRoot(rLeaves);
    const epochArgs = (await import("../shared-ts/src/index.ts")).epochTypeArgs(EPOCH_ID, J.registry.id);
    const eType = { code_hash: CODE.epoch, hash_type: "data2", args: epochArgs };
    const edata = `0x${Buffer.from(shared.encodeEpoch(EPOCH_ID, J.registry.id, root, evHash, 0, rRoot)).toString("hex")}`;
    const inCap = BigInt((await getLive(funds[0].outPoint)).cell.output.capacity);
    const eCap = CKB(300);
    await buildTx({
      inputs: [{ outPoint: funds[0].outPoint }],
      outputs: [
        { capacity: eCap, lock: OP, type: eType },
        { capacity: SH(inCap - BigInt(eCap) - 2n * SHANNON), lock: OP },
      ],
      outputsData: [edata, "0x"],
      cellDeps: [SECP_DEP, codeDep("epoch-type")], label: "TX5 epoch-close",
    });
    const t = await tip();
    let foundEp = false;
    for (let n = t; n > t - 15 && !foundEp; n--) {
      const b = await rpc("get_block_by_number", [hx(n)]);
      for (const tx of b.transactions) {
        const i = tx.outputs.findIndex((o) => o.type?.args === epochArgs);
        if (i >= 0) {
          J.epoch = { id: EPOCH_ID, cell: { tx_hash: tx.hash, index: hx(i) }, type: eType, root, evHash, rRoot, totals };
          save();
          console.log(`TX5: epoch root=${root.slice(0, 18)}.. ev=${evHash.slice(0, 18)}..`);
          foundEp = true;
          break;
        }
      }
    }
    if (!foundEp) throw new Error("TX5: epoch tx not found");
  }

  if (!J.claims) {
    // TX6: fund claim cells (points-only, amount 0)
    const funds = await fundingCells(1);
    const shared = await import("../shared-ts/src/index.ts");
    const wOf = (nid) => (nid === J.n1 ? scriptHash(N1) : scriptHash(N2));
    const outs = J.epoch.totals.map((t) => {
      const lock = { code_hash: CODE.rewards, hash_type: "data2",
        args: shared.rewardsLockArgs(EPOCH_ID, J.epoch.rRoot) };
      const data = `0x${Buffer.from(shared.encodeShare(EPOCH_ID, t.nodeId, wOf(t.nodeId), t.netPts, t.upPts, t.bytes, 0)).toString("hex")}`;
      return { lock, data, capacity: CKB(300) };
    });
    const inCap = BigInt((await getLive(funds[0].outPoint)).cell.output.capacity);
    const sum = outs.reduce((a, o) => a + BigInt(o.capacity), 0n);
    await buildTx({
      inputs: [{ outPoint: funds[0].outPoint }],
      outputs: [...outs.map(({ lock, capacity }) => ({ capacity, lock })), { capacity: SH(inCap - sum - 2n * SHANNON), lock: OP }],
      outputsData: [...outs.map((o) => o.data), "0x"],
      cellDeps: [SECP_DEP], label: "TX6 fund-claims",
    });
    const t = await tip();
    let foundF = false;
    for (let n = t; n > t - 15 && !foundF; n--) {
      const b = await rpc("get_block_by_number", [hx(n)]);
      for (const tx of b.transactions) {
        if (tx.outputs.length === 3 && tx.outputs[0].lock?.code_hash === CODE.rewards &&
            tx.outputs_data[0]?.length === 226) {
          J.claims = [0, 1].map((i) => ({ tx_hash: tx.hash, index: hx(i) }));
          J.change = { tx_hash: tx.hash, index: hx(2) };
          save();
          console.log("TX6: claim cells funded");
          foundF = true;
          break;
        }
      }
    }
    if (!foundF) throw new Error("TX6: fund tx not found");
  }

  if (!J.claimed) {
    // TX7: claim n1 share. inputs: claim cell (rewards-lock) + #0 fund (sighash).
    const shared = await import("../shared-ts/src/index.ts");
    const t0 = J.epoch.totals[0];
    const l0 = shared.rewardLeaf(EPOCH_ID, t0.nodeId, scriptHash(N1), t0.netPts, t0.upPts, t0.bytes, 0);
    const l1 = shared.rewardLeaf(EPOCH_ID, J.epoch.totals[1].nodeId, scriptHash(N2),
      J.epoch.totals[1].netPts, J.epoch.totals[1].upPts, J.epoch.totals[1].bytes, 0);
    const proof = shared.merkleProof([l0, l1], 0);
    const { encodeProofForWitness } = await import("../ckb-client/src/client.ts");
    const witRewards = encodeProofForWitness(proof);
    const c0 = await getLive(J.claims[0]);
    const funds = await fundingCells(1);
    const fCell = await getLive(funds[0].outPoint);
    const inCap = BigInt(c0.cell.output.capacity) + BigInt(fCell.cell.output.capacity);
    const tx = {
      version: "0x0",
      cell_deps: [
        { out_point: J.code["rewards-lock"], dep_type: "code" },
        { out_point: J.epoch.cell, dep_type: "code" },
        SECP_DEP,
      ],
      header_deps: [],
      inputs: [
        { previous_output: J.claims[0], since: "0x0", _lock: c0.cell.output.lock },
        { previous_output: funds[0].outPoint, since: "0x0", _lock: fCell.cell.output.lock },
      ],
      outputs: [{ capacity: SH(inCap - 2n * SHANNON), lock: N1 }],
      outputs_data: ["0x"],
      witnesses: [witRewards, "0x"],
    };
    // keep rewards witness fixed; sign only sighash group
    tx._witMeta = { 1: {} };
    await signSighashGroups(tx, KEYS);
    const clean = { version: tx.version, cell_deps: tx.cell_deps, header_deps: tx.header_deps,
      inputs: tx.inputs.map(({ _lock, ...i }) => i), outputs: tx.outputs,
      outputs_data: tx.outputs_data, witnesses: tx.witnesses };
    const hash = await sendAndWait(clean, "TX7 claim-n1");
    markSpent([J.claims[0], funds[0].outPoint]);
    J.claimed = { tx: hash };
    save();
  }

  // Final verification
  console.log("--- verify ---");
  const reg = await getLive(J.registry.cell);
  console.log("registry live, data len:", (reg.cell.data.content.length - 2) / 2);
  const ep = await getLive(J.epoch.cell);
  console.log("epoch live, data len:", (ep.cell.data.content.length - 2) / 2);
  const c1 = await rpc("get_live_cell", [J.claims[0], false]);
  console.log("claim0 status (expect dead):", c1.status);
  const c2 = await getLive(J.claims[1]);
  console.log("claim1 status (expect live):", c2.status);
  console.log("DONE");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
