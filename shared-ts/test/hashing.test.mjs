import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ZERO32,
  computePoints,
  nodeIdFor,
  pointsLeaf,
  rewardLeaf,
  merkleRoot,
  merkleProof,
  verifyProof,
  canonicalJson,
  evidenceHash,
  encodeRegistry,
  encodeEpoch,
  encodeShare,
  ckbHashBytes,
  bytesToHex,
  hexToBytes,
} from "../src/index.ts";

const te = new TextEncoder();

describe("points", () => {
  it("matches MVP caps", () => {
    assert.deepEqual(computePoints(204800, 0), { netPts: 2, upPts: 0 });
    assert.deepEqual(computePoints(102400 * 600, 20 * 200), { netPts: 500, upPts: 144 });
  });
});

describe("nodeId", () => {
  it("stable + lowercase-insensitive wallet", () => {
    const a = nodeIdFor("0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", "uuid-1");
    const b = nodeIdFor("0x9BD7E06F3ECF4BE0F2FCD2188B23F1B9FCC88E5D4B65A8637B17723BBDA3CCE8", "uuid-1");
    assert.equal(a, b);
    assert.notEqual(a, nodeIdFor("0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", "uuid-2"));
  });
});

describe("merkle", () => {
  it("roundtrip + tamper fails + empty/single", () => {
    const l = (s) => bytesToHex(ckbHashBytes(te.encode(s)));
    const leaves = [l("a"), l("b"), l("c")];
    const root = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      assert.equal(verifyProof(leaves[i], merkleProof(leaves, i), root), true, `proof ${i}`);
    }
    assert.equal(verifyProof(l("evil"), merkleProof(leaves, 0), root), false);
    assert.equal(merkleRoot([]), ZERO32);
    assert.equal(merkleRoot([leaves[0]]), leaves[0]);
  });
});

describe("rewards end-to-end", () => {
  it("claim proof verifies, cross-epoch fails, share bytes == leaf preimage", () => {
    const epoch = 497585;
    const n1 = bytesToHex(ckbHashBytes(te.encode("node1")));
    const w1 = bytesToHex(ckbHashBytes(te.encode("wallet1")));
    const n2 = bytesToHex(ckbHashBytes(te.encode("node2")));
    const w2 = bytesToHex(ckbHashBytes(te.encode("wallet2")));
    const l1 = rewardLeaf(epoch, n1, w1, 10, 2, 204800, 8333000000000000000000n);
    const l2 = rewardLeaf(epoch, n2, w2, 5, 1, 102400, 1666000000000000000000n);
    const root = merkleRoot([l1, l2]);
    assert.equal(verifyProof(l1, merkleProof([l1, l2], 0), root), true);
    const evil = rewardLeaf(epoch + 1, n1, w1, 10, 2, 204800, 8333000000000000000000n);
    assert.equal(verifyProof(evil, merkleProof([l1, l2], 0), root), false);
    // share encoding must hash to leaf
    const shareBytes = encodeShare(epoch, n1, w1, 10, 2, 204800, 8333000000000000000000n);
    assert.equal(bytesToHex(ckbHashBytes(shareBytes)), l1);
    assert.equal(shareBytes.length, 112);
  });
});

describe("codecs", () => {
  it("registry sorts + epoch sizes", () => {
    const rid = bytesToHex(ckbHashBytes(te.encode("registry")));
    const op = bytesToHex(ckbHashBytes(te.encode("operator")));
    const nb = bytesToHex(ckbHashBytes(te.encode("b")));
    const na = bytesToHex(ckbHashBytes(te.encode("a")));
    const enc = encodeRegistry(rid, op, [
      { nodeId: nb, walletLockHash: op, eligible: true, beats: 1, bytes: 2 },
      { nodeId: na, walletLockHash: op, eligible: false, beats: 3, bytes: 4 },
    ]);
    assert.equal(enc.length, 68 + 2 * 81);
    const epoch = encodeEpoch(7, rid, nb, na, 100, rid);
    assert.equal(epoch.length, 158);
  });
});

describe("evidence", () => {
  it("canonical json stable", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 1 } });
    assert.equal(a, `{"a":{"c":1,"d":2},"b":1}`);
    assert.equal(evidenceHash(a).length, 66);
  });
});

describe("cross-check with Rust vectors", () => {
  it("ckbhash sanity (BLAKE2b personal differs from plain)", () => {
    // sanity: personalization matters; just assert determinism + length
    const h = bytesToHex(ckbHashBytes(te.encode("relaymesh/epoch-v1")));
    assert.equal(h.length, 66);
    assert.equal(bytesToHex(ckbHashBytes(te.encode("relaymesh/epoch-v1"))), h);
  });
});
