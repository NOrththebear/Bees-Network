//! Fixed-pack codecs for v0.1 on-chain data.
//!
//! v0.1 uses fixed little-endian packs (cheap to parse in CKB-VM).
//! `schemas/bees-network.mol` is the forward Molecule spec for indexers/SDKs;
//! field order and sizes below mirror those tables 1:1 so migration is mechanical.

use super::{NodeEntry, ZERO32};
use alloc::vec::Vec;

pub const REGISTRY_HEADER: usize = 32 + 32 + 4; // registry_id + operator + count LE32
pub const NODE_ENTRY_SIZE: usize = 32 + 32 + 1 + 8 + 8; // 81
pub const EPOCH_DATA_SIZE: usize = 6 + 8 + 32 + 32 + 32 + 16 + 32; // 158
pub const SHARE_DATA_SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 16; // 112
pub const EPOCH_MAGIC: &[u8; 6] = b"RMEP01";

pub fn encode_registry(registry_id: &[u8; 32], operator: &[u8; 32], nodes: &[NodeEntry]) -> Vec<u8> {
    let mut out = Vec::with_capacity(REGISTRY_HEADER + nodes.len() * NODE_ENTRY_SIZE);
    out.extend_from_slice(registry_id);
    out.extend_from_slice(operator);
    out.extend_from_slice(&(nodes.len() as u32).to_le_bytes());
    let mut sorted = nodes.to_vec();
    sorted.sort_by(|a, b| a.node_id.cmp(&b.node_id));
    for n in &sorted {
        out.extend_from_slice(&n.node_id);
        out.extend_from_slice(&n.wallet_lock_hash);
        out.push(if n.eligible { 1 } else { 0 });
        out.extend_from_slice(&n.beats.to_le_bytes());
        out.extend_from_slice(&n.bytes.to_le_bytes());
    }
    out
}

pub fn decode_registry(data: &[u8]) -> Result<([u8; 32], [u8; 32], Vec<NodeEntry>), &'static str> {
    if data.len() < REGISTRY_HEADER {
        return Err("registry short");
    }
    let mut rid = [0u8; 32];
    let mut op = [0u8; 32];
    rid.copy_from_slice(&data[..32]);
    op.copy_from_slice(&data[32..64]);
    let count = u32::from_le_bytes([data[64], data[65], data[66], data[67]]) as usize;
    if data.len() != REGISTRY_HEADER + count * NODE_ENTRY_SIZE {
        return Err("registry len mismatch");
    }
    let mut nodes = Vec::with_capacity(count);
    for i in 0..count {
        let o = REGISTRY_HEADER + i * NODE_ENTRY_SIZE;
        let mut node_id = [0u8; 32];
        let mut wallet = [0u8; 32];
        node_id.copy_from_slice(&data[o..o + 32]);
        wallet.copy_from_slice(&data[o + 32..o + 64]);
        let eligible = match data[o + 64] {
            0 => false,
            1 => true,
            _ => return Err("bad eligible byte"),
        };
        let mut b8 = [0u8; 8];
        b8.copy_from_slice(&data[o + 65..o + 73]);
        let beats = u64::from_le_bytes(b8);
        b8.copy_from_slice(&data[o + 73..o + 81]);
        let bytes = u64::from_le_bytes(b8);
        nodes.push(NodeEntry { node_id, wallet_lock_hash: wallet, eligible, beats, bytes });
    }
    Ok((rid, op, nodes))
}

pub fn encode_epoch(
    epoch_id: u64,
    registry_id: &[u8; 32],
    merkle_root: &[u8; 32],
    evidence_hash: &[u8; 32],
    pool: u128,
    rewards_root: &[u8; 32],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(EPOCH_DATA_SIZE);
    out.extend_from_slice(EPOCH_MAGIC);
    out.extend_from_slice(&epoch_id.to_le_bytes());
    out.extend_from_slice(registry_id);
    out.extend_from_slice(merkle_root);
    out.extend_from_slice(evidence_hash);
    out.extend_from_slice(&pool.to_le_bytes());
    out.extend_from_slice(rewards_root);
    out
}

pub fn decode_epoch(data: &[u8]) -> Result<(u64, [u8; 32], [u8; 32], [u8; 32], u128, [u8; 32]), &'static str> {
    if data.len() != EPOCH_DATA_SIZE {
        return Err("epoch len mismatch");
    }
    if &data[..6] != EPOCH_MAGIC {
        return Err("bad epoch magic");
    }
    let mut u8b = [0u8; 8];
    u8b.copy_from_slice(&data[6..14]);
    let epoch_id = u64::from_le_bytes(u8b);
    let mut rid = [0u8; 32];
    let mut root = [0u8; 32];
    let mut ev = [0u8; 32];
    let mut rr = [0u8; 32];
    rid.copy_from_slice(&data[14..46]);
    root.copy_from_slice(&data[46..78]);
    ev.copy_from_slice(&data[78..110]);
    let mut u16b = [0u8; 16];
    u16b.copy_from_slice(&data[110..126]);
    let pool = u128::from_le_bytes(u16b);
    rr.copy_from_slice(&data[126..158]);
    Ok((epoch_id, rid, root, ev, pool, rr))
}

pub fn encode_share(
    epoch_id: u64,
    node_id: &[u8; 32],
    wallet: &[u8; 32],
    net_pts: u64,
    up_pts: u64,
    bytes: u64,
    amount: u128,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(SHARE_DATA_SIZE);
    out.extend_from_slice(&epoch_id.to_le_bytes());
    out.extend_from_slice(node_id);
    out.extend_from_slice(wallet);
    out.extend_from_slice(&net_pts.to_le_bytes());
    out.extend_from_slice(&up_pts.to_le_bytes());
    out.extend_from_slice(&bytes.to_le_bytes());
    out.extend_from_slice(&amount.to_le_bytes());
    out
}

pub fn decode_share(data: &[u8]) -> Result<(u64, [u8; 32], [u8; 32], u64, u64, u64, u128), &'static str> {
    if data.len() != SHARE_DATA_SIZE {
        return Err("share len mismatch");
    }
    let mut u8b = [0u8; 8];
    u8b.copy_from_slice(&data[..8]);
    let epoch_id = u64::from_le_bytes(u8b);
    let mut node_id = [0u8; 32];
    let mut wallet = [0u8; 32];
    node_id.copy_from_slice(&data[8..40]);
    wallet.copy_from_slice(&data[40..72]);
    let mut a = [0u8; 8];
    a.copy_from_slice(&data[72..80]);
    let net = u64::from_le_bytes(a);
    a.copy_from_slice(&data[80..88]);
    let up = u64::from_le_bytes(a);
    a.copy_from_slice(&data[88..96]);
    let bytes = u64::from_le_bytes(a);
    let mut u16b = [0u8; 16];
    u16b.copy_from_slice(&data[96..112]);
    let amount = u128::from_le_bytes(u16b);
    Ok((epoch_id, node_id, wallet, net, up, bytes, amount))
}

#[allow(dead_code)]
pub fn _zero() -> [u8; 32] {
    ZERO32
}

#[cfg(test)]
mod codec_tests {
    use super::*;
    use crate::ckb_hash;

    #[test]
    fn registry_codec_roundtrip_sorted() {
        let rid = ckb_hash(b"registry");
        let op = ckb_hash(b"operator");
        let mut n1 = crate::NodeEntry { node_id: ckb_hash(b"b"), wallet_lock_hash: ckb_hash(b"w2"), eligible: true, beats: 1, bytes: 2 };
        let mut n2 = crate::NodeEntry { node_id: ckb_hash(b"a"), wallet_lock_hash: ckb_hash(b"w1"), eligible: false, beats: 3, bytes: 4 };
        if n1.node_id < n2.node_id { std::mem::swap(&mut n1, &mut n2); }
        // pass unsorted, encoder must sort
        let enc = encode_registry(&rid, &op, &[n1.clone(), n2.clone()]);
        let (d_rid, d_op, nodes) = decode_registry(&enc).unwrap();
        assert_eq!(d_rid, rid);
        assert_eq!(d_op, op);
        assert_eq!(nodes.len(), 2);
        assert!(nodes[0].node_id < nodes[1].node_id);
    }

    #[test]
    fn share_bytes_equal_leaf_preimage() {
        let epoch = 497_585u64;
        let n = ckb_hash(b"n");
        let w = ckb_hash(b"w");
        let enc = encode_share(epoch, &n, &w, 10, 2, 204800, 100);
        assert_eq!(enc.len(), SHARE_DATA_SIZE);
        // leaf must equal ckbhash(data) by construction
        assert_eq!(crate::reward_leaf(epoch, &n, &w, 10, 2, 204800, 100), ckb_hash(&enc));
    }

    #[test]
    fn epoch_codec_roundtrip() {
        let enc = encode_epoch(7, &ckb_hash(b"r"), &ckb_hash(b"m"), &ckb_hash(b"e"), 100, &ckb_hash(b"rr"));
        assert_eq!(enc.len(), EPOCH_DATA_SIZE);
        let (id, _, _, _, pool, _) = decode_epoch(&enc).unwrap();
        assert_eq!(id, 7);
        assert_eq!(pool, 100);
    }
}
