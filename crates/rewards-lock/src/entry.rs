// Rewards Lock script (v0.1).
//
// Claim Cell: lock={code_hash:SELF, hash_type:data2, args: epoch_id LE8 || rewards_root(32) = 40B}
// Data (112B, == leaf preimage): epoch LE8 || node_id(32) || wallet_lock_hash(32)
//   || net LE8 || up LE8 || bytes LE8 || amount LE16.
//   => leaf = ckbhash(cell data).
// Witness: input_type = concatenated 32B proof siblings.
// CellDeps must include the Epoch Cell whose data.rewards_root == args.root.
//
// Rules (per GroupInput index i):
// - decode share, check share.epoch == args.epoch
// - leaf = ckbhash(share_data); fold proof with sorted-pair hashing; must equal args.root
// - cross-check Epoch Cell in CellDeps carries same rewards_root
// - output lock hash must equal share.wallet_lock_hash (wallet-bound, anti-theft)
// Consume-to-claim gives double-claim protection (Dead cell cannot be reused).
//
// NOTE: parses script/witness from raw syscall buffers (no `bytes::Bytes`).

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    error::SysError,
    high_level::{load_cell_data, load_cell_lock_hash},
    syscalls,
};
use relaymesh_core::ckb_hash;
use relaymesh_core::codec::{decode_epoch, decode_share, EPOCH_DATA_SIZE};
use relaymesh_core::sysparse::{parse_script_args, parse_witness_input_type};

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    BadArgs = 30,
    BadData = 31,
    BadProof = 32,
    NoEpochDep = 33,
    RootMismatch = 34,
    WalletMismatch = 35,
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

fn sort_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let mut pre = [0u8; 64];
    pre[..32].copy_from_slice(lo);
    pre[32..].copy_from_slice(hi);
    ckb_hash(&pre)
}

/// Growing-buffer loader for variable-length syscall payloads.
fn load_sys_vec<F>(mut load: F) -> Result<Vec<u8>, Error>
where
    F: FnMut(&mut [u8], usize) -> Result<usize, SysError>,
{
    let mut buf = Vec::new();
    buf.resize(256, 0);
    loop {
        match load(&mut buf, 0) {
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
    let script_raw = load_sys_vec(|b, o| syscalls::load_script(b, o))?;
    let args = parse_script_args(&script_raw).map_err(|_| Error::BadArgs)?;
    if args.len() != 40 {
        return Err(Error::BadArgs);
    }
    let mut epoch_le = [0u8; 8];
    let mut root = [0u8; 32];
    epoch_le.copy_from_slice(&args[..8]);
    root.copy_from_slice(&args[8..40]);
    let args_epoch = u64::from_le_bytes(epoch_le);

    // Find Epoch Cell in CellDeps with matching rewards_root.
    let epoch_ok = find_epoch_with_root(args_epoch, &root)?;
    if !epoch_ok {
        return Err(Error::NoEpochDep);
    }

    // Verify every GroupInput locked by us.
    let mut idx = 0usize;
    loop {
        let data = match load_cell_data(idx, Source::GroupInput) {
            Ok(d) => d,
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        };
        let (s_epoch, _node, wallet, _net, _up, _bytes, _amt) =
            decode_share(&data).map_err(|_| Error::BadData)?;
        if s_epoch != args_epoch {
            return Err(Error::BadData);
        }
        // leaf = ckbhash(raw share data) by construction
        let leaf = ckb_hash(&data);
        // proof from witness input_type (concatenated 32B siblings)
        let wit_raw = load_sys_vec(|b, o| syscalls::load_witness(b, o, idx, Source::GroupInput))?;
        let proof_bytes =
            parse_witness_input_type(&wit_raw).map_err(|_| Error::BadProof)?;
        // Empty proof is valid for single-leaf trees (fold yields leaf,
        // still checked against root below).
        if proof_bytes.len() % 32 != 0 {
            return Err(Error::BadProof);
        }
        let mut h = leaf;
        for chunk in proof_bytes.chunks(32) {
            let mut s = [0u8; 32];
            s.copy_from_slice(chunk);
            h = sort_pair(&h, &s);
        }
        if h != root {
            return Err(Error::RootMismatch);
        }
        // wallet-bound: some tx output must carry the claimant's lock.
        // NOTE: Source::GroupOutput would mean outputs locked by THIS script
        // (none: the payout goes to the claimant's wallet), so scan tx-level
        // Source::Output instead.
        let mut found = false;
        let mut oidx = 0usize;
        loop {
            match load_cell_lock_hash(oidx, Source::Output) {
                Ok(h) => {
                    if h == wallet {
                        found = true;
                        break;
                    }
                    oidx += 1;
                }
                Err(SysError::IndexOutOfBound) => break,
                Err(e) => return Err(e.into()),
            }
        }
        if !found {
            return Err(Error::WalletMismatch);
        }
        idx += 1;
    }
    if idx == 0 {
        return Err(Error::BadData);
    }
    Ok(())
}

/// Scan CellDeps for an EpochData cell with matching epoch + rewards_root.
fn find_epoch_with_root(epoch: u64, root: &[u8; 32]) -> Result<bool, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(d) => {
                if d.len() == EPOCH_DATA_SIZE {
                    if let Ok((e_epoch, _rid, _mr, _ev, _pool, rr)) = decode_epoch(&d) {
                        if e_epoch == epoch && &rr == root {
                            return Ok(true);
                        }
                    }
                }
                idx += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(false)
}
