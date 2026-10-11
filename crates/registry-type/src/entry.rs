// Registry Type script (v0.1).
//
// Instance: lock=operator, type={code_hash:SELF, hash_type:data2, args:REGISTRY_ID(32B)}
// Data (fixed pack): registry_id(32) || operator_lock_hash(32) || count LE32 || entries.
// Entry: node_id(32) || wallet_lock_hash(32) || eligible(1B 0/1) || beats LE8 || bytes LE8.
//
// Rules:
// - GroupInput 0 / GroupOutput 1 -> genesis: args == type-id(first Input OutPoint, output 0)
//   and operator lock present in inputs, data well-formed with <=1 node.
// - GroupInput 1 / GroupOutput 1 -> append-one OR single eligibility flip,
//   operator lock must be in GroupInput, registry_id/operator unchanged.
// - else reject (this gives double-mint protection via grouping).
//
// NOTE: parses scripts/outpoints from raw syscall buffers (no `bytes::Bytes`:
// its atomic refcounting emits A-extension ops that CKB-VM rejects).

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::{InputField, Source},
    error::SysError,
    high_level::{load_cell_data, load_cell_lock_hash, QueryIter},
    syscalls,
};
use bees_network_core::{
    check_registry_transition, ckb_hash,
    codec::decode_registry,
    sysparse::{parse_outpoint, parse_script_args},
};

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    BadArgs = 10,
    BadGroup = 11,
    BadGenesisId = 12,
    NotOperator = 13,
    BadTransition = 14,
    BadData = 15,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Error::IndexOutOfBound,
            SysError::ItemMissing => Error::ItemMissing,
            SysError::LengthNotEnough(_) => Error::LengthNotEnough,
            SysError::Encoding => Error::Encoding,
            _ => Error::BadData,
        }
    }
}

pub fn program_entry() -> i8 {
    match main() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

/// Load current running script's raw Molecule bytes (growing buffer).
fn load_script_bytes() -> Result<Vec<u8>, Error> {
    let mut buf = Vec::new();
    buf.resize(128, 0);
    loop {
        match syscalls::load_script(&mut buf, 0) {
            Ok(len) => {
                buf.truncate(len);
                return Ok(buf);
            }
            Err(SysError::LengthNotEnough(len)) => buf.resize(len, 0),
            Err(e) => return Err(e.into()),
        }
    }
}

fn main() -> Result<(), Error> {
    let script_raw = load_script_bytes()?;
    let args = parse_script_args(&script_raw).map_err(|_| Error::BadArgs)?;
    if args.len() != 32 {
        return Err(Error::BadArgs);
    }
    let mut registry_id = [0u8; 32];
    registry_id.copy_from_slice(args);

    let in_count = QueryIter::new(load_cell_data, Source::GroupInput).count();
    let out_count = QueryIter::new(load_cell_data, Source::GroupOutput).count();

    if in_count == 0 && out_count == 1 {
        // --- genesis ---
        let out_data = load_cell_data(0, Source::GroupOutput)?;
        let (d_rid, _op, nodes) = decode_registry(&out_data).map_err(|_| Error::BadData)?;
        if d_rid != registry_id {
            return Err(Error::BadData);
        }
        if nodes.len() > 1 {
            return Err(Error::BadTransition);
        }
        // Type-ID check: args == blake2b(first Input OutPoint || output_index LE64=0)
        let mut op_raw = [0u8; 36];
        let olen = syscalls::load_input_by_field(
            &mut op_raw,
            0,
            0,
            Source::Input,
            InputField::OutPoint,
        )?;
        if olen != 36 {
            return Err(Error::BadData);
        }
        let (tx_hash, idx) = parse_outpoint(&op_raw).map_err(|_| Error::BadData)?;
        let mut pre = Vec::with_capacity(32 + 4 + 8);
        pre.extend_from_slice(tx_hash);
        pre.extend_from_slice(&idx.to_le_bytes());
        pre.extend_from_slice(&0u64.to_le_bytes());
        let expect = ckb_hash(&pre);
        if expect != registry_id {
            return Err(Error::BadGenesisId);
        }
        // operator must own an input (its lock hash == data.operator)
        let (_, op_hash, _) = decode_registry(&out_data).map_err(|_| Error::BadData)?;
        check_operator_in_inputs(&op_hash, Source::Input)?;
        return Ok(());
    }

    if in_count == 1 && out_count == 1 {
        let in_data = load_cell_data(0, Source::GroupInput)?;
        let out_data = load_cell_data(0, Source::GroupOutput)?;
        let (in_rid, in_op, in_nodes) = decode_registry(&in_data).map_err(|_| Error::BadData)?;
        let (out_rid, out_op, out_nodes) = decode_registry(&out_data).map_err(|_| Error::BadData)?;
        if in_rid != registry_id || out_rid != registry_id {
            return Err(Error::BadData);
        }
        if in_op != out_op {
            return Err(Error::BadTransition);
        }
        // operator lock must be among GroupInput locks (delegate-sig: operator owns the cell)
        check_operator_in_inputs(&in_op, Source::GroupInput)?;
        check_registry_transition(&in_nodes, &out_nodes).map_err(|_| Error::BadTransition)?;
        return Ok(());
    }

    Err(Error::BadGroup)
}

/// Require that some cell in `source` carries lock hash == operator.
fn check_operator_in_inputs(operator: &[u8; 32], source: Source) -> Result<(), Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_lock_hash(idx, source) {
            Ok(h) => {
                if &h == operator {
                    return Ok(());
                }
                idx += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Err(Error::NotOperator)
}
