// Rewards Lock script library.
// Exports the program entry point for on-chain execution.

#[cfg(target_arch = "riscv64")]
pub mod entry;

#[cfg(target_arch = "riscv64")]
pub use entry::program_entry;