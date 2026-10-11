// Registry Type script binary root.
// On riscv64: no_std + no_main, real CKB-VM entry via ckb-std.
// On host (cargo check/test): std, entry! expands to a panicking stub.
#![cfg_attr(target_arch = "riscv64", no_std)]
#![cfg_attr(target_arch = "riscv64", no_main)]

mod entry;

ckb_std::default_alloc!();
ckb_std::entry!(entry::program_entry);

#[cfg(not(target_arch = "riscv64"))]
fn main() {
    // Host stub. On-chain entry is `_start` (riscv64 only).
}
