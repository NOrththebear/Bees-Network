//! Minimal Molecule readers for CKB-VM scripts.
//!
//! These parse `Script.args` and `WitnessArgs.input_type` from raw syscall
//! buffers WITHOUT instantiating `bytes::Bytes` (whose atomic refcounting
//! emits A-extension instructions that CKB-VM rejects). Pure, unit-tested.

fn u32le(b: &[u8]) -> usize {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize
}

/// Parse `Script{code_hash:Byte32, hash_type:byte, args:Bytes}` molecule table,
/// return `(code_hash, hash_type, args)`. NOTE: `args` is a fixvec
/// (`item_count LE32` + items), not raw bytes.
pub fn parse_script(mol: &[u8]) -> Result<(&[u8; 32], u8, &[u8]), &'static str> {
    if mol.len() < 53 {
        return Err("script short");
    }
    let total = u32le(&mol[0..4]);
    let o0 = u32le(&mol[4..8]);
    let o1 = u32le(&mol[8..12]);
    let o2 = u32le(&mol[12..16]);
    if total != mol.len() || o0 != 16 || o1 != 48 || o2 != 49 || o2 + 4 > total {
        return Err("script header mismatch");
    }
    let count = u32le(&mol[o2..o2 + 4]);
    if o2 + 4 + count != total {
        return Err("script args length mismatch");
    }
    let ch: &[u8; 32] = mol[16..48].try_into().map_err(|_| "script hash window")?;
    Ok((ch, mol[48], &mol[o2 + 4..total]))
}

/// Parse `Script` and return only `args` (code_hash/hash_type unused on-chain:
/// script identity is established by script-group matching).
pub fn parse_script_args(mol: &[u8]) -> Result<&[u8], &'static str> {
    let (_, _, args) = parse_script(mol)?;
    Ok(args)
}

/// Parse `WitnessArgs{lock:BytesOpt, input_type:BytesOpt, output_type:BytesOpt}`
/// and return the `input_type` field CONTENT. `Some(bytes)` is the fixvec
/// (`item_count LE32` + items); `None` is empty (rejects here: callers that
/// require a proof treat empty as BadProof).
pub fn parse_witness_input_type(mol: &[u8]) -> Result<&[u8], &'static str> {
    if mol.len() < 16 {
        return Err("witness short");
    }
    let total = u32le(&mol[0..4]);
    let o0 = u32le(&mol[4..8]);
    let o1 = u32le(&mol[8..12]);
    let o2 = u32le(&mol[12..16]);
    if total != mol.len() || o0 < 16 || !(o0 <= o1 && o1 <= o2 && o2 <= total) {
        return Err("witness header mismatch");
    }
    let field = &mol[o1..o2];
    if field.is_empty() {
        return Err("input_type none");
    }
    if field.len() < 4 {
        return Err("input_type short");
    }
    let count = u32le(&field[0..4]);
    if 4 + count != field.len() {
        return Err("input_type length mismatch");
    }
    Ok(&field[4..])
}

/// Parse fixed 36B `OutPoint{tx_hash:Byte32, index:Uint32}` struct.
pub fn parse_outpoint(raw: &[u8]) -> Result<(&[u8; 32], u32), &'static str> {
    if raw.len() != 36 {
        return Err("outpoint len");
    }
    let h: &[u8; 32] = raw[0..32].try_into().map_err(|_| "outpoint hash window")?;
    let idx = u32::from_le_bytes([raw[32], raw[33], raw[34], raw[35]]);
    Ok((h, idx))
}

#[cfg(test)]
mod sysparse_tests {
    use super::*;

    fn mol_script(args: &[u8]) -> alloc::vec::Vec<u8> {
        // args is a fixvec: item_count LE32 + items
        let total = 49 + 4 + args.len();
        let mut o = alloc::vec::Vec::with_capacity(total);
        o.extend_from_slice(&(total as u32).to_le_bytes());
        o.extend_from_slice(&16u32.to_le_bytes());
        o.extend_from_slice(&48u32.to_le_bytes());
        o.extend_from_slice(&49u32.to_le_bytes());
        o.extend_from_slice(&[0xabu8; 32]);
        o.push(4u8);
        o.extend_from_slice(&(args.len() as u32).to_le_bytes());
        o.extend_from_slice(args);
        o
    }

    #[test]
    fn script_args_roundtrip() {
        let args = [7u8; 40];
        let m = mol_script(&args);
        let (h, ht, a) = parse_script(&m).unwrap();
        assert_eq!(h, &[0xabu8; 32]);
        assert_eq!(ht, 4);
        assert_eq!(a, &args);
        assert!(parse_script(&m[..40]).is_err());
        let mut bad = m.clone();
        bad[8] = 47; // corrupt offset
        assert!(parse_script(&bad).is_err());
    }

    #[test]
    fn witness_input_type_roundtrip() {
        // lock=None, input=Some(fixvec 64B proof), output=None (matches fixtures/gen.mjs)
        let proof = [9u8; 64];
        let field_len = 4 + 64;
        let total = 16 + field_len;
        let mut o = alloc::vec::Vec::with_capacity(total);
        o.extend_from_slice(&(total as u32).to_le_bytes());
        o.extend_from_slice(&16u32.to_le_bytes());
        o.extend_from_slice(&16u32.to_le_bytes());
        o.extend_from_slice(&(16 + field_len as u32).to_le_bytes());
        o.extend_from_slice(&(64u32).to_le_bytes());
        o.extend_from_slice(&proof);
        assert_eq!(parse_witness_input_type(&o).unwrap(), &proof);
        assert!(parse_witness_input_type(&o[..10]).is_err());
    }

    #[test]
    fn outpoint_parse() {
        let mut raw = [0u8; 36];
        raw[0..32].copy_from_slice(&[0xccu8; 32]);
        raw[32..36].copy_from_slice(&7u32.to_le_bytes());
        let (h, idx) = parse_outpoint(&raw).unwrap();
        assert_eq!(h, &[0xccu8; 32]);
        assert_eq!(idx, 7);
    }
}

#[cfg(test)]
mod real_entity_tests {
    use super::*;
    use ckb_gen_types::{packed, prelude::*};

    #[test]
    fn parse_real_script_entity() {
        let args = vec![7u8; 32];
        let s = packed::Script::new_builder()
            .code_hash([0xabu8; 32].pack())
            .hash_type(4u8.into())
            .args(args.clone().pack())
            .build();
        let raw = s.as_slice();
        let (h, ht, a) = parse_script(raw).unwrap();
        assert_eq!(h, &[0xabu8; 32]);
        assert_eq!(ht, 4);
        assert_eq!(a, &args);
    }

    #[test]
    fn parse_real_witness_args_entity() {
        let proof = vec![9u8; 32];
        let proof_bytes: packed::Bytes = proof.clone().pack();
        let w = packed::WitnessArgs::new_builder()
            .input_type(
                packed::BytesOpt::new_builder()
                    .set(Some(proof_bytes))
                    .build(),
            )
            .build();
        let raw = w.as_slice();
        assert_eq!(parse_witness_input_type(raw).unwrap(), &proof);
    }
}
