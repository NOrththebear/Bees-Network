# Bee Network

**Real-Time Geographic Intelligence for AI Agents**

## Product Description

Bee Network is a decentralized, real-time internet intelligence network that enables AI agents and businesses to access fresh, geographically specific information from across the public web.

By connecting distributed internet nodes across different regions, Bee Network enables requests to be made through local residential internet connections, helping AI agents observe how online services, prices, products, search results, and offers appear in different markets.

Instead of relying solely on static datasets or generic search results, AI agents can use Bee Network to request current observations from specific locations, receive structured and timestamped results, and use that information to make better decisions.

For example, an AI shopping agent could use Bee Network to compare current product prices across Kenyan retailers, a business could monitor competitor promotions across African markets, or a travel agent could check publicly available hotel offers in a particular city.

Bee Network abstracts away the complexity of residential proxies, distributed nodes, and web data collection behind a simple API that developers and AI agents can use to request geographically targeted observations.

The network's long-term vision is to become a **real-time observation layer for AI**—connecting intelligent software to fresh, localized information from the internet and enabling agents to make decisions based on what is happening now, where it is happening.

## How It Works

1. **Distributed connectivity:** Participants contribute eligible residential internet connectivity through a node application.
2. **Geographic observation:** Bee Network routes authorized requests through suitable regional nodes to access publicly available web information.
3. **Data processing:** Retrieved information is timestamped, structured, and checked for reliability where possible.
4. **AI integration:** Developers access the results through an API, allowing AI agents to search, compare, monitor, and act on current information.
5. **Contributor incentives:** Participants can receive rewards for eligible network contributions, subject to the network's incentive model.

## Initial Use Cases

* **Commerce intelligence:** Monitor competitor prices, discounts, and product availability.
* **Travel intelligence:** Compare publicly listed accommodation prices and offers.
* **Market research:** Track changes in public web content across geographic markets.
* **AI-powered shopping:** Help agents find current offers from multiple merchants.
* **Website monitoring:** Detect regional differences in content, accessibility, and pricing.
* **Local digital intelligence:** Collect public information that is difficult to obtain reliably through centralized data sources alone.

## The Business Model

Bee Network can monetize access to its intelligence infrastructure through usage-based API pricing, recurring subscriptions, and enterprise data-monitoring services. Pricing could depend on request volume, geographic coverage, freshness, reliability, and the complexity of the requested observations.

Network contributors supply connectivity, while Bee Network focuses on delivering useful, reliable intelligence to businesses and AI developers.

## The Vision

**Bee Network turns distributed internet connectivity into a real-time intelligence resource for AI.**

The ambition is not simply to build another bandwidth-sharing or residential proxy network. It is to build a platform through which AI agents can ask what is happening on the public internet in a particular place, receive fresh evidence, and use it to make informed decisions.

---

## Technical Architecture (CKB Implementation)

The current implementation is a decentralized bandwidth marketplace on Nervos CKB, serving as the incentive and coordination layer for the intelligence network. Node operators register, serve traffic, and claim rewards through immutable, audited Cell-model contracts.

### Protocol Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Bee Network Protocol                         │
├─────────────────────────────────────────────────────────────────────┤
│  Registry (Type Script)     │  Singleton registry of eligible nodes │
│  - Genesis via Type-ID       │  - Append / eligibility flip         │
│  - Operator-governed         │  - Sorted by node_id, no duplicates  │
├─────────────────────────────────────────────────────────────────────┤
│  Epoch (Type Script)         │  Immutable per-epoch settlement      │
│  - Mint-once (0x1 group in)  │  - Merkle root of points ledger      │
│  - Data: epoch, registry,    │  - Evidence hash, rewards root       │
│    merkle_root, evidence,    │  - Pool amount (u128)                │
│    pool, rewards_root        │                                       │
├─────────────────────────────────────────────────────────────────────┤
│  Rewards Lock (Lock Script)  │  Merkle claim + wallet-bound payout  │
│  - Proof verified on-chain   │  - Cross-checks Epoch CellDeps       │
│  - Consume-to-claim          │  - Output lock == wallet (anti-theft)│
│  - No double-claim           │                                       │
├─────────────────────────────────────────────────────────────────────┤
│  Token: XUDT (standard)      │  18dp, owner-mode mint for pools     │
└─────────────────────────────────────────────────────────────────────┘
```

All logic is pure Rust (no syscalls in core), mirrored 1:1 in TypeScript. On-chain scripts are stateless RISC-V binaries deployed as code cells (`hash_type=data2`).

### Repository Layout

```
├── schemas/
│   └── bees-network.mol       # Canonical Molecule spec (forward-compatible)
├── crates/
│   ├── bees-network-core/     # Pure validation logic (cargo test, 14 tests)
│   │   ├── src/lib.rs         # ckbhash, nodeIdFor, points, merkle, transitions
│   │   ├── src/codec.rs       # Fixed-pack codecs (Registry 68+81N, Epoch 158, Share 112)
│   │   └── src/sysparse.rs    # Raw Script/WitnessArgs parsing (AMO-free)
│   ├── registry-type/         # Registry Type script (genesis, append, flip)
│   ├── epoch-type/            # Epoch Type script (mint-once, immutable)
│   ├── rewards-lock/          # Rewards Lock script (merkle proof + wallet-bound)
│   └── always-success/        # Dev lock for testing
├── shared-ts/                 # TS mirror (blake2b personal=ckb-default-hash), 7 tests
├── ckb-client/                # Coordinator helpers: args/data builders, proofs
├── deploy/                    # Devnet/testnet lifecycle scripts (journal-based)
├── dist/                      # Stripped riscv64imac binaries (deploy as code cells)
└── fixtures/                  # Mock-tx test vectors (ckb-cli verify)
```

### Verified Binaries (v0.1)

| Script | Size | Est. Cycles | Code Hash (blake2b, person=ckb-default-hash, hash_type=data2) |
|--------|------|-------------|---------------------------------------------------------------|
| registry-type | 26,104 B | ~6,526 | `0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8` |
| epoch-type | 15,328 B | ~3,832 | `0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1` |
| rewards-lock | 21,544 B | ~5,386 | `0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84` |

Reproduce:
```bash
cargo build --target riscv64imac-unknown-none-elf --release
# Strip via nervos/ckb-riscv-gnu-toolchain docker image
```

### Verification

#### Unit Tests
```bash
cargo test -p bees-network-core                    # 14 tests
cargo check -p registry-type -p epoch-type -p rewards-lock -p always-success
moleculec --language rust --schema-file schemas/bees-network.mol > /dev/null
(cd shared-ts && npm install && npm test)          # 7 tests
(node --test ckb-client/test/*.test.mjs)           # 4 tests
```

#### On-VM Verification (`ckb-cli mock-tx verify`, 11/11 passing)
```bash
node fixtures/gen.mjs                              # Build fixtures (always-success lock)
ckb-cli mock-tx verify --tx-file fixtures/<case>.json
```

| Case | Result | Cycles / Error |
|------|--------|----------------|
| registry-genesis-ok | PASS | 33,532 |
| registry-genesis-bad-id | FAIL | 12 BadGenesisId |
| registry-append-ok | PASS | 36,185 |
| registry-append-dup | FAIL | 14 BadTransition |
| registry-flip-nonoperator | FAIL | 13 NotOperator |
| epoch-mint-ok | PASS | 21,284 |
| epoch-mint-zero-root | FAIL | 23 ZeroHashes |
| epoch-double-close | FAIL | 25 Immutable |
| rewards-claim-ok | PASS | 70,034 |
| rewards-claim-bad-proof | FAIL | 34 RootMismatch |
| rewards-claim-wrong-wallet | FAIL | 35 WalletMismatch |

All binaries AMO-free (`objdump | grep -E 'amo|lr\.d|sc\.d'` → 0). CKB-VM is RV64IMC (no A-extension); scripts parse `Script`/`WitnessArgs` from raw syscall buffers (`bees-network-core/src/sysparse.rs`, tested against real `ckb-gen-types` entities).

#### Cross-Language Vectors (Rust ↔ TS ↔ Python)

```
ckbhash("hello") = 0x2da1289373a9f6b7ed21db948f4dc5d942cf4023eaef1d5a2b1a45b9d12d1036
nodeId(0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8, "uuid-1")
  = 0xa34eab00db05aba0e21e5d4f4971af77ede9ac6bbb63331eaaadcb2b6ff77c9a
rewardLeaf(497585, nodeId, wallet, 10, 2, 204800, 100)
  = 0x7f7d351ced419d093d1ee2b00f00c2925439a4b8bda38cb0502c8462dc92d6e2
```

Generate: `cargo run -p bees-network-core --example print-vectors`

### CCC Integration (Coordinator)

```ts
import { ccc } from "@ckb-ccc/ccc";
import {
  computeRegistryId,
  registryTypeScript,
  epochTypeScript,
  rewardsLockScript,
  buildRegistryGenesisData,
  encodeProofForWitness
} from "@bees-network/ckb-client";

// Deploy code cells, record CODE_HASHES
// Genesis: firstInput = tx.inputs[0].previousOutput
const REGISTRY_ID = computeRegistryId(firstTxHash, firstIndex);

let tx = ccc.Transaction.from({
  outputs: [{
    lock: operatorLock,
    type: registryTypeScript(REGISTRY_ID),
    capacity: 150n * 100_000_000n  // 150 CKB
  }],
  outputsData: [hex(buildRegistryGenesisData(REGISTRY_ID, operatorLock.hash()))],
});
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer, 1000);
const h = await signer.sendTransaction(tx);
await signer.client.waitTransaction(h);

// Epoch close: compute merkleRoot/evidenceHash via shared-ts
// Mint Epoch Cell, create Claim Cells (lock=rewardsLockScript(epoch, rewardsRoot))
// Claim: inputs=[claimCell], cellDeps=[epochCell, rewardsCode],
//        witness input_type=encodeProofForWitness(proof),
//        outputs[0].lock == share.walletLockHash
```

Capacity: `occupied = 8 + lockLen + typeLen + dataLen`; fund `occupied + 10 CKB` minimum (≥61 CKB enforced).

### Security Model

- **Registry**: Type-ID genesis binds `REGISTRY_ID` to first OutPoint. Operator lock in inputs required for all mutations. Single eligibility flip or single append per tx. Sorted, no duplicates, monotonic counters.
- **Epoch**: Mint-once semantics via `GroupInput` count check (any input → reject). Data integrity via args↔data cross-check. Operator funding proof via lock hash in inputs.
- **Rewards**: Merkle proof verified with sorted-pair hashing. Epoch cross-check via `CellDeps`. Wallet-bound payout (output lock must match `wallet_lock_hash`). Consume-to-claim prevents double-spend.
- **Economics**: Points = `min(bytes/102400, 500)` net + `min(beats/20, 144)` up per day. Rewards distributed pro-rata by points.

### Dependencies

- **Rust**: `ckb-std 0.16`, `ckb-hash 0.112.1`, `ckb-gen-types 0.119.0` (dev)
- **TS**: `@noble/hashes 1.7.1` (blake2b with `personalization`)
- **Toolchain**: `riscv64imac-unknown-none-elf`, `moleculec`, `ckb-cli`

## License

MIT