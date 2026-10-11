//! RelayMesh CKB pure validation logic.
//!
//! No CKB syscalls here so `cargo test` runs natively.
//! On-chain wrappers in registry-type / epoch-type / rewards-lock
//! call into these functions after loading cells via ckb-std.
//!
//! Hashing: ckbhash = Blake2b-256(personal="ckb-default-hash"),
//! via `ckb-hash::blake2b_256` (same as CKB-VM system scripts).

#![cfg_attr(not(test), no_std)]

#[macro_use]
extern crate alloc;

use alloc::{string::String, vec::Vec};

pub mod codec;
pub mod sysparse;

pub const SCHEMA: &[u8] = b"relaymesh/epoch-v1";
pub const ZERO32: [u8; 32] = [0u8; 32];

/// ckbhash(bytes) -> 32 bytes.
pub fn ckb_hash(data: &[u8]) -> [u8; 32] {
    ckb_hash::blake2b_256(data)
}

/// Canonical JSON with sorted keys (evidence bytes preimage).
/// Minimal implementation for flat/nested serde_json-free use:
/// callers pass already-canonical bytes; this fn just hashes.
pub fn evidence_hash(canonical_json_bytes: &[u8]) -> [u8; 32] {
    ckb_hash(canonical_json_bytes)
}

fn le64(v: u64) -> [u8; 8] {
    v.to_le_bytes()
}

fn le128(v: u128) -> [u8; 16] {
    v.to_le_bytes()
}

/// nodeIdFor(wallet_lock_hash_hex_lower, install_uuid) = ckbhash("lockhash:uuid").
///
/// `wallet_lock_hex` must be lowercase `0x`+64 hex (the CKB lock script hash,
/// replacing the EVM address in the original design).
pub fn node_id_for(wallet_lock_hex_lower: &str, install_uuid: &str) -> Result<[u8; 32], &'static str> {
    if !is_node_id_hex(wallet_lock_hex_lower) && !is_byte32_hex(wallet_lock_hex_lower) {
        return Err("bad wallet lock hash hex");
    }
    let preimage = format!("{}:{}", wallet_lock_hex_lower.to_lowercase(), install_uuid);
    Ok(ckb_hash(preimage.as_bytes()))
}

pub fn is_byte32_hex(s: &str) -> bool {
    s.len() == 66 && s.starts_with("0x") && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn is_node_id_hex(s: &str) -> bool {
    is_byte32_hex(s)
}

// ---------------------------------------------------------------------------
// Points (unchanged economics from BOT MVP)
// ---------------------------------------------------------------------------

pub const BYTES_PER_NET_PT: u64 = 102_400;
pub const BEATS_PER_UP_PT: u64 = 20;
pub const MAX_NET_PER_DAY: u64 = 500;
pub const MAX_UP_PER_DAY: u64 = 144;

pub fn compute_points(bytes: u64, beats: u64) -> (u64, u64) {
    let net = (bytes / BYTES_PER_NET_PT).min(MAX_NET_PER_DAY);
    let up = (beats / BEATS_PER_UP_PT).min(MAX_UP_PER_DAY);
    (net, up)
}

// ---------------------------------------------------------------------------
// Merkle leaves / roots (blake2b sorted-pair, mirrors shared-ts)
// ---------------------------------------------------------------------------

/// Points-ledger leaf (epoch merkle_root):
/// ckbhash(node_id || net_pts LE8 || up_pts LE8 || bytes LE8) — 56B preimage.
pub fn points_leaf(node_id: &[u8; 32], net_pts: u64, up_pts: u64, bytes: u64) -> [u8; 32] {
    let mut pre = Vec::with_capacity(56);
    pre.extend_from_slice(node_id);
    pre.extend_from_slice(&le64(net_pts));
    pre.extend_from_slice(&le64(up_pts));
    pre.extend_from_slice(&le64(bytes));
    ckb_hash(&pre)
}

/// Rewards-claim leaf:
/// ckbhash(epoch LE8 || node_id || wallet_lock_hash || net LE8 || up LE8 || bytes LE8 || amount LE16)
/// — 112B preimage.
#[allow(clippy::too_many_arguments)]
pub fn reward_leaf(
    epoch_id: u64,
    node_id: &[u8; 32],
    wallet_lock_hash: &[u8; 32],
    net_pts: u64,
    up_pts: u64,
    bytes: u64,
    amount: u128,
) -> [u8; 32] {
    let mut pre = Vec::with_capacity(112);
    pre.extend_from_slice(&le64(epoch_id));
    pre.extend_from_slice(node_id);
    pre.extend_from_slice(wallet_lock_hash);
    pre.extend_from_slice(&le64(net_pts));
    pre.extend_from_slice(&le64(up_pts));
    pre.extend_from_slice(&le64(bytes));
    pre.extend_from_slice(&le128(amount));
    ckb_hash(&pre)
}

fn sort_pair_hash(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let mut pre = [0u8; 64];
    pre[..32].copy_from_slice(lo);
    pre[32..].copy_from_slice(hi);
    ckb_hash(&pre)
}

/// Sorted-pair Merkle root. Empty -> zero hash (matches BOT MVP convention).
pub fn merkle_root(mut leaves: Vec<[u8; 32]>) -> [u8; 32] {
    if leaves.is_empty() {
        return ZERO32;
    }
    leaves.sort_unstable();
    if leaves.len() == 1 {
        return leaves[0];
    }
    let mut level = leaves;
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut i = 0;
        while i < level.len() {
            let a = &level[i];
            let b = if i + 1 < level.len() { &level[i + 1] } else { &level[i] };
            next.push(sort_pair_hash(a, b));
            i += 2;
        }
        level = next;
    }
    level[0]
}

/// Sibling proof path for leaves[index] under the same sorted-pair rule.
/// Sorts a copy and maps index through sorting (same as shared-ts rewardProof).
pub fn merkle_proof(leaves: &[[u8; 32]], index: usize) -> Result<Vec<[u8; 32]>, &'static str> {
    if leaves.is_empty() || index >= leaves.len() {
        return Err("bad index");
    }
    if leaves.len() == 1 {
        return Ok(vec![]);
    }
    let mut level: Vec<[u8; 32]> = leaves.to_vec();
    level.sort_unstable();
    let target = leaves[index];
    let mut idx = level.iter().position(|x| x == &target).ok_or("leaf not found")?;
    let mut proof = Vec::new();
    while level.len() > 1 {
        let sib_idx = if idx % 2 == 0 {
            if idx + 1 < level.len() { idx + 1 } else { idx }
        } else {
            idx - 1
        };
        proof.push(level[sib_idx]);
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut i = 0;
        while i < level.len() {
            let a = &level[i];
            let b = if i + 1 < level.len() { &level[i + 1] } else { &level[i] };
            next.push(sort_pair_hash(a, b));
            i += 2;
        }
        level = next;
        idx /= 2;
    }
    Ok(proof)
}

/// Verify proof against root.
pub fn verify_proof(leaf: &[u8; 32], proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    let mut h = *leaf;
    for s in proof {
        h = sort_pair_hash(&h, s);
    }
    &h == root
}

// ---------------------------------------------------------------------------
// Registry / Epoch / Rewards transition checks (pure, syscall-free)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeEntry {
    pub node_id: [u8; 32],
    pub wallet_lock_hash: [u8; 32],
    pub eligible: bool,
    pub beats: u64,
    pub bytes: u64,
}

fn sorted_by_node_id(nodes: &[NodeEntry]) -> bool {
    nodes.windows(2).all(|w| w[0].node_id < w[1].node_id)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RegistryTransition {
    Genesis,
    Append,
    EligibilityFlip,
}

pub fn check_registry_transition(prev: &[NodeEntry], next: &[NodeEntry]) -> Result<RegistryTransition, &'static str> {
    if !sorted_by_node_id(next) {
        return Err("nodes not sorted by node_id");
    }
    if next.windows(2).any(|w| w[0].node_id == w[1].node_id) {
        return Err("duplicate node_id");
    }
    if prev.is_empty() {
        if next.len() > 1 {
            return Err("genesis with >1 node");
        }
        return Ok(RegistryTransition::Genesis);
    }
    // Append exactly one new entry, rest identical (beats/bytes may grow for existing).
    if next.len() == prev.len() + 1 {
        // all prev entries must exist in next with same id/wallet and non-decreasing counters
        for p in prev {
            let n = next.iter().find(|x| x.node_id == p.node_id).ok_or("missing prev node")?;
            if n.wallet_lock_hash != p.wallet_lock_hash {
                return Err("wallet change forbidden");
            }
            if n.beats < p.beats || n.bytes < p.bytes {
                return Err("counters decreased");
            }
            // eligibility must be unchanged in append path
            if n.eligible != p.eligible {
                return Err("mixing append+flip");
            }
        }
        return Ok(RegistryTransition::Append);
    }
    // Eligibility flip: same set, exactly one eligible bit changed, counters non-decreasing.
    if next.len() == prev.len() {
        let mut flips = 0;
        for p in prev {
            let n = next.iter().find(|x| x.node_id == p.node_id).ok_or("missing prev node")?;
            if n.wallet_lock_hash != p.wallet_lock_hash {
                return Err("wallet change forbidden");
            }
            if n.beats < p.beats || n.bytes < p.bytes {
                return Err("counters decreased");
            }
            if n.eligible != p.eligible {
                flips += 1;
            }
        }
        if flips == 1 {
            return Ok(RegistryTransition::EligibilityFlip);
        }
        return Err("no single flip");
    }
    Err("bad transition size")
}

pub fn check_epoch_mint(root: &[u8; 32], evidence: &[u8; 32]) -> Result<(), &'static str> {
    if root == &ZERO32 || evidence == &ZERO32 {
        return Err("zero root/evidence");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(b: &[u8]) -> [u8; 32] {
        ckb_hash(b)
    }

    #[test]
    fn points_math_matches_mvp_caps() {
        assert_eq!(compute_points(204_800, 0), (2, 0));
        assert_eq!(compute_points(102_400 * 600, 20 * 200), (500, 144));
        assert_eq!(compute_points(0, 19), (0, 0));
        assert_eq!(compute_points(0, 20), (0, 1));
    }

    #[test]
    fn node_id_is_stable_lowercase() {
        let a = node_id_for("0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", "uuid-1").unwrap();
        let b = node_id_for("0x9BD7E06F3ECF4BE0F2FCD2188B23F1B9FCC88E5D4B65A8637B17723BBDA3CCE8", "uuid-1").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, node_id_for("0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", "uuid-2").unwrap());
    }

    #[test]
    fn merkle_root_and_proof_roundtrip() {
        let leaves = vec![h(b"a"), h(b"b"), h(b"c")];
        let root = merkle_root(leaves.clone());
        for i in 0..leaves.len() {
            let proof = merkle_proof(&leaves, i).unwrap();
            assert!(verify_proof(&leaves[i], &proof, &root), "proof {i} failed");
        }
        // tampered leaf fails
        assert!(!verify_proof(&h(b"evil"), &merkle_proof(&leaves, 0).unwrap(), &root));
        // empty -> zero
        assert_eq!(merkle_root(vec![]), ZERO32);
        // single -> itself
        assert_eq!(merkle_root(vec![leaves[0]]), leaves[0]);
    }

    #[test]
    fn registry_transitions() {
        let n1 = NodeEntry { node_id: h(b"n1"), wallet_lock_hash: h(b"w1"), eligible: true, beats: 20, bytes: 102400 };
        let n2 = NodeEntry { node_id: h(b"n2"), wallet_lock_hash: h(b"w2"), eligible: true, beats: 0, bytes: 0 };
        // ensure sorted order for test
        let (lo, hi) = if n1.node_id < n2.node_id { (n1.clone(), n2.clone()) } else { (n2.clone(), n1.clone()) };
        assert_eq!(check_registry_transition(&[], &[lo.clone()]).unwrap(), RegistryTransition::Genesis);
        assert!(check_registry_transition(&[], &[lo.clone(), hi.clone()]).is_err());
        assert_eq!(check_registry_transition(&[lo.clone()], &[lo.clone(), hi.clone()]).unwrap(), RegistryTransition::Append);
        // dup
        assert!(check_registry_transition(&[lo.clone()], &[lo.clone(), lo.clone()]).is_err());
        // flip
        let mut flipped = lo.clone();
        flipped.eligible = false;
        let prev = vec![lo.clone(), hi.clone()];
        let mut next = vec![flipped, hi.clone()];
        next.sort_by(|a, b| a.node_id.cmp(&b.node_id));
        assert_eq!(check_registry_transition(&prev, &next).unwrap(), RegistryTransition::EligibilityFlip);
    }

    #[test]
    fn epoch_mint_rejects_zero() {
        assert!(check_epoch_mint(&ZERO32, &h(b"x")).is_err());
        assert!(check_epoch_mint(&h(b"r"), &h(b"e")).is_ok());
    }

    #[test]
    fn reward_leaf_proof_end_to_end() {
        let epoch = 497_585u64;
        let n1 = h(b"node1");
        let w1 = h(b"wallet1");
        let n2 = h(b"node2");
        let w2 = h(b"wallet2");
        let l1 = reward_leaf(epoch, &n1, &w1, 10, 2, 204800, 8_333_000_000_000_000_000_000u128);
        let l2 = reward_leaf(epoch, &n2, &w2, 5, 1, 102400, 1_666_000_000_000_000_000_000u128);
        let leaves = vec![l1, l2];
        let root = merkle_root(leaves.clone());
        let p0 = merkle_proof(&leaves, 0).unwrap();
        assert!(verify_proof(&l1, &p0, &root));
        // cross-epoch replay fails
        let evil = reward_leaf(epoch + 1, &n1, &w1, 10, 2, 204800, 8_333_000_000_000_000_000_000u128);
        assert!(!verify_proof(&evil, &p0, &root));
    }
}
