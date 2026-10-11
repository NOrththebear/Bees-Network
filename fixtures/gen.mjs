// Fixture generator for `ckb-cli mock-tx verify`.
// All cells locked by always-success (inputs execute it unconditionally) so
// fixtures test OUR validation logic, not secp signatures.
// Usage: node fixtures/gen.mjs  (writes fixtures/*.json)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  ckbHashBytes, bytesToHex, hexToBytes,
  encodeRegistry, encodeEpoch, encodeShare,
  rewardLeaf, merkleRoot, merkleProof,
  canonicalJson, evidenceHash,
} from "../shared-ts/src/index.ts";
import { computeRegistryId } from "../ckb-client/src/client.ts";

const te = new TextEncoder();
const H = (s) => bytesToHex(ckbHashBytes(typeof s === "string" ? te.encode(s) : s));
const BIG_CAP = "0xE8D4A51000"; // 10_000 CKB, passes occupied checks with margin
const ZERO32 = `0x${"00".repeat(32)}`;

const bin = (n) => `0x${readFileSync(new URL(`../dist/${n}`, import.meta.url)).toString("hex")}`;
const REG_BIN = bin("registry-type"), EPOCH_BIN = bin("epoch-type"),
      REWARD_BIN = bin("rewards-lock"), ALWAYS_BIN = bin("always-success");
const REG_HASH = H(hexToBytes(REG_BIN)), EPOCH_HASH = H(hexToBytes(EPOCH_BIN)),
      REWARD_HASH = H(hexToBytes(REWARD_BIN)), ALWAYS_HASH = H(hexToBytes(ALWAYS_BIN));

// Molecule Script{code_hash:Byte32, hash_type:byte, args:Bytes(fixvec: count+items)}
function molScript(codeHash, hashTypeByte, argsHex) {
  const args = hexToBytes(argsHex);
  const total = 4 + 12 + 32 + 1 + 4 + args.length;
  const o = new Uint8Array(total);
  const dv = new DataView(o.buffer);
  dv.setUint32(0, total, true);
  dv.setUint32(4, 16, true); dv.setUint32(8, 48, true); dv.setUint32(12, 49, true);
  o.set(hexToBytes(codeHash), 16);
  o[48] = hashTypeByte;
  dv.setUint32(49, args.length, true);
  o.set(args, 53);
  return o;
}
const scriptHash = (codeHash, ht, args) => bytesToHex(ckbHashBytes(molScript(codeHash, ht, args)));
// hash_type data2 == 4
const HT_DATA2 = 4;

// WitnessArgs{lock:BytesOpt, input_type:BytesOpt, output_type:BytesOpt}
// Some(bytes) = fixvec(count+items); None = empty.
function molWitnessArgs(lockHexOrNull, inputHexOrNull, outputHexOrNull) {
  const enc = (h) => {
    if (h == null) return new Uint8Array(0);
    const raw = hexToBytes(h);
    const o = new Uint8Array(4 + raw.length);
    new DataView(o.buffer).setUint32(0, raw.length, true);
    o.set(raw, 4);
    return o;
  };
  const parts = [enc(lockHexOrNull), enc(inputHexOrNull), enc(outputHexOrNull)];
  const total = 16 + parts[0].length + parts[1].length + parts[2].length;
  const o = new Uint8Array(total);
  const dv = new DataView(o.buffer);
  dv.setUint32(0, total, true);
  let off = 16;
  for (let i = 0; i < 3; i++) { dv.setUint32(4 + i * 4, off, true); off += parts[i].length; }
  o.set(parts[0], 16); o.set(parts[1], 16 + parts[0].length);
  o.set(parts[2], 16 + parts[0].length + parts[1].length);
  return bytesToHex(o);
}

const OP_LOCK = { code_hash: ALWAYS_HASH, hash_type: "data2", args: "0x" };
const OP_HASH = scriptHash(ALWAYS_HASH, HT_DATA2, "0x");
const OTHER_LOCK = { code_hash: ALWAYS_HASH, hash_type: "data2", args: "0x01" };

const FAKE = (c) => `0x${c.repeat(64)}`;
const TX_A = FAKE("a"), TX_B = FAKE("b"), TX_C = FAKE("c"), TX_D = FAKE("d");

function mockCell(outPoint, lock, type, dataHex) {
  return {
    cell_dep: { dep_type: "code", out_point: outPoint },
    data: dataHex,
    header: null,
    output: { capacity: BIG_CAP, lock, type: type ?? null },
  };
}
function codeDep(tag, dataHex) {
  return mockCell({ tx_hash: tag, index: "0x0" }, OP_LOCK, null, dataHex);
}
function txCellDep(tag) {
  return { dep_type: "code", out_point: { tx_hash: tag, index: "0x0" } };
}
function inputCell(txHash, lock, type, dataHex) {
  const inp = { previous_output: { tx_hash: txHash, index: "0x0" }, since: "0x0" };
  return {
    txIn: inp,
    mockIn: { input: inp, data: dataHex, header: null,
              output: { capacity: BIG_CAP, lock, type: type ?? null } },
  };
}
function buildMock({ cellDeps, inputs, tx }) {
  const { cellDeps: _cd, ...txRest } = tx;
  return { mock_info: { cell_deps: cellDeps, extensions: [], header_deps: [], inputs: inputs.map((i) => i.mockIn) },
           tx: { ...txRest, cell_deps: tx.cellDeps, inputs: inputs.map((i) => i.txIn) } };
}
const bx = (u8) => bytesToHex(u8);
const le64 = (n) => { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(n), true); return o; };
const concat = (...ps) => { const o = new Uint8Array(ps.reduce((a, p) => a + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
const N = (s) => H(s); // node/wallet ids

const EPOCH_ID = 497585;
const cases = {};
function add(name, mock, expectOk) { cases[name] = { mock, expectOk }; }

// ---- 1. registry genesis ok ----
{
  const rid = computeRegistryId(TX_A, 0);
  const rType = { code_hash: REG_HASH, hash_type: "data2", args: rid };
  const inp = inputCell(TX_A, OP_LOCK, null, "0x");
  const mock = buildMock({
    cellDeps: [codeDep(TX_B, REG_BIN), codeDep(TX_C, ALWAYS_BIN)],
    inputs: [inp],
    tx: { cellDeps: [txCellDep(TX_B), txCellDep(TX_C)],
      header_deps: [], version: "0x0", witnesses: ["0x"],
      outputs: [{ capacity: BIG_CAP, lock: OP_LOCK, type: rType }],
      outputs_data: [bx(encodeRegistry(rid, OP_HASH, []))] },
  });
  add("registry-genesis-ok", mock, true);
}
// ---- 2. registry genesis bad id ----
{
  const rid = computeRegistryId(TX_A, 0);
  const bad = `0x${"11".repeat(32)}`;
  const rType = { code_hash: REG_HASH, hash_type: "data2", args: bad };
  const inp = inputCell(TX_A, OP_LOCK, null, "0x");
  const mock = buildMock({
    cellDeps: [codeDep(TX_B, REG_BIN), codeDep(TX_C, ALWAYS_BIN)],
    inputs: [inp],
    tx: { cellDeps: [txCellDep(TX_B), txCellDep(TX_C)],
      header_deps: [], version: "0x0", witnesses: ["0x"],
      outputs: [{ capacity: BIG_CAP, lock: OP_LOCK, type: rType }],
      outputs_data: [bx(encodeRegistry(bad, OP_HASH, []))] },
  });
  add("registry-genesis-bad-id", mock, false);
}
// ---- 3/4/5. registry append ok / dup / nonoperator ----
{
  const rid = computeRegistryId(TX_A, 0);
  const rType = { code_hash: REG_HASH, hash_type: "data2", args: rid };
  const n1 = { nodeId: N("node1"), walletLockHash: N("w1"), eligible: true, beats: 20, bytes: 102400 };
  const n2 = { nodeId: N("node2"), walletLockHash: N("w2"), eligible: true, beats: 0, bytes: 0 };
  const prev = [n1];
  const prevData = bx(encodeRegistry(rid, OP_HASH, prev));
  const mkAppend = (nextNodes, inLock, dataOut) => {
    const inp = inputCell(TX_D, inLock, rType, prevData);
    return buildMock({
      cellDeps: [codeDep(TX_B, REG_BIN), codeDep(TX_C, ALWAYS_BIN)],
      inputs: [inp],
      tx: { cellDeps: [txCellDep(TX_B), txCellDep(TX_C)],
        header_deps: [], version: "0x0", witnesses: ["0x"],
        outputs: [{ capacity: BIG_CAP, lock: OP_LOCK, type: rType }],
        outputs_data: [dataOut] },
    });
  };
  add("registry-append-ok", mkAppend([n1, n2], OP_LOCK, bx(encodeRegistry(rid, OP_HASH, [n1, n2]))), true);
  // dup: hand-encode unsorted raw with duplicate (bypass TS sorter)
  const dupRaw = (() => {
    const good = encodeRegistry(rid, OP_HASH, [n1, n2]);
    // append a copy of first entry bytes at end + bump count: easiest is manual concat
    const hdr = good.slice(0, 68);
    const e1 = good.slice(68, 68 + 81);
    const count = new Uint8Array([3, 0, 0, 0]);
    const raw = concat(hexToBytes(rid), hexToBytes(OP_HASH), count, e1, e1, e1);
    return bx(raw);
  })();
  add("registry-append-dup", mkAppend(null, OP_LOCK, dupRaw), false);
  // flip by non-operator: input lock differs from data.operator
  const flipped = [{ ...n1, eligible: false }];
  add("registry-flip-nonoperator", mkAppend(flipped, OTHER_LOCK, bx(encodeRegistry(rid, OP_HASH, flipped))), false);
}
// ---- 6/7/8. epoch mint ok / zero root / double close ----
{
  const rid = computeRegistryId(TX_A, 0);
  const epochArgs = bx(concat(le64(EPOCH_ID), hexToBytes(rid)));
  const eType = { code_hash: EPOCH_HASH, hash_type: "data2", args: epochArgs };
  const root = H("points-root"), ev = H(canonicalJson({ epoch: EPOCH_ID })), rr = H("rewards");
  const mkMint = (dataHex, inputs) => buildMock({
    cellDeps: [codeDep(TX_B, EPOCH_BIN), codeDep(TX_C, ALWAYS_BIN)],
    inputs,
    tx: { cellDeps: [txCellDep(TX_B), txCellDep(TX_C)],
      header_deps: [], version: "0x0", witnesses: inputs.map(() => "0x"),
      outputs: [{ capacity: BIG_CAP, lock: OP_LOCK, type: eType }],
      outputs_data: [dataHex] },
  });
  const fundIn = () => inputCell(TX_A, OP_LOCK, null, "0x");
  add("epoch-mint-ok",
    mkMint(bx(encodeEpoch(EPOCH_ID, rid, root, ev, 0, rr)), [fundIn()]), true);
  add("epoch-mint-zero-root",
    mkMint(bx(encodeEpoch(EPOCH_ID, rid, ZERO32, ev, 0, rr)), [fundIn()]), false);
  // double close: consume existing epoch cell (same type group 1x1)
  const oldData = bx(encodeEpoch(EPOCH_ID, rid, root, ev, 0, rr));
  add("epoch-double-close",
    mkMint(oldData, [inputCell(TX_D, OP_LOCK, eType, oldData)]), false);
}
// ---- 9/10/11. rewards claim ok / bad proof / wrong wallet ----
{
  const rid = computeRegistryId(TX_A, 0);
  const epochArgs = bx(concat(le64(EPOCH_ID), hexToBytes(rid)));
  const eType = { code_hash: EPOCH_HASH, hash_type: "data2", args: epochArgs };
  const n1 = N("node1"), n2 = N("node2");
  const w1 = OP_HASH; // payout lock == OP_LOCK so script_hash matches
  const l1 = rewardLeaf(EPOCH_ID, n1, w1, 10, 2, 204800, 100);
  const l2 = rewardLeaf(EPOCH_ID, n2, N("w2"), 5, 1, 102400, 50);
  const root = merkleRoot([l1, l2]);
  const proof0 = merkleProof([l1, l2], 0);
  const proofHex = bx(concat(...proof0.map(hexToBytes)));
  const epochData = bx(encodeEpoch(EPOCH_ID, rid, H("points"), H("ev"), 150, root));
  const rLock = { code_hash: REWARD_HASH, hash_type: "data2", args: bx(concat(le64(EPOCH_ID), hexToBytes(root))) };
  const share1 = bx(encodeShare(EPOCH_ID, n1, w1, 10, 2, 204800, 100));
  const witOk = molWitnessArgs(null, proofHex, null);
  const mkClaim = (shareData, wit, outLock) => {
    const inp = inputCell(TX_D, rLock, null, shareData);
    return buildMock({
      cellDeps: [codeDep(TX_B, REWARD_BIN), codeDep(TX_C, ALWAYS_BIN),
                 mockCell({ tx_hash: FAKE("e"), index: "0x0" }, OP_LOCK, eType, epochData)],
      inputs: [inp],
      tx: { cellDeps: [txCellDep(TX_B), txCellDep(TX_C),
                       { dep_type: "code", out_point: { tx_hash: FAKE("e"), index: "0x0" } }],
        header_deps: [], version: "0x0", witnesses: [wit],
        outputs: [{ capacity: BIG_CAP, lock: outLock, type: null }],
        outputs_data: ["0x"] },
    });
  };
  add("rewards-claim-ok", mkClaim(share1, witOk, OP_LOCK), true);
  const badProof = bx(concat(hexToBytes(H("evil-sibling"))));
  add("rewards-claim-bad-proof", mkClaim(share1, molWitnessArgs(null, badProof, null), OP_LOCK), false);
  add("rewards-claim-wrong-wallet", mkClaim(share1, witOk, OTHER_LOCK), false);
}

mkdirSync(new URL(".", import.meta.url), { recursive: true });
for (const [name, { mock, expectOk }] of Object.entries(cases)) {
  writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify({ ...mock, _expectOk: expectOk }));
  console.log(`${expectOk ? "PASS-EXPECTED" : "FAIL-EXPECTED"}  ${name}.json`);
}
console.log(`code hashes: reg=${REG_HASH} epoch=${EPOCH_HASH} rewards=${REWARD_HASH} always=${ALWAYS_HASH}`);
console.log(`operator lock hash: ${OP_HASH}`);
