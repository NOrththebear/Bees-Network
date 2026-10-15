use keyring::Entry;
use secp256k1::{SecretKey, PublicKey, Secp256k1, Message};
use ckb_hash::blake2b_256;
use hex;
use std::str::FromStr;
use crate::config::WalletConfig;
use crate::types::{NodeStatus, TaskResult};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Invalid secret key: {0}")]
    InvalidSecretKey(String),
    #[error("Signing error: {0}")]
    Signing(String),
    #[error("No wallet configured")]
    NoWallet,
}

pub const KEYCHAIN_SERVICE: &str = "bee-network";

/// Default secp256k1_blake160 lock code hash (genesis script, mainnet + testnet).
/// See docs.nervos.org: ecosystem-scripts/secp256k1_blake160_sighash_all
pub const SECP256K1_CODE_HASH: &str =
    "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

fn strip_0x(s: &str) -> &str {
    s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s)
}

fn decode_hex(s: &str) -> Result<Vec<u8>, CryptoError> {
    hex::decode(strip_0x(s)).map_err(|e| CryptoError::InvalidSecretKey(e.to_string()))
}

pub fn get_keyring_entry(keychain_id: &str) -> Result<Entry, CryptoError> {
    Ok(Entry::new(KEYCHAIN_SERVICE, keychain_id)?)
}

pub fn store_private_key(keychain_id: &str, private_key_hex: &str) -> Result<(), CryptoError> {
    let entry = get_keyring_entry(keychain_id)?;
    entry.set_password(private_key_hex)?;
    Ok(())
}

pub fn load_private_key(keychain_id: &str) -> Result<String, CryptoError> {
    let entry = get_keyring_entry(keychain_id)?;
    Ok(entry.get_password()?)
}

pub fn delete_private_key(keychain_id: &str) -> Result<(), CryptoError> {
    let entry = get_keyring_entry(keychain_id)?;
    entry.delete_password()?;
    Ok(())
}

pub fn generate_keypair() -> Result<(String, String, String), CryptoError> {
    let secp = Secp256k1::new();
    let (secret_key, public_key) = secp.generate_keypair(&mut rand::thread_rng());
    
    let priv_hex = format!("0x{}", hex::encode(secret_key.secret_bytes()));
    let pub_hex = format!("0x{}", hex::encode(public_key.serialize()));
    
    let lock_hash = compute_lock_hash(&pub_hex)?;
    
    Ok((priv_hex, pub_hex, lock_hash))
}

/// Compute the secp256k1_blake160 lock hash for a compressed public key.
///
/// Per CKB docs (secp256k1_blake160_sighash_all):
///   args = blake160(compressed_pubkey) = blake2b_256(pubkey)[0..20]
///   lock = Script { code_hash: SECP256K1_CODE_HASH, hash_type: type, args }
///   lock_hash = ckbhash(molecule(Script))
pub fn compute_lock_hash(public_key_hex: &str) -> Result<String, CryptoError> {
    let pub_bytes = decode_hex(public_key_hex)?;

    if pub_bytes.len() != 33 {
        return Err(CryptoError::InvalidSecretKey(format!(
            "expected 33-byte compressed public key, got {} bytes",
            pub_bytes.len()
        )));
    }

    // blake160(pubkey): first 20 bytes of ckbhash(pubkey)
    let hash = blake2b_256(&pub_bytes);
    let args = &hash[0..20];

    let script_bytes = encode_script_molecule(SECP256K1_CODE_HASH, 0x01, args)?;
    let lock_hash = blake2b_256(&script_bytes);
    Ok(format!("0x{}", hex::encode(lock_hash)))
}

/// Molecule-encode a CKB Script table:
/// table header (total_size + 3 offsets) + code_hash(32) + hash_type(1) + args(len + bytes).
/// Must match frontend `encodeScriptMolecule` in fiber-keys.ts.
fn encode_script_molecule(
    code_hash_hex: &str,
    hash_type_byte: u8,
    args: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let code_hash = decode_hex(code_hash_hex)?;
    if code_hash.len() != 32 {
        return Err(CryptoError::InvalidSecretKey(format!(
            "expected 32-byte code hash, got {} bytes",
            code_hash.len()
        )));
    }
    let header_len: usize = 4 + 4 * 3;
    let total = header_len + 32 + 1 + 4 + args.len();
    let mut out = vec![0u8; total];
    out[0..4].copy_from_slice(&(total as u32).to_le_bytes());
    out[4..8].copy_from_slice(&(header_len as u32).to_le_bytes());
    out[8..12].copy_from_slice(&((header_len + 32) as u32).to_le_bytes());
    out[12..16].copy_from_slice(&((header_len + 32 + 1) as u32).to_le_bytes());
    out[header_len..header_len + 32].copy_from_slice(&code_hash);
    out[header_len + 32] = hash_type_byte;
    out[header_len + 32 + 1..header_len + 32 + 1 + 4]
        .copy_from_slice(&(args.len() as u32).to_le_bytes());
    out[header_len + 32 + 1 + 4..].copy_from_slice(args);
    Ok(out)
}

pub fn sign_message(private_key_hex: &str, message: &[u8]) -> Result<String, CryptoError> {
    let secp = Secp256k1::new();
    let priv_bytes = decode_hex(private_key_hex)?;
    
    let secret_key = SecretKey::from_slice(&priv_bytes)
        .map_err(|e| CryptoError::InvalidSecretKey(e.to_string()))?;
    
    let msg_hash = blake2b_256(message);
    let message = Message::from_slice(&msg_hash)
        .map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    let sig = secp.sign_ecdsa_recoverable(&message, &secret_key);
    let (rec_id, sig_bytes) = sig.serialize_compact();
    
    let mut result = Vec::with_capacity(65);
    result.extend_from_slice(&sig_bytes);
    result.push(rec_id.to_i32() as u8);
    
    Ok(hex::encode(result))
}

pub fn verify_signature(public_key_hex: &str, message: &[u8], signature_hex: &str) -> Result<bool, CryptoError> {
    let secp = Secp256k1::new();
    let pub_bytes = decode_hex(public_key_hex)?;
    
    let public_key = PublicKey::from_slice(&pub_bytes)
        .map_err(|e| CryptoError::InvalidSecretKey(e.to_string()))?;
    
    let sig_bytes = decode_hex(signature_hex)
        .map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    if sig_bytes.len() != 65 {
        return Err(CryptoError::Signing("Invalid signature length".into()));
    }
    
    let rec_id = secp256k1::ecdsa::RecoveryId::from_i32(sig_bytes[64] as i32)
        .map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    let sig = secp256k1::ecdsa::RecoverableSignature::from_compact(&sig_bytes[..64], rec_id)
        .map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    let msg_hash = blake2b_256(message);
    let message = Message::from_slice(&msg_hash)
        .map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    let recovered_pub = secp.recover_ecdsa(&message, &sig)
        .map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    Ok(recovered_pub.serialize() == public_key.serialize())
}

pub async fn sign_task_result(
    wallet: &WalletConfig,
    result: &TaskResult,
) -> Result<TaskResult, CryptoError> {
    if wallet.keychain_id.is_empty() {
        return Err(CryptoError::NoWallet);
    }
    
    let private_key = load_private_key(&wallet.keychain_id)?;
    
    let mut result_clone = result.clone();
    let signing_data = serde_json::to_vec(&serde_json::json!({
        "task_id": result.task_id,
        "success": result.success,
        "data": result.data,
        "bytes_sent": result.bytes_sent,
        "bytes_received": result.bytes_received,
        "duration_ms": result.duration_ms,
        "timestamp": result.timestamp,
    })).map_err(|e| CryptoError::Signing(e.to_string()))?;
    
    let signature = sign_message(&private_key, &signing_data)?;
    result_clone.signature = Some(signature);
    
    Ok(result_clone)
}

pub use secp256k1::rand;

#[cfg(test)]
mod tests {
    use super::*;

    // Test vector: privkey 0x01 -> pubkey G compressed.
    // args = blake160(pubkey) = 0x75178f34549c5fe9cd1a0c57aebd01e7ddf9249e
    // lockHash verified against frontend (fiber-keys.ts) + @ckb-ccc/core Script.hash().
    #[test]
    fn compute_lock_hash_matches_frontend() {
        let pub_hex = "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        let lock = compute_lock_hash(pub_hex).expect("compute lock hash");
        assert_eq!(
            lock.to_lowercase(),
            "0x0b1bae4beaf456349c63c3ce67491fc75a1276d7f9eedd7ea84d6a77f9f3f5f7"
        );
    }

    #[test]
    fn compute_lock_hash_accepts_no_prefix() {
        let with_prefix = "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        let without_prefix = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        assert_eq!(
            compute_lock_hash(with_prefix).unwrap(),
            compute_lock_hash(without_prefix).unwrap()
        );
    }

    #[test]
    fn sign_message_accepts_0x_prefix() {
        let priv_with = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let priv_without = "0000000000000000000000000000000000000000000000000000000000000001";
        let sig1 = sign_message(priv_with, b"hello").unwrap();
        let sig2 = sign_message(priv_without, b"hello").unwrap();
        assert_eq!(sig1, sig2);
    }
}