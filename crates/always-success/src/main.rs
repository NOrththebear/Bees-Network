// Always-success helper lock for mock-tx fixtures and devnet funding cells.
// NOT for production: anyone can spend cells locked with this.
#![cfg_attr(target_arch = "riscv64", no_std)]
#![cfg_attr(target_arch = "riscv64", no_main)]

ckb_std::default_alloc!();
ckb_std::entry!(program_entry);

fn program_entry() -> i8 {
    0
}

#[cfg(not(target_arch = "riscv64"))]
fn main() {}
