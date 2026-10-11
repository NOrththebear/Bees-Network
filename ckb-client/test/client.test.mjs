import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_HASHES,
  registryTypeScript,
  epochTypeScript,
  rewardsLockScript,
  computeRegistryId,
  buildRegistryGenesisData,
  estimateCellCapacity,
  encodeProofForWitness,
} from "../src/client.ts";
import { merkleRoot, merkleProof, rewardLeaf, verifyProof, bytesToHex, ckbHashBytes } from "../../shared-ts/src/index.ts";

const te = new TextEncoder();
const hx = (s) => bytesToHex(ckbHashBytes(te.encode(s)));

describe("script descriptors", () => {
  it("args lengths: registry 32B, epoch 40B, rewards 40B; hash_type data2", () => {
    const rid = hx("registry");
    const r = registryTypeScript(rid);
    assert.equal(r.hashType, "data2");
    assert.equal((r.args.length - 2) / 2, 32);
    const e = epochTypeScript(497585, rid);
    assert.equal((e.args.length - 2) / 2, 40);
    const w = rewardsLockScript(497585, hx("root"));
    assert.equal((w.args.length - 2) / 2, 40);
    assert.equal(CODE_HASHES.registryType.length, 66);
  });
});

describe("registry genesis", () => {
  it("REGISTRY_ID deterministic + genesis data well-formed", () => {
    const tx = `0x${"ab".repeat(32)}`;
    const a = computeRegistryId(tx, 0);
    const b = computeRegistryId(tx, 0);
    assert.equal(a, b);
    assert.notEqual(a, computeRegistryId(tx, 1));
    const op = hx("operator");
    const data = buildRegistryGenesisData(a, op);
    assert.equal(data.length, 68); // 32+32+4, zero nodes
  });
});

describe("claim witness", () => {
  it("proof encodes to 32*N bytes and verifies against rewards args", () => {
    const epoch = 497585;
    const n1 = hx("node1"), w1 = hx("wallet1"), n2 = hx("node2"), w2 = hx("wallet2");
    const l1 = rewardLeaf(epoch, n1, w1, 10, 2, 204800, 100n);
    const l2 = rewardLeaf(epoch, n2, w2, 5, 1, 102400, 50n);
    const root = merkleRoot([l1, l2]);
    const proof = merkleProof([l1, l2], 0);
    const enc = encodeProofForWitness(proof);
    assert.equal((enc.length - 2) / 2, 16 + 4 + proof.length * 32); // WitnessArgs + fixvec
    assert.equal(verifyProof(l1, proof, root), true);
    const lock = rewardsLockScript(epoch, root);
    assert.ok(lock.args.endsWith(root.slice(2))); // args = epoch LE8 || root
  });
});

describe("capacity", () => {
  it("covers occupied + margin (>=61 CKB rule)", () => {
    const { ckb } = estimateCellCapacity(68, 53, 85); // genesis registry + type args
    assert.ok(BigInt(ckb) >= 61n, `got ${ckb}`);
  });
});
