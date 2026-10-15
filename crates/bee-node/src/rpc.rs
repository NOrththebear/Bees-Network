use crate::config::NodeConfig;
use crate::types::{NodeStatus, TaskResult};
use crate::crypto::{load_private_key, sign_message};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use hex;
use std::str::FromStr;
use tracing::{debug, error, info, warn};
use uuid::Uuid;
use ckb_hash::blake2b_256;
use secp256k1::{SecretKey, PublicKey, Secp256k1, Message};

const REGISTRY_TYPE_HASH: &str = "0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8";
const EPOCH_TYPE_HASH: &str = "0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1";
const REWARDS_LOCK_HASH: &str = "0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84";
const OPERATOR_LOCK_HASH: &str = "0x8e42b1999f265a0078503c4acec4d5e134534297";
const SECP256K1_LOCK_HASH: &str = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

#[derive(Serialize, Deserialize)]
struct JsonRpcRequest {
    id: u64,
    jsonrpc: String,
    method: String,
    params: Value,
}

#[derive(Deserialize)]
struct JsonRpcResponse {
    id: u64,
    jsonrpc: String,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Deserialize)]
struct CellOutputRpc {
    capacity: String,
    lock: ScriptRpc,
    type_: Option<ScriptRpc>,
}

#[derive(Serialize, Deserialize)]
struct ScriptRpc {
    code_hash: String,
    hash_type: String,
    args: String,
}

#[derive(Deserialize)]
struct CellRpc {
    output: CellOutputRpc,
    output_data: String,
    block_number: String,
    tx_index: String,
}

#[derive(Deserialize)]
struct GetCellsResponse {
    objects: Vec<CellRpc>,
    last_cursor: String,
}

#[derive(Deserialize)]
struct TipHeaderResponse {
    number: String,
    hash: String,
}

async fn json_rpc_call(url: &str, method: &str, params: Value) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::new();
    let request = JsonRpcRequest {
        id: 1,
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
    };
    
    let response = client.post(url)
        .json(&request)
        .send()
        .await?
        .json::<JsonRpcResponse>()
        .await?;
    
    if let Some(err) = response.error {
        return Err(format!("RPC error {}: {}", err.code, err.message).into());
    }
    
    Ok(response.result.unwrap_or(Value::Null))
}

fn get_rpc_url(network: &str) -> String {
    match network {
        "testnet" => "https://testnet.ckb.dev".to_string(),
        "mainnet" => "https://mainnet.ckb.dev".to_string(),
        _ => "https://testnet.ckb.dev".to_string(),
    }
}

fn get_indexer_url(network: &str) -> String {
    match network {
        "testnet" => "https://testnet.ckb.dev/indexer".to_string(),
        "mainnet" => "https://mainnet.ckb.dev/indexer".to_string(),
        _ => "https://testnet.ckb.dev/indexer".to_string(),
    }
}

pub async fn register_node_rpc(
    wallet: &crate::config::WalletConfig,
    node_id: &str,
    config: &NodeConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rpc_url = get_rpc_url(&config.network);
    let indexer_url = get_indexer_url(&config.network);
    
    let registry_args = node_id.strip_prefix("0x").unwrap_or(node_id);
    
    let search_key = json!({
        "script": {
            "code_hash": REGISTRY_TYPE_HASH,
            "hash_type": "type",
            "args": format!("0x{}", registry_args)
        },
        "script_type": "type",
        "script_search_mode": "prefix",
        "with_data": true
    });
    
    let result = json_rpc_call(&indexer_url, "get_cells", json!([search_key, "desc", "0x1", null])).await?;
    let cells_response: GetCellsResponse = serde_json::from_value(result)?;
    
    if !cells_response.objects.is_empty() {
        info!("Node already registered: {}", node_id);
        return Ok(());
    }
    
    info!("Registering node: {}", node_id);
    
    let private_key = load_private_key(&wallet.keychain_id)?;
    let priv_hex = private_key.strip_prefix("0x").unwrap_or(&private_key);
    let priv_bytes = hex::decode(priv_hex)?;
    let secp = Secp256k1::new();
    let secret_key = SecretKey::from_slice(&priv_bytes)?;
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    // Use the canonical lock hash from wallet config (computed via
    // secp256k1_blake160: blake160(pubkey) -> Script -> ckbhash).
    // Verifies the stored key matches the wallet identity.
    let pub_hex = format!("0x{}", hex::encode(public_key.serialize()));
    let expected_lock = crate::crypto::compute_lock_hash(&pub_hex)
        .map_err(|e| format!("lock hash mismatch: {}", e))?;
    if !expected_lock.eq_ignore_ascii_case(&wallet.lock_hash) {
        return Err(format!(
            "stored key does not match wallet lock_hash (derived {}, wallet {})",
            expected_lock, wallet.lock_hash
        )
        .into());
    }
    let lock_hash = wallet.lock_hash.trim_start_matches("0x").to_string();
    
    let registry_data = build_registry_cell_data(node_id, &wallet.lock_hash);
    
    let tx = build_registration_transaction(&rpc_url, &indexer_url, &lock_hash, registry_args, registry_data, &wallet.lock_hash).await?;
    
    let result = json_rpc_call(&rpc_url, "send_transaction", json!([tx, "passthrough"])).await?;
    let tx_hash = result.as_str().unwrap_or("unknown");
    info!("Node registration tx sent: {}", tx_hash);
    
    Ok(())
}

fn build_registry_cell_data(node_id: &str, wallet_lock_hash: &str) -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(&hex::decode(node_id.strip_prefix("0x").unwrap()).unwrap());
    data.extend_from_slice(&hex::decode(wallet_lock_hash.strip_prefix("0x").unwrap()).unwrap());
    data.push(1u8);
    data.extend_from_slice(&0u64.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes());
    data
}

async fn build_registration_transaction(
    rpc_url: &str,
    indexer_url: &str,
    lock_hash: &str,
    registry_args: &str,
    registry_data: Vec<u8>,
    wallet_lock_hash: &str,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let capacity_needed = 10_000_000_000u64;
    
    let lock_script = json!({
        "code_hash": SECP256K1_LOCK_HASH,
        "hash_type": "type",
        "args": format!("0x{}", lock_hash)
    });
    
    let type_script = json!({
        "code_hash": REGISTRY_TYPE_HASH,
        "hash_type": "type",
        "args": format!("0x{}", registry_args)
    });
    
    let search_key = json!({
        "script": lock_script,
        "script_type": "lock",
        "script_search_mode": "prefix",
        "with_data": false
    });
    
    let result = json_rpc_call(indexer_url, "get_cells", json!([search_key, "desc", "0x14", null])).await?;
    let cells_response: GetCellsResponse = serde_json::from_value(result)?;
    
    let mut input_cells = Vec::new();
    let mut input_capacity = 0u64;
    
    for cell in cells_response.objects {
        if input_capacity >= capacity_needed + 61_000_000_000 {
            break;
        }
        let cap: u64 = u64::from_str_radix(cell.output.capacity.trim_start_matches("0x"), 16).unwrap_or(0);
        input_capacity += cap;
        let tx_hash = cell.output_data.trim_start_matches("0x");
        input_cells.push(json!({
            "tx_hash": tx_hash,
            "index": "0x0"
        }));
    }
    
    if input_capacity < capacity_needed + 61_000_000_000 {
        return Err("Insufficient CKB balance for transaction".into());
    }
    
    let change_capacity = input_capacity - capacity_needed - 61_000_000_000;
    
    let mut outputs = vec![json!({
        "capacity": format!("0x{:x}", capacity_needed),
        "lock": lock_script,
        "type": type_script
    })];
    
    let mut outputs_data = vec![format!("0x{}", hex::encode(&registry_data))];
    
    if change_capacity > 61_000_000_000 {
        outputs.push(json!({
            "capacity": format!("0x{:x}", change_capacity),
            "lock": lock_script
        }));
        outputs_data.push("0x".to_string());
    }
    
    let tx = json!({
        "version": "0x0",
        "cell_deps": [],
        "header_deps": [],
        "inputs": input_cells,
        "outputs": outputs,
        "outputs_data": outputs_data,
        "witnesses": vec!["0x"; input_cells.len()]
    });
    
    Ok(tx)
}

pub async fn submit_beats(
    wallet: &crate::config::WalletConfig,
    config: &NodeConfig,
    beats: u64,
    bytes: u64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rpc_url = get_rpc_url(&config.network);
    let indexer_url = get_indexer_url(&config.network);
    
    let node_id = crate::node::generate_node_id(&wallet.lock_hash, &config.install_uuid);
    let epoch = get_current_epoch(&rpc_url).await?;
    
    info!("Submitting beats for epoch {}: beats={}, bytes={}", epoch, beats, bytes);
    
    let type_script = json!({
        "code_hash": EPOCH_TYPE_HASH,
        "hash_type": "type",
        "args": "0x"
    });
    
    let search_key = json!({
        "script": type_script,
        "script_type": "type",
        "script_search_mode": "prefix",
        "with_data": true
    });
    
    let result = json_rpc_call(&indexer_url, "get_cells", json!([search_key, "desc", "0x1", null])).await?;
    let cells_response: GetCellsResponse = serde_json::from_value(result)?;
    
    if let Some(cell) = cells_response.objects.first() {
        let epoch_cell = &cell.output;
        let epoch_data_hex = cell.output_data.trim_start_matches("0x");
        let mut epoch_data = hex::decode(epoch_data_hex)?;
        
        let private_key = load_private_key(&wallet.keychain_id)?;
        let priv_hex = private_key.strip_prefix("0x").unwrap_or(&private_key);
        let priv_bytes = hex::decode(priv_hex)?;
        let _secret_key = SecretKey::from_slice(&priv_bytes)?;
        
        if epoch_data.len() >= 8 {
            epoch_data[0..8].copy_from_slice(&beats.to_le_bytes());
        }
        if epoch_data.len() >= 16 {
            epoch_data[8..16].copy_from_slice(&bytes.to_le_bytes());
        }
        
        let lock_hash = wallet.lock_hash.trim_start_matches("0x").to_string();
        
        let lock_script = json!({
            "code_hash": SECP256K1_LOCK_HASH,
            "hash_type": "type",
            "args": format!("0x{}", lock_hash)
        });
        
        let search_key = json!({
            "script": lock_script,
            "script_type": "lock",
            "script_search_mode": "prefix",
            "with_data": false
        });
        
        let result = json_rpc_call(&indexer_url, "get_cells", json!([search_key, "desc", "0x14", null])).await?;
        let cells_response: GetCellsResponse = serde_json::from_value(result)?;
        
        let mut input_cells = Vec::new();
        let mut input_capacity = 0u64;
        let capacity_needed: u64 = u64::from_str_radix(epoch_cell.capacity.trim_start_matches("0x"), 16).unwrap_or(0);
        
        for c in cells_response.objects {
            if input_capacity >= capacity_needed + 61_000_000_000 {
                break;
            }
            let cap: u64 = u64::from_str_radix(c.output.capacity.trim_start_matches("0x"), 16).unwrap_or(0);
            input_capacity += cap;
            let tx_hash = c.output_data.trim_start_matches("0x");
            input_cells.push(json!({
                "tx_hash": tx_hash,
                "index": "0x0"
            }));
        }
        
        if input_capacity < capacity_needed + 61_000_000_000 {
            warn!("Insufficient CKB balance for beats submission");
            return Ok(());
        }
        
        let change_capacity = input_capacity - capacity_needed - 61_000_000_000;
        
        let mut outputs = vec![json!({
            "capacity": epoch_cell.capacity,
            "lock": epoch_cell.lock,
            "type": epoch_cell.type_
        })];
        
        let mut outputs_data = vec![format!("0x{}", hex::encode(&epoch_data))];
        
        if change_capacity > 61_000_000_000 {
            outputs.push(json!({
                "capacity": format!("0x{:x}", change_capacity),
                "lock": lock_script
            }));
            outputs_data.push("0x".to_string());
        }
        
        let tx = json!({
            "version": "0x0",
            "cell_deps": [],
            "header_deps": [],
            "inputs": input_cells,
            "outputs": outputs,
            "outputs_data": outputs_data,
            "witnesses": vec!["0x"; input_cells.len()]
        });
        
        let result = json_rpc_call(&rpc_url, "send_transaction", json!([tx, "passthrough"])).await?;
        let tx_hash = result.as_str().unwrap_or("unknown");
        info!("Beats submission tx sent: {}", tx_hash);
    } else {
        warn!("No epoch cell found for submission");
    }
    
    Ok(())
}

pub async fn claim_rewards_rpc(
    wallet: &crate::config::WalletConfig,
    config: &NodeConfig,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let indexer_url = get_indexer_url(&config.network);
    
    info!("Claiming rewards for wallet: {}", wallet.address);
    
    let lock_script = json!({
        "code_hash": REWARDS_LOCK_HASH,
        "hash_type": "type",
        "args": wallet.lock_hash
    });
    
    let search_key = json!({
        "script": lock_script,
        "script_type": "lock",
        "script_search_mode": "prefix",
        "with_data": true
    });
    
    let result = json_rpc_call(&indexer_url, "get_cells", json!([search_key, "desc", "0x32", null])).await?;
    let cells_response: GetCellsResponse = serde_json::from_value(result)?;
    
    let mut total_claimed = 0u64;
    
    for cell in cells_response.objects {
        let capacity: u64 = u64::from_str_radix(cell.output.capacity.trim_start_matches("0x"), 16).unwrap_or(0);
        total_claimed += capacity;
    }
    
    if total_claimed > 0 {
        info!("Found {} shannons in reward cells", total_claimed);
    }
    
    Ok(total_claimed)
}

pub async fn get_epoch_info(config: &NodeConfig) -> Result<crate::types::EpochData, Box<dyn std::error::Error + Send + Sync>> {
    let rpc_url = get_rpc_url(&config.network);
    let indexer_url = get_indexer_url(&config.network);
    let epoch = get_current_epoch(&rpc_url).await?;
    
    let type_script = json!({
        "code_hash": EPOCH_TYPE_HASH,
        "hash_type": "type",
        "args": "0x"
    });
    
    let search_key = json!({
        "script": type_script,
        "script_type": "type",
        "script_search_mode": "prefix",
        "with_data": true
    });
    
    let result = json_rpc_call(&indexer_url, "get_cells", json!([search_key, "desc", "0x1", null])).await?;
    let cells_response: GetCellsResponse = serde_json::from_value(result)?;
    
    let mut pool = 0u64;
    let mut merkle_root = "0x".to_string() + &"0".repeat(64);
    let mut evidence_hash = "0x".to_string() + &"0".repeat(64);
    let mut rewards_root = "0x".to_string() + &"0".repeat(64);
    
    if let Some(cell) = cells_response.objects.first() {
        let data_hex = cell.output_data.trim_start_matches("0x");
        let data = hex::decode(data_hex).unwrap_or_default();
        if data.len() >= 32 {
            merkle_root = format!("0x{}", hex::encode(&data[0..32]));
        }
        if data.len() >= 64 {
            evidence_hash = format!("0x{}", hex::encode(&data[32..64]));
        }
        if data.len() >= 96 {
            rewards_root = format!("0x{}", hex::encode(&data[64..96]));
        }
        if data.len() >= 80 {
            pool = u64::from_le_bytes(data[72..80].try_into().unwrap_or([0;8]));
        }
    }
    
    Ok(crate::types::EpochData {
        epoch_id: epoch,
        registry_id: "0x1693da11047c21d4995d5f2d71f09dc8f102368761c14d931a4a979c28117db7".to_string(),
        merkle_root,
        evidence_hash,
        pool,
        rewards_root,
    })
}

async fn get_current_epoch(rpc_url: &str) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let result = json_rpc_call(rpc_url, "get_tip_header", json!([])).await?;
    let block_number: u64 = u64::from_str_radix(
        result["number"].as_str().unwrap_or("0").trim_start_matches("0x"),
        16
    ).unwrap_or(0);
    Ok(block_number / 1000)
}

pub async fn get_network_nodes(config: &NodeConfig) -> Result<Vec<crate::types::NodeInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let indexer_url = get_indexer_url(&config.network);
    
    let type_script = json!({
        "code_hash": REGISTRY_TYPE_HASH,
        "hash_type": "type",
        "args": "0x"
    });
    
    let search_key = json!({
        "script": type_script,
        "script_type": "type",
        "script_search_mode": "prefix",
        "with_data": true
    });
    
    let result = json_rpc_call(&indexer_url, "get_cells", json!([search_key, "desc", "0x64", null])).await?;
    let cells_response: GetCellsResponse = serde_json::from_value(result)?;
    
    let mut nodes = Vec::new();
    for cell in cells_response.objects {
        let data_hex = cell.output_data.trim_start_matches("0x");
        let data = hex::decode(data_hex).unwrap_or_default();
        if data.len() >= 81 {
            let node_id = hex::encode(&data[0..32]);
            let wallet_lock_hash = hex::encode(&data[32..64]);
            let eligible = data[64] == 1;
            let beats = u64::from_le_bytes(data[65..73].try_into().unwrap_or([0;8]));
            let bytes = u64::from_le_bytes(data[73..81].try_into().unwrap_or([0;8]));
            
            nodes.push(crate::types::NodeInfo {
                node_id: format!("0x{}", node_id),
                location: crate::types::Location::default(),
                capabilities: vec![],
                version: "0.1.0".to_string(),
                uptime_secs: 0,
                total_beats: beats,
                total_bytes: bytes,
                current_epoch: 0,
            });
        }
    }
    
    Ok(nodes)
}

pub async fn derive_ckb_address(pubkey_hex: &str, network: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    use ckb_hash::blake2b_256;
    use secp256k1::PublicKey;
    use hex;

    let pub_bytes = hex::decode(pubkey_hex.strip_prefix("0x").unwrap_or(pubkey_hex))
        .map_err(|e| format!("Invalid pubkey hex: {}", e))?;
    
    let pubkey = PublicKey::from_slice(&pub_bytes)
        .map_err(|e| format!("Invalid public key: {}", e))?;
    
    // blake160 of compressed pubkey = lock args
    let hash = blake2b_256(&pubkey.serialize());
    let args = &hash[0..20];
    
    // Build lock script
    let lock_hash = if network == "mainnet" {
        "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"
    } else {
        "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"
    };
    
    // CKB address format: ckt1... for testnet, ckb1... for mainnet
    // Using bech32 encoding with prefix
    let prefix = if network == "mainnet" { "ckb" } else { "ckt" };
    
    // Construct address payload: 0x00 | code_hash (32) | hash_type (1) | args (20)
    // Per docs.nervos.org ckb-address: payload = 0x00 | code_hash | hash_type | args,
    // then Bech32m-encoded (matches @ckb-ccc/core Address.toString()).
    let code_hash = hex::decode(lock_hash.strip_prefix("0x").unwrap_or(lock_hash))?;
    let mut payload = Vec::with_capacity(1 + 32 + 1 + 20);
    payload.push(0x00); // full-address version byte
    payload.extend_from_slice(&code_hash);
    payload.push(0x01); // type hash type
    payload.extend_from_slice(args);
    
    // bech32 encode
    let hrp = bech32::Hrp::parse(prefix).map_err(|e| format!("Invalid HRP: {}", e))?;
    let address = bech32::encode::<bech32::Bech32m>(hrp, &payload)
        .map_err(|e| format!("Address encoding failed: {}", e))?;
    
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    // privkey 0x01 -> G. CCC reference:
    // ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt4z78ng4yutl5u6xsv27ht6q08mhujf8s2r0n40
    #[tokio::test]
    async fn derive_address_matches_ccc() {
        let pub_hex = "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        let addr = derive_ckb_address(pub_hex, "testnet").await.unwrap();
        assert_eq!(
            addr,
            "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt4z78ng4yutl5u6xsv27ht6q08mhujf8s2r0n40"
        );
    }
}