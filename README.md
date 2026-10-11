# Bees Network on CKB (v0.1)

Port of [RelayMesh](https://github.com/duongja/RelayMesh) (`MeshRegistry` + `EpochLedger` +
`MeshRewards`, BOT EVM-968) to Nervos CKB Cell model. No contract storage — everything is
`Cell{capacity,lock,type,data}` + stateless RISC-V scripts + off-chain coordinator.

Built against `docs.nervos.org` (`cell-model`, `script/*`, `ecosystem-scripts/xudt`,
`serialization/*`, `how-tos/*`, `node/*`).

## Layout

```
schemas/bees-network.mol      # canonical Molecule spec (forward; v0.1 on-chain uses fixed packs below)
crates/bees-network-core/     # pure validation logic, no syscalls (cargo test, 9 tests)
  src/lib.rs                  # ckbhash, nodeIdFor, points, sorted-pair merkle, registry/epoch checks
  src/codec.rs                # v0.1 fixed-pack codecs (Registry 68+81N B, Epoch 158 B, Share 112 B)
  src/entry.rs→examples/      # examples/print-vectors.rs — cross-language test vectors
crates/registry-type/         # Type script: registry singleton (genesis via Type-ID rule, append/flip)
crates/epoch-type/            # Type script: per-epoch mint-once cell (any consume rejects)
crates/rewards-lock/          # Lock script: Merkle claim verify + wallet-bound + Epoch CellDeps check
shared-ts/                    # TS mirror of bees-network-core (blake2b personal=ckb-default-hash), 7 tests
ckb-client/                   # coordinator helpers: args/data builders, REGISTRY_ID, capacity, proofs; 4 tests
dist/                         # stripped riscv64imac binaries (deploy these as code cells, hash_type=data2)
```

## Audited v0.1 binaries

| script | size | ELF load ~cycles | code_hash (`blake2b(person=ckb-default-hash)`, `hash_type=data2`) |
|---|---|---|---|
| registry-type | 26104 B | ~6526 | `0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8` |
| epoch-type | 15328 B | ~3832 | `0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1` |
| rewards-lock | 21544 B | ~5386 | `0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84` |

Reproduce: `cargo build --target riscv64imac-unknown-none-elf --release`
(strip via `nervos/ckb-riscv-gnu-toolchain` docker image; plain `riscv64-unknown-elf-gcc`
here is a docker wrapper that only mounts `/home/agate`, so this repo must live under `/home`).

## Design (what maps to what)

| BOT (Solidity) | CKB v0.1 |
|---|---|
| `MeshRegistry.register/setEligible` + `eligible/walletOf` | Registry singleton Cell. `type.args=REGISTRY_ID(32B)`. Genesis: `args==blake2b(firstInput OutPoint\|\|outIdx0)`, `<=1` node. Update `1x1`: operator lock in inputs + append-one **or** single eligibility flip, sorted, no dup, counters monotonic. |
| `EpochLedger.closeEpoch` + `closed` | Epoch Cell per `epochId`. `type.args=epochLE8\|\|REGISTRY_ID(40B)`. Only `0x1` mint; any input with same group rejects (immutability = double-close protection). `data="RMEP01"\|\|epoch\|\|registry\|\|merkle_root\|\|evidence\|\|poolLE16\|\|rewards_root` (158 B). |
| `MeshRewards.claim/verifyProof/claimed` | Claim Cell per share, `lock.args=epochLE8\|\|rewards_root(40B)`, `data` 112 B **== leaf preimage** so `leaf=ckbhash(data)`. Witness `input_type`=concatenated 32 B siblings. Script folds sorted-pair hashes, checks `==args.root`, cross-checks Epoch Cell in `cell_deps`, requires output lock `==share.wallet` (anti-theft). Consume-to-claim = no double-claim. |
| `MeshToken` ERC20 | XUDT (`code_hash 0x50bd8d66…`, `data1`): Claim Cell carries XUDT type; `amountLE16` in share data matches XUDT `u128`. Owner-mode mint funds the epoch pool. |
| `keccak(abi.encode…)` | `ckbhash=fixed-concat` (112 B share / 56 B points leaf). Verified byte-identical Rust↔TS↔Python vectors (see below). |
| events | indexer (`findCellsByType`) + coordinator `Store`; `GET /api/epochs/:id/evidence` returns exact canonical bytes. |

## Verify

```bash
cargo test -p bees-network-core            # 14 tests: points, nodeId, merkle, registry, epoch, rewards, codecs, sysparse(+real entities)
cargo check -p registry-type -p epoch-type -p rewards-lock -p always-success
moleculec --language rust --schema-file schemas/bees-network.mol > /dev/null
(cd shared-ts && npm install && npm test)   # 7 tests
(node --test ckb-client/test/*.test.mjs)   # 4 tests
cargo run -p bees-network-core --example print-vectors   # RS vectors
node -e "import('./shared-ts/src/index.ts').then(...)" # must match RS + python hashlib(blake2b,person)
```

### On-VM verification (`ckb-cli mock-tx verify`, 11/11 as designed)

`node fixtures/gen.mjs` builds fixtures (all cells locked by `always-success` so
fixtures test our logic, not secp), then `ckb-cli mock-tx verify --tx-file
fixtures/<case>.json` executes the real RISC-V binaries in CKB-VM:

| case | result | cycles / error |
|---|---|---|
| registry-genesis-ok | PASS | 33532 |
| registry-genesis-bad-id | FAIL | 12 BadGenesisId |
| registry-append-ok | PASS | 36185 |
| registry-append-dup | FAIL | 14 BadTransition |
| registry-flip-nonoperator | FAIL | 13 NotOperator |
| epoch-mint-ok | PASS | 21284 |
| epoch-mint-zero-root | FAIL | 23 ZeroHashes |
| epoch-double-close | FAIL | 25 Immutable |
| rewards-claim-ok | PASS | 70034 |
| rewards-claim-bad-proof | FAIL | 34 RootMismatch |
| rewards-claim-wrong-wallet | FAIL | 35 WalletMismatch |

All binaries verified AMO-free (`objdump | grep amo/lr/sc` → 0): CKB-VM is
RV64IMC without the A extension, and `bytes::Bytes` refcounting emits AMO. Scripts
therefore parse `Script`/`WitnessArgs` from raw syscall buffers
(`bees-network-core/src/sysparse.rs`, tested against real `ckb-gen-types` entities).

Two load-bearing encoding facts this caught (both were wrong in v0.1 and are now
covered by real-entity tests):
- Molecule `Bytes` is a fixvec: `item_count LE32` + items (not raw bytes). Applies to
  `Script.args` and `WitnessArgs` `Some(...)` fields.
- For lock scripts, `Source::GroupOutput` = outputs carrying *that lock* (often empty);
  the payout lookup scans tx-level `Source::Output` instead.

Cross-language vectors (all three agree):

```
ckbhash("hello") = 0x2da1289373a9f6b7ed21db948f4dc5d942cf4023eaef1d5a2b1a45b9d12d1036
nodeId(0x9bd7e06f…ce8c, "uuid-1") = 0xa34eab00db05aba0e21e5d4f4971af77ede9ac6bbb63331eaaadcb2b6ff77c9a
rewardLeaf(497585, …) = 0x7f7d351ced419d093d1ee2b00f00c2925439a4b8bda38cb0502c8462dc92d6e2
```

(Caught during build: `@noble/hashes` option is `personalization`, not `person` — without it
TS silently hashed **without** personalization and diverged from Rust/Python.)

## CCC integration (coordinator patch points)

```ts
import { ccc } from "@ckb-ccc/ccc";
import { computeRegistryId, registryTypeScript, epochTypeScript, rewardsLockScript,
         buildRegistryGenesisData, encodeProofForWitness } from "@bees-network/ckb-client";

// deploy: dist/* -> code cells (offckb deploy --network devnet|testnet), record CODE_HASHES
// genesis: firstInput = tx.inputs[0].previousOutput
const REGISTRY_ID = computeRegistryId(firstTxHash, firstIndex); // == on-chain Type-ID rule
let tx = ccc.Transaction.from({
  outputs: [{ lock: operatorLock, type: registryTypeScript(REGISTRY_ID),
               capacity: 150n * 100_000_000n }],
  outputsData: [hex(buildRegistryGenesisData(REGISTRY_ID, operatorLock.hash()))],
});
await tx.completeInputsByCapacity(signer); await tx.completeFeeBy(signer, 1000);
const h = await signer.sendTransaction(tx);
await signer.client.waitTransaction(h); // pending -> confirming -> confirmed (NC-MAX propose 2..10)

// epoch close: build root/evidence with shared-ts merkleRoot/evidenceHash, mint Epoch Cell,
// then create one Claim Cell per funded share (lock=rewardsLockScript(epoch, rewardsRoot)).
// claim: inputs=[claimCell], cellDeps=[epochCell, rewardsCode], witness input_type=encodeProofForWitness(proof),
// outputs[0].lock must equal share wallet lock.
```

Capacity rule: `occupied = 8 + lockLen(53 default) + typeLen + dataLen`; fund `occupied+10` CKB
minimum (`>=61` enforced), fee via `completeFeeBy` + `estimate_fee_rate`.

## Deploy checklist (testnet first)

1. `offckb node` devnet → deploy 3 binaries → fund operator → genesis Registry (empty).
2. Register 2 nodes (append path) → flip one ineligible → flip back (each `1x1`).
3. Close epoch `N` (`0x1`), attempt re-close (must fail `Immutable`), verify
   `findCellsByType(epochType)` + recompute `root/evidenceHash`.
4. Fund epoch (XUDT Claim Cells), claim share 0 with proof, attempt double-claim (must fail:
   input is Dead), attempt wrong-wallet output (must fail `WalletMismatch`).
5. `faucet.nervos.org` → repeat on Pudge testnet, explorer `pudge.explorer.nervos.org`.

## Non-goals / next

- **Devnet end-to-end: DONE (2026-10-11).** Fresh `ckb init --chain dev` (ckb 0.210,
  `devnet/`, RPC :8124, block assembler = operator account #0), `deploy/run.mjs`
  (miniature coordinator: manual OutPoint tracking, Molecule-via-`ckb-cli` hashes,
  noble sighash signer — no indexer needed):
  - TX1 deploy 4 code cells `0xc7026e19…fc41b06` (64,843 B)
  - TX2 registry genesis, id `0xfaeef543…1220ae`
  - TX3/TX4 register n1 `0x8a4367c3…` / n2 `0xe317c6ad…` (registry now 230 B = 2 entries)
  - TX5 epoch 497585 close, root `0x86368556…`, evidence hash on-chain
  - TX6 fund 2 claim cells (points-only)
  - TX7 claim n1 `0x90cfe907…ece10ac5` (block 178): rewards-lock + sighash groups,
    payout 201,285 CKB to node-1 wallet; claim cell consumed (dead), sibling live.
  - Debugging this caught two deploy-layer bugs now fixed: capacity units
    (1 CKB = 1 byte state) and one-signature-per-group sighash covering.
- **Pudge testnet end-to-end: DONE (2026-10-11).** `deploy/run-testnet.mjs`
  (`CKB_RPC=https://testnet.ckb.dev`, journal `deploy/journal-testnet.json`),
  funded by 15 faucet claims (~150k CKB to operator `ckt1qz…cyd8`):
  - T1 deploy 5 code cells `0x6b6f4f43…f6073646f8173` (98,784 B, incl. canonical XUDT
    `0x50bd8d66…`, fetched live from Pudge)
  - T2 owner-mint 1,000,000 tRELAY (18dp) to operator
  - T3 registry genesis, id `0x1693da11…28117db7`
  - T4/T5 register n1 `0x8a4367c3…` / n2 `0xe317c6ad…`
  - T6 epoch 497585 close: points root `0x86368556…`, 100 tRELAY pool, rewards root
    over **amount-0 leaves** (binding model: share cells prove membership/points;
    XUDT value moves in separate cells, bound off-chain)
  - T7 fund 2 share cells (amount-0 data, matches rRoot) + 2 XUDT cells (75/25 split
    pro-rata by points 3:1) — XUDT moves via fresh owner-mint inline
  - T8 claim n1 `0x16fe0626…ef951bef86ba` (block 22705963): rewards-lock proof +
    XUDT conservation + N1 sighash in one tx; **75 tRELAY paid to node-1**
    (`0x00004c0aa286d510…` = 75e18 verified), share cell dead, n2 XUDT live.
  - Testnet debugging caught three more issues, all fixed in-script: faucet `get_cells`
    indexer lag (hardcoded verified OutPoints), U128 helper overflow past u64
    (manual LE16 writer), epoch rRoot computed over amount-0 leaves so T7/T8 must use
    amount-0 share data with real value in XUDT cells only.
  - Verify: `pudge.explorer.nervos.org/transaction/0x16fe0626…bef86ba`
- `ckb-auth`/OmniLock operator multisig + BTC/ETH sharer wallets via `ccc-btc/eth/sol-lock`.
- FeeEstimator (`WeightUnitsFlow`) + RBF (`>=v0.112.1`) wiring in coordinator.
- Disk note: this environment's disk is ~100% full; `target/debug` was deleted to make
  room. Re-run `cargo test`/`cargo check` as needed (they rebuild on demand).
