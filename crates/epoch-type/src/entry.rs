// Epoch Type script (v0.1).
//
// Instance per epoch: lock=operator,
// type={code_hash:SELF, hash_type:data2, args: epoch_id LE8 (8B) || REGISTRY_ID (32B) = 40B}
// Data (158B): "RMEP01" || epoch LE8 || registry_id(32) || merkle_root(32)
//              || evidence(32) || pool LE16 || rewards_root(32)
//
// Rules: only mint (GroupInput 0 / GroupOutput 1 with same args) allowed.
// Any consume (GroupInput >=1) rejects -> immutability + double-close protection.
// Mint requires operator lock in inputs + non-zero root/evidence + args<->data match.
//
// NOTE: parses the running script from raw syscall buffers (no `bytes::Bytes`).

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    error::SysError,
    high_level::{load_cell_data, load_cell_lock_hash, QueryIter},
    syscalls,
};
use bees_network_core::{
    check_epoch_mint,
    codec::decode_epoch,
    sysparse::parse_script_args,
    ZERO32,
};

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    BadArgs = 20,
    BadGroup = 21,
    NotOperator = 22,
    ZeroHashes = 23,
    Mismatch = 24,
    Immutable = 25,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Error::IndexOutOfBound,
            SysError::ItemMissing => Error::ItemMissing,
            SysError::LengthNotEnough(_) => Error::LengthNotEnough,
            SysError::Encoding => Error::Encoding,
            _ => Error::Mismatch,
        }
    }
}

pub fn program_entry() -> i8 {
    match main() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

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
    if args.len() != 40 {
        return Err(Error::BadArgs);
    }
    let mut epoch_le = [0u8; 8];
    let mut reg_id = [0u8; 32];
    epoch_le.copy_from_slice(&args[..8]);
    reg_id.copy_from_slice(&args[8..40]);
    let args_epoch = u64::from_le_bytes(epoch_le);

    let in_count = QueryIter::new(load_cell_data, Source::GroupInput).count();
    let out_count = QueryIter::new(load_cell_data, Source::GroupOutput).count();

    // immutability: any input with this exact type group -> reject
    if in_count > 0 {
        return Err(Error::Immutable);
    }
    if out_count != 1 {
        return Err(Error::BadGroup);
    }

    let out_data = load_cell_data(0, Source::GroupOutput)?;
    let (d_epoch, d_rid, root, ev, _pool, _rr) =
        decode_epoch(&out_data).map_err(|_| Error::Mismatch)?;
    if d_epoch != args_epoch {
        return Err(Error::Mismatch);
    }
    if d_rid != reg_id {
        return Err(Error::Mismatch);
    }
    check_epoch_mint(&root, &ev).map_err(|_| Error::ZeroHashes)?;
    if root == ZERO32 || ev == ZERO32 {
        return Err(Error::ZeroHashes);
    }

    // operator must fund inputs: any Input lock == output lock (operator owns Epoch Cell lock)
    let out_lock = load_cell_lock_hash(0, Source::GroupOutput)?;
    let mut idx = 0usize;
    loop {
        match load_cell_lock_hash(idx, Source::Input) {
            Ok(h) => {
                if h == out_lock {
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
