// Bees Network coordinator (v0.1, demo).
//
// Reads the orchestrator's live beat/byte tally, joins it with the on-chain
// registry (eligible nodes + wallet lock hashes), computes points, and mints
// ONE epoch cell plus one rewards-lock share cell per earning node. Nodes then
// claim their share from the desktop app.
//
// Usage:  CKB_RPC=https://testnet.ckb.dev node coordinator.mjs
// Env:    ORCHESTRATOR_URL (default http://127.0.0.1:8080)
//         EPOCH_ID (default: latest on-chain epoch id + 1)
//         POOL     (default 1e18 tRELAY units, off-chain bookkeeping)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { rpc, scriptHash, signSighashGroups, sendAndWait, getLive, groupInputsByLock } from "./chain.mjs";
import {
  computePoints, encodeEpoch, encodeShare, rewardLeaf, merkleRoot,
  canonicalJson, evidenceHash, epochTypeArgs, rewardsLockArgs, pointsLeaf,
} from "../shared-ts/src/index.ts";

const SECP = { code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hash_type: "type" };
const OP = { ...SECP, args: "0x8e42b1999f265a0078503c4acec4d5e134534297" };
const OP_KEY = "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6";
const SECP_DEP = { out_point: { tx_hash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37", index: "0x0" }, dep_type: "dep_group" };
const CODE = {
  registry: "0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8",
  epoch: "0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1",
  rewards: "0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84",
};
// Code cell tx (rewards :0x2, epoch :0x1). Redeployed under a dedicated code
// lock so funding selection can never spend the contract code (see
// deploy/recover-code.mjs).
const CODE_TX = "0xd17ade10703f2c492e8fcf1543ed6723403a6ec2f1b14683ecf8b713bbf62c71";
const REGISTRY_ID = "0x1693da11047c21d4995d5f2d71f09dc8f102368761c14d931a4a979c28117db7";
const OP_HASH = scriptHash(OP);
// Contract code now lives under a dedicated code lock (see recover-code.mjs),
// so funding selection can never consume it. No outpoint exclusions needed.
const PROTECTED = new Set();
const ORCH = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8080";
// Reward economics: each epoch pays every earning node
//   credits = BASE_REWARD_CKB + points * CKB_PER_POINT   (in CKB)
// where points = netPts + upPts. The reward IS the share cell capacity, so the
// CREDITS a node sees equal the CKB it actually receives and scale with its
// observation activity. BASE also covers the share cell's occupied capacity.
const BASE_REWARD_CKB = BigInt(process.env.BASE_REWARD_CKB ?? "200");
const CKB_PER_POINT = BigInt(process.env.CKB_PER_POINT ?? "10");
const SHANNON = 100_000_000n;
const CKB = (n) => "0x" + (BigInt(n) * SHANNON).toString(16);
const SH = (bi) => "0x" + BigInt(bi).toString(16);
const hx = (b) => `0x${b.toString(16)}`;
const KEYS = { [OP_HASH]: OP_KEY };

async function tally() {
  const r = await fetch(`${ORCH}/admin/tally`);
  if (!r.ok) throw new Error(`tally ${r.status}`);
  return (await r.json()).nodes ?? [];
}

async function registryCell() {
  const res = await rpc("get_cells", [
    { script: { code_hash: CODE.registry, hash_type: "data2", args: REGISTRY_ID }, script_type: "type", script_search_mode: "exact", with_data: true },
    "asc", "0x1",
  ]);
  const o = res.objects[0];
  if (!o) throw new Error("registry cell not found");
  return { outPoint: o.out_point, data: Buffer.from(o.output_data.slice(2), "hex") };
}

function decodeRegistry(raw) {
  const cnt = raw.readUInt32LE(64);
  const entries = [];
  for (let i = 0; i < cnt; i++) {
    const o = 68 + i * 81;
    entries.push({
      nodeId: `0x${raw.subarray(o, o + 32).toString("hex")}`,
      walletLockHash: `0x${raw.subarray(o + 32, o + 64).toString("hex")}`,
      eligible: raw[o + 64] === 1,
      beats: raw.readBigUInt64LE(o + 65),
      bytes: raw.readBigUInt64LE(o + 73),
    });
  }
  return entries;
}

async function latestEpoch() {
  const res = await rpc("get_cells", [
    { script: { code_hash: CODE.epoch, hash_type: "data2", args: "0x" }, script_type: "type", script_search_mode: "prefix", with_data: true },
    "asc", "0x64",
  ]);
  let best = null;
  for (const o of res.objects) {
    const b = Buffer.from(o.output_data.slice(2), "hex");
    if (b.length !== 158) continue;
    const id = b.readBigUInt64LE(6);
    if (!best || id > best.id) {
      best = { id, rewardsRoot: `0x${b.subarray(126, 158).toString("hex")}` };
    }
  }
  return best;
}

// Count live (unclaimed) reward/share cells for an epoch.
async function unclaimedShares(epochId, rewardsRoot) {
  const lock = { code_hash: CODE.rewards, hash_type: "data2", args: rewardsLockArgs(epochId, rewardsRoot) };
  const res = await rpc("get_cells", [
    { script: lock, script_type: "lock", script_search_mode: "exact" },
    "asc", "0x64",
  ]);
  return res.objects.length;
}

async function pickFunding(minShannons) {
  const out = [];
  let cap = 0n;
  let cursor = null;
  for (let page = 0; page < 60; page++) {
    const params = [{ script: OP, script_type: "lock", script_search_mode: "exact" }, "asc", "0x64"];
    if (cursor) params.push(cursor);
    const res = await rpc("get_cells", params);
    for (const c of res.objects) {
      if (c.output.type) continue; // typed cells can't be spent as plain funding
      if (PROTECTED.has(`${c.out_point.tx_hash}:${c.out_point.index}`)) continue;
      out.push(c.out_point);
      cap += BigInt(c.output.capacity);
      if (cap >= minShannons) break;
    }
    if (cap >= minShannons) break;
    if (!res.last_cursor || res.objects.length === 0) break;
    cursor = res.last_cursor;
  }
  if (cap < minShannons) throw new Error(`insufficient operator funds: have ${cap}, need ${minShannons}`);
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

export async function runCoordinator() {
  const t = await tally();
  const byNode = new Map(t.map((n) => [n.node_id.toLowerCase(), n]));
  const reg = decodeRegistry((await registryCell()).data);

  const earners = [];
  for (const e of reg) {
    if (!e.eligible) continue;
    const n = byNode.get(e.nodeId.toLowerCase());
    if (!n || (n.beats === 0 && n.bytes === 0)) continue;
    const { netPts, upPts } = computePoints(n.bytes, n.beats);
    earners.push({ nodeId: e.nodeId, wallet: e.walletLockHash, netPts, upPts, bytes: n.bytes, beats: n.beats });
  }
  if (earners.length === 0) {
    console.log("No earning nodes (no beats/bytes in tally). Nothing to close.");
    return { closed: false, earners: 0 };
  }

  // Guard: minting a new epoch while the head epoch is still unclaimed wastes
  // operator capacity (the desktop app only claims the latest epoch and would
  // never reach the older shares). Wait for the head to be claimed first.
  let epochId;
  if (process.env.EPOCH_ID) {
    epochId = BigInt(process.env.EPOCH_ID);
  } else {
    const head = await latestEpoch();
    if (head) {
      const pending = await unclaimedShares(head.id, head.rewardsRoot);
      if (pending > 0) {
        console.log(`epoch ${head.id} still has ${pending} unclaimed share(s); waiting for claim before closing a new epoch.`);
        return { closed: false, reason: "unclaimed", epochId: Number(head.id) };
      }
      epochId = head.id + 1n;
    } else {
      epochId = 1n;
    }
  }

  // Points ledger (epoch.merkle_root).
  const pLeaves = earners.map((e) => pointsLeaf(e.nodeId, e.netPts, e.upPts, e.bytes));
  const mroot = merkleRoot(pLeaves);

  // Rewards ledger: credits proportional to each node's observation points,
  // plus a base grant. amount is in shannons and is also the payout capacity.
  const BASE = BASE_REWARD_CKB * SHANNON;
  const RATE = CKB_PER_POINT * SHANNON;
  const shares = earners.map((e) => {
    const pts = BigInt(e.netPts + e.upPts);
    return { ...e, amount: BASE + pts * RATE };
  });
  const poolTotal = shares.reduce((a, s) => a + s.amount, 0n);
  const rLeaves = shares.map((s) => rewardLeaf(epochId, s.nodeId, s.wallet, s.netPts, s.upPts, s.bytes, s.amount));
  const rRoot = merkleRoot(rLeaves);

  const evidence = {
    schema: "bees-network/epoch-v1", chainId: "ckb-pudge-testnet", epochId: Number(epochId),
    perNode: earners.map((e) => ({ nodeId: e.nodeId, bytes: e.bytes, beats: e.beats, netPts: e.netPts, upPts: e.upPts })),
    jobsSample: [], spotChecks: [],
  };
  const evHash = evidenceHash(canonicalJson(evidence));

  console.log(`epoch ${epochId}: ${earners.length} earner(s), root=${mroot.slice(0, 18)}.. rewards_root=${rRoot.slice(0, 18)}..`);

  const epochArgs = epochTypeArgs(epochId, REGISTRY_ID);
  const eType = { code_hash: CODE.epoch, hash_type: "data2", args: epochArgs };
  const edata = `0x${Buffer.from(encodeEpoch(epochId, REGISTRY_ID, mroot, evHash, poolTotal, rRoot)).toString("hex")}`;

  const outputs = [{ capacity: CKB(300), lock: OP, type: eType }];
  const datas = [edata];
  for (const s of shares) {
    const lock = { code_hash: CODE.rewards, hash_type: "data2", args: rewardsLockArgs(epochId, rRoot) };
    datas.push(`0x${Buffer.from(encodeShare(epochId, s.nodeId, s.wallet, s.netPts, s.upPts, s.bytes, s.amount)).toString("hex")}`);
    // The share cell carries the node's credits as its capacity (real payout).
    outputs.push({ capacity: SH(s.amount), lock });
  }

  const need = outputs.reduce((a, o) => a + BigInt(o.capacity), 0n) + 3n * SHANNON;
  const fund = await pickFunding(need);
  const change = fund.cap - outputs.reduce((a, o) => a + BigInt(o.capacity), 0n) - 3n * SHANNON;
  outputs.push({ capacity: SH(change), lock: OP });
  datas.push("0x");

  const hash = await buildTx({
    inputs: fund.outPoints,
    outputs,
    outputsData: datas,
    cellDeps: [SECP_DEP, { out_point: { tx_hash: CODE_TX, index: "0x1" }, dep_type: "code" }, { out_point: { tx_hash: CODE_TX, index: "0x2" }, dep_type: "code" }],
    label: `coordinator close epoch ${epochId}`,
  });

  console.log(`epoch ${epochId} closed: tx=${hash}`);
  console.log(`  epoch cell: ${hash}:0x0`);
  for (let i = 0; i < shares.length; i++) {
    console.log(`  share ${shares[i].nodeId.slice(0, 12)}.. -> cell ${hash}:0x${(i + 1).toString(16)} amount=${shares[i].amount}`);
  }
  const jp = "coordinator-journal.json";
  const J = existsSync(jp) ? JSON.parse(readFileSync(jp, "utf8")) : { epochs: [] };
  J.epochs.push({ epochId: Number(epochId), tx: hash, earners: earners.length });
  writeFileSync(jp, JSON.stringify(J, null, 2));
  return { closed: true, tx: hash, epochId: Number(epochId), earners: earners.length };
}

// Only auto-run when invoked directly (not when imported by the loop).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCoordinator().catch((e) => { console.error("FATAL:", e?.stack ?? e); process.exit(1); });
}
