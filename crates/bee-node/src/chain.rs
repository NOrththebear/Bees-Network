//! On-chain operations for the Bee Network node (CKB testnet demo).
//!
//! Uses `ckb-sdk` for cell collection, capacity balancing, script grouping
//! and secp256k1_blake160_sighash_all signing. Registry/epoch/share data is
//! encoded with `bees-network-core::codec` (the same fixed little-endian
//! layout the on-chain scripts validate).
//!
//! v0.1 registration model: the registry is operator-gated, so the app acts
//! as operator (testnet demo) and appends the user's node to the registry.

use std::collections::HashMap;
use std::str::FromStr;

use bees_network_core::codec::{
    decode_epoch, decode_registry, decode_share, encode_epoch, encode_registry, encode_share,
};
use bees_network_core::{merkle_proof, merkle_root, points_leaf, reward_leaf, NodeEntry};
use serde_json::{json, Value};

use ckb_sdk::{
    constants::SIGHASH_TYPE_HASH,
    rpc::CkbRpcClient,
    traits::{
        CellCollector, DefaultCellCollector, DefaultCellDepResolver, DefaultHeaderDepResolver,
        DefaultTransactionDependencyProvider, SecpCkbRawKeySigner,
    },
    tx_builder::{balance_tx_capacity, fill_placeholder_witnesses, unlock_tx, CapacityBalancer},
    types::ScriptGroup,
    unlock::{ScriptUnlocker, SecpSighashUnlocker},
    ScriptId,
};
use ckb_types::{
    bytes::Bytes,
    core::{BlockView, DepType, ScriptHashType, TransactionBuilder, TransactionView},
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
    H256,
};
use secp256k1_v030 as secp256k1_sdk;

pub const REGISTRY_TYPE_CODE_HASH: &str =
    "0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8";
pub const EPOCH_TYPE_CODE_HASH: &str =
    "0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1";
pub const REWARDS_LOCK_CODE_HASH: &str =
    "0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84";
pub const SECP_CODE_HASH: &str =
    "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

/// Testnet deployment artifacts (see deploy/journal-testnet.json).
pub const REGISTRY_ID: &str =
    "0x1693da11047c21d4995d5f2d71f09dc8f102368761c14d931a4a979c28117db7";
pub const OPERATOR_ARGS: &str = "0x8e42b1999f265a0078503c4acec4d5e134534297";
pub const CODE_TX_HASH: &str =
    "0x6b6f4f43bff47259f6603b5658db61e3e350d7e98ad98639063f6073646f8173";
pub const SECP_DEP_TX_HASH: &str =
    "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37";

pub const FEE_RATE: u64 = 1000;
pub const MAX_FEE: u64 = 10_000_000;

fn strip_0x(s: &str) -> &str {
    s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s)
}

fn byte32_from_hex(s: &str) -> Result<[u8; 32], String> {
    let b = hex::decode(strip_0x(s)).map_err(|e| format!("bad hex '{}': {}", s, e))?;
    if b.len() != 32 {
        return Err(format!("expected 32 bytes, got {}", b.len()));
    }
    let mut a = [0u8; 32];
    a.copy_from_slice(&b);
    Ok(a)
}

fn hex_to_bytes(s: &str) -> Result<Vec<u8>, String> {
    hex::decode(strip_0x(s)).map_err(|e| format!("bad hex '{}': {}", s, e))
}

fn h256(s: &str) -> H256 {
    H256::from_str(strip_0x(s)).expect("valid H256 constant")
}

fn secp_lock(args_hex: &str) -> Script {
    Script::new_builder()
        .code_hash(h256(SECP_CODE_HASH).pack())
        .hash_type(ScriptHashType::Type)
        .args(Bytes::from(hex_to_bytes(args_hex).expect("valid args")).pack())
        .build()
}

fn operator_lock() -> Script {
    secp_lock(OPERATOR_ARGS)
}

/// Build the wallet's real secp256k1_blake160 sighash lock:
/// args = blake160(compressed pubkey) (NOT the lock *hash*).
fn wallet_lock_script(wallet: &crate::config::WalletConfig) -> Result<Script, String> {
    let pub_hex = match wallet.public_key.as_deref() {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => {
            let key = crate::crypto::load_private_key(&wallet.keychain_id)
                .map_err(|e| format!("load wallet key: {}", e))?;
            let kb = hex_to_bytes(&key)?;
            let sk = secp256k1_sdk::SecretKey::from_slice(&kb)
                .map_err(|e| format!("invalid wallet secret key: {}", e))?;
            let secp = secp256k1_sdk::Secp256k1::new();
            let pk = secp256k1_sdk::PublicKey::from_secret_key(&secp, &sk);
            format!("0x{}", hex::encode(pk.serialize()))
        }
    };
    let pk_bytes = hex_to_bytes(&pub_hex)?;
    let h = bees_network_core::ckb_hash(&pk_bytes);
    Ok(Script::new_builder()
        .code_hash(h256(SECP_CODE_HASH).pack())
        .hash_type(ScriptHashType::Type)
        .args(Bytes::from(h[0..20].to_vec()).pack())
        .build())
}

/// The registry singleton's type script (hash_type = data2, args = registry id).
pub fn registry_type() -> Script {
    Script::new_builder()
        .code_hash(h256(REGISTRY_TYPE_CODE_HASH).pack())
        .hash_type(ScriptHashType::Data2)
        .args(Bytes::from(byte32_from_hex(REGISTRY_ID).expect("valid id").to_vec()).pack())
        .build()
}

fn epoch_type(epoch_id: u64) -> Script {
    let mut args = Vec::with_capacity(40);
    args.extend_from_slice(&epoch_id.to_le_bytes());
    args.extend_from_slice(&byte32_from_hex(REGISTRY_ID).expect("valid id"));
    Script::new_builder()
        .code_hash(h256(EPOCH_TYPE_CODE_HASH).pack())
        .hash_type(ScriptHashType::Data2)
        .args(Bytes::from(args).pack())
        .build()
}

fn rewards_lock(epoch_id: u64, rewards_root: &[u8; 32]) -> Script {
    let mut args = Vec::with_capacity(40);
    args.extend_from_slice(&epoch_id.to_le_bytes());
    args.extend_from_slice(rewards_root);
    Script::new_builder()
        .code_hash(h256(REWARDS_LOCK_CODE_HASH).pack())
        .hash_type(ScriptHashType::Data2)
        .args(Bytes::from(args).pack())
        .build()
}

fn cell_dep(tx_hex: &str, index: u32, dep_type: DepType) -> CellDep {
    CellDep::new_builder()
        .out_point(
            OutPoint::new_builder()
                .tx_hash(h256(tx_hex).pack())
                .index(index)
                .build(),
        )
        .dep_type(dep_type)
        .build()
}

fn registry_code_dep() -> CellDep {
    cell_dep(CODE_TX_HASH, 0, DepType::Code)
}

fn secp_dep_group() -> CellDep {
    cell_dep(SECP_DEP_TX_HASH, 0, DepType::DepGroup)
}

struct LiveCell {
    out_point: OutPoint,
    capacity: u64,
    lock: Script,
    type_: Option<Script>,
    data: Vec<u8>,
}

fn script_from_rpc(v: &Value) -> Result<Script, String> {
    let code_hash = v["code_hash"].as_str().ok_or("script missing code_hash")?;
    let hash_type = v["hash_type"].as_str().ok_or("script missing hash_type")?;
    let args = v["args"].as_str().unwrap_or("0x");
    let ht = match hash_type {
        "data" => ScriptHashType::Data,
        "data1" => ScriptHashType::Data1,
        "data2" => ScriptHashType::Data2,
        _ => ScriptHashType::Type,
    };
    Ok(Script::new_builder()
        .code_hash(h256(code_hash).pack())
        .hash_type(ht)
        .args(Bytes::from(hex_to_bytes(args)?).pack())
        .build())
}

/// Query the CKB indexer for live cells matching `script` (as lock or type).
async fn fetch_cells(
    indexer_url: &str,
    script: &Script,
    hash_type: &str,
    script_type: &str,
    search_mode: &str,
    with_data: bool,
    limit: u32,
) -> Result<Vec<LiveCell>, String> {
    let ht = hash_type;
    let body = json!({
        "id": 1,
        "jsonrpc": "2.0",
        "method": "get_cells",
        "params": [{
            "script": {
                "code_hash": format!("0x{}", hex::encode(script.code_hash().as_slice())),
                "hash_type": ht,
                "args": format!("0x{}", hex::encode(script.args().raw_data())),
            },
            "script_type": script_type,
            "script_search_mode": search_mode,
            "with_data": with_data,
        }, "asc", format!("0x{:x}", limit), null]
    });

    let client = reqwest::Client::new();
    let resp: Value = client
        .post(indexer_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = resp.get("error") {
        return Err(format!("indexer error: {}", err));
    }
    let objects = resp
        .get("result")
        .and_then(|r| r.get("objects"))
        .and_then(|o| o.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::with_capacity(objects.len());
    for obj in &objects {
        let tx_hash = obj["out_point"]["tx_hash"].as_str().ok_or("missing tx_hash")?;
        let index = u32::from_str_radix(
            strip_0x(obj["out_point"]["index"].as_str().unwrap_or("0x0")),
            16,
        )
        .unwrap_or(0);
        let capacity = u64::from_str_radix(
            strip_0x(obj["output"]["capacity"].as_str().unwrap_or("0x0")),
            16,
        )
        .unwrap_or(0);
        let out_point = OutPoint::new_builder()
            .tx_hash(h256(tx_hash).pack())
            .index(index)
            .build();
        let lock = script_from_rpc(&obj["output"]["lock"])?;
        let type_ = if obj["output"]["type"].is_null() {
            None
        } else {
            Some(script_from_rpc(&obj["output"]["type"])?)
        };
        let data = hex_to_bytes(obj["output_data"].as_str().unwrap_or("0x"))?;
        out.push(LiveCell { out_point, capacity, lock, type_, data });
    }
    Ok(out)
}

fn build_resolvers(
    rpc_url: &str,
) -> Result<
    (
        CkbRpcClient,
        DefaultTransactionDependencyProvider,
        DefaultCellDepResolver,
        DefaultHeaderDepResolver,
    ),
    String,
> {
    let ckb_client = CkbRpcClient::new(rpc_url);
    let tx_dep_provider = DefaultTransactionDependencyProvider::new(rpc_url, 10);
    let genesis = ckb_client
        .get_block_by_number(0.into())
        .map_err(|e| e.to_string())?
        .ok_or("genesis block not found")?;
    let cell_dep_resolver =
        DefaultCellDepResolver::from_genesis(&BlockView::from(genesis)).map_err(|e| e.to_string())?;
    let header_dep_resolver = DefaultHeaderDepResolver::new(rpc_url);
    Ok((ckb_client, tx_dep_provider, cell_dep_resolver, header_dep_resolver))
}

/// Resolve the operator secret key: `BEE_OPERATOR_SECRET_KEY` env var first,
/// then `config.operator_secret_key`.
pub fn resolve_operator_key(config: &crate::config::NodeConfig) -> Result<String, String> {
    if let Ok(k) = std::env::var("BEE_OPERATOR_SECRET_KEY") {
        if !k.trim().is_empty() {
            return Ok(k);
        }
    }
    config
        .operator_secret_key
        .clone()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            "operator key not configured (set BEE_OPERATOR_SECRET_KEY or config.operator_secret_key)"
                .to_string()
        })
}

/// Register `node_id` in the on-chain registry by appending it (operator-signed).
///
/// Idempotent: if the node id already exists, returns without sending a tx.
pub async fn register_node_onchain(
    wallet: &crate::config::WalletConfig,
    node_id_hex: &str,
    network: &str,
    operator_key_hex: &str,
) -> Result<String, String> {
    let rpc_url = crate::rpc::get_rpc_url(network);
    let indexer_url = crate::rpc::get_indexer_url(network);

    let node_id = byte32_from_hex(node_id_hex)?;
    let wallet_lock = byte32_from_hex(&wallet.lock_hash)?;

    let cells = fetch_cells(&indexer_url, &registry_type(), "data2", "type", "exact", true, 1).await?;
    let registry_cell = cells
        .into_iter()
        .next()
        .ok_or_else(|| format!("registry cell not found for {}", REGISTRY_ID))?;

    let (registry_id, operator, mut nodes) =
        decode_registry(&registry_cell.data).map_err(|e| e.to_string())?;

    if nodes.iter().any(|n| n.node_id == node_id) {
        tracing::info!("node {} already registered", node_id_hex);
        return Ok(node_id_hex.to_string());
    }

    nodes.push(NodeEntry {
        node_id,
        wallet_lock_hash: wallet_lock,
        eligible: true,
        beats: 0,
        bytes: 0,
    });
    let new_data = encode_registry(&registry_id, &operator, &nodes);

    let out_point = registry_cell.out_point.clone();
    let capacity = registry_cell.capacity;
    let op_key = operator_key_hex.to_string();

    let tx_hash = tokio::task::spawn_blocking(move || {
        build_and_send_registration(&rpc_url, out_point, capacity, new_data, &op_key)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(tx_hash)
}

fn build_and_send_registration(
    rpc_url: &str,
    registry_out_point: OutPoint,
    registry_capacity: u64,
    new_data: Vec<u8>,
    operator_key_hex: &str,
) -> Result<String, String> {
    let op_lock = operator_lock();
    let (ckb_client, tx_dep_provider, cell_dep_resolver, header_dep_resolver) =
        build_resolvers(rpc_url)?;

    let mut cell_collector = DefaultCellCollector::new(rpc_url);
    let tip = ckb_client
        .get_tip_block_number()
        .map_err(|e| e.to_string())?
        .value();
    // Never re-select the registry cell as a funding input.
    cell_collector
        .lock_cell(registry_out_point.clone(), tip)
        .map_err(|e| e.to_string())?;

    let registry_output = CellOutput::new_builder()
        .capacity(registry_capacity)
        .lock(op_lock.clone())
        .type_(Some(registry_type()).pack())
        .build();

    let tx = TransactionBuilder::default()
        .cell_dep(registry_code_dep())
        .cell_dep(secp_dep_group())
        .input(CellInput::new(registry_out_point, 0))
        .output(registry_output)
        .output_data(new_data.pack())
        .build();

    let unlockers = make_unlockers(operator_key_hex)?;
    let placeholder = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();
    let mut balancer = CapacityBalancer::new_simple(op_lock, placeholder, FEE_RATE);
    balancer.set_max_fee(Some(MAX_FEE));

    let tx = fill_placeholder_witnesses(tx, &tx_dep_provider, &unlockers)
        .map_err(|e| e.to_string())?
        .0;
    let tx = balancer
        .balance_tx_capacity(
            &tx,
            &mut cell_collector,
            &tx_dep_provider,
            &cell_dep_resolver,
            &header_dep_resolver,
        )
        .map_err(|e| e.to_string())?;
    let (tx, not_unlocked) =
        unlock_tx(tx, &tx_dep_provider, &unlockers).map_err(|e| e.to_string())?;
    assert_secp_signed(&not_unlocked, "node registration")?;

    send_tx(&ckb_client, tx)
}

/// The rewards-lock input is intentionally unsigned (no secp sighash); only a
/// secp256k1 wallet/operator lock group left unsigned is an actual error.
fn assert_secp_signed(groups: &[ScriptGroup], what: &str) -> Result<(), String> {
    let secp = h256(SECP_CODE_HASH);
    if groups.iter().any(|g| g.script.code_hash() == secp.pack()) {
        return Err(format!("{what}: a secp256k1 lock group was not signed"));
    }
    Ok(())
}

fn make_unlockers(
    operator_key_hex: &str,
) -> Result<HashMap<ScriptId, Box<dyn ScriptUnlocker>>, String> {
    let key_bytes = hex_to_bytes(operator_key_hex)?;
    let secret_key = secp256k1_sdk::SecretKey::from_slice(&key_bytes)
        .map_err(|e| format!("invalid operator secret key: {}", e))?;
    let signer = SecpCkbRawKeySigner::new_with_secret_keys(vec![secret_key]);
    let sighash_unlocker = SecpSighashUnlocker::from(Box::new(signer) as Box<_>);
    let mut unlockers: HashMap<ScriptId, Box<dyn ScriptUnlocker>> = HashMap::new();
    unlockers.insert(
        ScriptId::new_type(SIGHASH_TYPE_HASH),
        Box::new(sighash_unlocker) as Box<dyn ScriptUnlocker>,
    );
    Ok(unlockers)
}

fn send_tx(ckb_client: &CkbRpcClient, tx: TransactionView) -> Result<String, String> {
    let json_tx = ckb_jsonrpc_types::TransactionView::from(tx);
    let hash = ckb_client
        .send_transaction(
            json_tx.inner,
            Some(ckb_jsonrpc_types::OutputsValidator::Passthrough),
        )
        .map_err(|e| format!("send_transaction failed: {}", e))?;
    Ok(format!("0x{}", hex::encode(hash.as_bytes())))
}

/// Find the newest live epoch cell (largest epoch_id) for the testnet registry.
async fn fetch_latest_epoch_cell(network: &str) -> Result<Option<LiveCell>, String> {
    let indexer_url = crate::rpc::get_indexer_url(network);
    let registry_id = byte32_from_hex(REGISTRY_ID)?;
    let any_epoch = Script::new_builder()
        .code_hash(h256(EPOCH_TYPE_CODE_HASH).pack())
        .hash_type(ScriptHashType::Data2)
        .args(Bytes::default().pack())
        .build();

    // Prefix search: epoch cells carry 40-byte args (epoch LE8 || registry id),
    // so an empty-args exact match would never find them.
    let cells = fetch_cells(&indexer_url, &any_epoch, "data2", "type", "prefix", true, 100).await?;
    let mut best: Option<(u64, LiveCell)> = None;
    for c in cells {
        if let Ok((epoch_id, rid, _root, _ev, _pool, _rr)) = decode_epoch(&c.data) {
            if rid == registry_id && best.as_ref().map(|(id, _)| epoch_id > *id).unwrap_or(true) {
                best = Some((epoch_id, c));
            }
        }
    }
    Ok(best.map(|(_, c)| c))
}

/// Result of seeding an epoch + single share for a node.
pub struct SeedResult {
    pub tx_hash: String,
    pub epoch_out_point: String,
    pub share_out_point: String,
}

/// Test/ops helper: mint one epoch cell and one reward (share) cell for the
/// wallet's node so the claim path can be exercised end-to-end. Operator-signed.
///
/// The epoch's `rewards_root` is the single share leaf, so a claim needs an
/// empty proof (valid single-leaf tree).
pub async fn seed_epoch_share_onchain(
    wallet: &crate::config::WalletConfig,
    node_id_hex: &str,
    epoch_id: u64,
    amount: u128,
    network: &str,
    operator_key_hex: &str,
) -> Result<SeedResult, String> {
    let rpc_url = crate::rpc::get_rpc_url(network);
    let node_id = byte32_from_hex(node_id_hex)?;
    let wallet_lock = byte32_from_hex(&wallet.lock_hash)?;
    let registry_id = byte32_from_hex(REGISTRY_ID)?;

    let net_pts: u64 = 1;
    let up_pts: u64 = 1;
    let bytes: u64 = 204_800;

    let rewards_root =
        reward_leaf(epoch_id, &node_id, &wallet_lock, net_pts, up_pts, bytes, amount);
    let points_root = points_leaf(&node_id, net_pts, up_pts, bytes);
    let evidence_hash = bees_network_core::ckb_hash(b"bees-network/seed-evidence");

    let epoch_data = encode_epoch(
        epoch_id,
        &registry_id,
        &points_root,
        &evidence_hash,
        amount,
        &rewards_root,
    );
    let share_data = encode_share(epoch_id, &node_id, &wallet_lock, net_pts, up_pts, bytes, amount);

    let epoch_script = epoch_type(epoch_id);
    let share_lock = rewards_lock(epoch_id, &rewards_root);
    let op_key = operator_key_hex.to_string();

    tokio::task::spawn_blocking(move || {
        build_and_send_seed(&rpc_url, epoch_script, epoch_data, share_lock, share_data, &op_key)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn build_and_send_seed(
    rpc_url: &str,
    epoch_script: Script,
    epoch_data: Vec<u8>,
    share_lock: Script,
    share_data: Vec<u8>,
    operator_key_hex: &str,
) -> Result<SeedResult, String> {
    const CELL_CAP: u64 = 300_00000000; // 300 CKB
    let op_lock = operator_lock();
    let (ckb_client, tx_dep_provider, cell_dep_resolver, header_dep_resolver) =
        build_resolvers(rpc_url)?;
    let mut cell_collector = DefaultCellCollector::new(rpc_url);

    let tx = TransactionBuilder::default()
        .cell_dep(cell_dep(CODE_TX_HASH, 1, DepType::Code)) // epoch-type
        .cell_dep(secp_dep_group())
        .output(
            CellOutput::new_builder()
                .capacity(CELL_CAP)
                .lock(op_lock.clone())
                .type_(Some(epoch_script).pack())
                .build(),
        )
        .output_data(epoch_data.pack())
        .output(
            CellOutput::new_builder()
                .capacity(CELL_CAP)
                .lock(share_lock)
                .build(),
        )
        .output_data(share_data.pack())
        .build();

    let unlockers = make_unlockers(operator_key_hex)?;
    let placeholder = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();
    let mut balancer = CapacityBalancer::new_simple(op_lock, placeholder, FEE_RATE);
    balancer.set_max_fee(Some(MAX_FEE));

    let tx = fill_placeholder_witnesses(tx, &tx_dep_provider, &unlockers)
        .map_err(|e| e.to_string())?
        .0;
    let tx = balancer
        .balance_tx_capacity(
            &tx,
            &mut cell_collector,
            &tx_dep_provider,
            &cell_dep_resolver,
            &header_dep_resolver,
        )
        .map_err(|e| e.to_string())?;
    let (tx, not_unlocked) =
        unlock_tx(tx, &tx_dep_provider, &unlockers).map_err(|e| e.to_string())?;
    assert_secp_signed(&not_unlocked, "epoch seed")?;

    let tx_hash = format!("0x{}", hex::encode(tx.hash().as_slice()));
    send_tx(&ckb_client, tx)?;
    Ok(SeedResult {
        epoch_out_point: format!("{}:0x0", tx_hash),
        share_out_point: format!("{}:0x1", tx_hash),
        tx_hash,
    })
}

/// Claim rewards for the wallet's node(s): reconstructs the merkle proof from
/// the live reward/share cells and claims every matching share.
pub async fn claim_rewards_onchain(
    wallet: &crate::config::WalletConfig,
    network: &str,
) -> Result<u64, String> {
    let rpc_url = crate::rpc::get_rpc_url(network);
    let indexer_url = crate::rpc::get_indexer_url(network);
    let wallet_lock = byte32_from_hex(&wallet.lock_hash)?;

    let epoch_cell = match fetch_latest_epoch_cell(network).await? {
        Some(c) => c,
        None => {
            tracing::info!("no epoch cell found");
            return Ok(0);
        }
    };
    let (epoch_id, _registry_id, _merkle_root, _evidence_hash, _pool, rewards_root) =
        decode_epoch(&epoch_cell.data).map_err(|e| e.to_string())?;

    // Every claim cell for this epoch is locked by the rewards-lock script.
    let lock_script = rewards_lock(epoch_id, &rewards_root);
    let share_cells = fetch_cells(&indexer_url, &lock_script, "data2", "lock", "exact", true, 200).await?;

    // Rebuild the ordered reward leaves from the on-chain share data.
    let mut datas: Vec<Vec<u8>> = Vec::new();
    for c in &share_cells {
        if c.data.len() == bees_network_core::codec::SHARE_DATA_SIZE {
            datas.push(c.data.clone());
        }
    }
    if datas.is_empty() {
        tracing::info!("no reward cells for epoch {}", epoch_id);
        return Ok(0);
    }
    let leaves: Vec<[u8; 32]> = datas.iter().map(|d| bees_network_core::ckb_hash(d)).collect();
    let root = merkle_root(leaves.clone());
    if root != rewards_root {
        return Err(format!(
            "reconstructed rewards root 0x{} != epoch rewards_root 0x{}",
            hex::encode(root),
            hex::encode(rewards_root)
        ));
    }

    let mut claimed_total: u64 = 0;
    for (idx, data) in datas.iter().enumerate() {
        let (_e, _node_id, share_wallet, _net, _up, _bytes, _amount) =
            decode_share(data).map_err(|e| e.to_string())?;
        if share_wallet != wallet_lock {
            continue;
        }
        let proof = merkle_proof(&leaves, idx).map_err(|e| e.to_string())?;
        let wit = encode_proof_witness(&proof);

        let cell = share_cells
            .iter()
            .find(|c| c.data == *data)
            .ok_or("share cell vanished")?;
        let out_point = cell.out_point.clone();
        let capacity = cell.capacity;
        let wallet_config = wallet.clone();
        let epoch_out_point = epoch_cell.out_point.clone();
        let rpc_url_c = rpc_url.clone();

        let amount = tokio::task::spawn_blocking(move || {
            build_and_send_claim(
                &rpc_url_c,
                out_point,
                capacity,
                &epoch_out_point,
                wit,
                &wallet_config,
            )
        })
        .await
        .map_err(|e| e.to_string())??;
        claimed_total += amount;
    }

    Ok(claimed_total)
}

/// rewards-lock witness: `WitnessArgs{lock:None, input_type:Some(fixvec(proof)), output_type:None}`
/// (matches `ckb-client::encodeProofForWitness` and `bees_network_core::sysparse::parse_witness_input_type`).
fn encode_proof_witness(proof: &[[u8; 32]]) -> Vec<u8> {
    let mut raw = Vec::with_capacity(proof.len() * 32);
    for p in proof {
        raw.extend_from_slice(p);
    }
    let field_len = 4 + raw.len();
    let total = 16 + field_len;
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&16u32.to_le_bytes()); // lock (None)
    out.extend_from_slice(&16u32.to_le_bytes()); // input_type
    out.extend_from_slice(&((16 + field_len) as u32).to_le_bytes()); // output_type (None)
    out.extend_from_slice(&(raw.len() as u32).to_le_bytes()); // fixvec item_count
    out.extend_from_slice(&raw);
    out
}

#[allow(clippy::too_many_arguments)]
fn build_and_send_claim(
    rpc_url: &str,
    share_out_point: OutPoint,
    share_capacity: u64,
    epoch_out_point: &OutPoint,
    witness_lock: Vec<u8>,
    wallet: &crate::config::WalletConfig,
) -> Result<u64, String> {
    let (ckb_client, tx_dep_provider, cell_dep_resolver, header_dep_resolver) =
        build_resolvers(rpc_url)?;

    let wallet_lock = wallet_lock_script(wallet)?;

    let mut cell_collector = DefaultCellCollector::new(rpc_url);
    let tip = ckb_client
        .get_tip_block_number()
        .map_err(|e| e.to_string())?
        .value();
    cell_collector
        .lock_cell(share_out_point.clone(), tip)
        .map_err(|e| e.to_string())?;

    // Pay the whole claim cell capacity to the wallet; keep a small fee margin.
    let fee = 10_000u64;
    let payout = share_capacity.saturating_sub(fee);

    let tx = TransactionBuilder::default()
        .cell_dep(cell_dep(CODE_TX_HASH, 2, DepType::Code)) // rewards-lock
        .cell_dep(CellDep::new_builder().out_point(epoch_out_point.clone()).dep_type(DepType::Code).build())
        .cell_dep(secp_dep_group())
        .input(CellInput::new(share_out_point, 0))
        .output(
            CellOutput::new_builder()
                .capacity(payout)
                .lock(wallet_lock.clone())
                .build(),
        )
        .output_data(Bytes::default().pack())
        .witness(witness_lock.pack())
        .build();

    let unlockers = make_unlockers_from_wallet(wallet)?;
    let mut balancer = CapacityBalancer::new_simple(
        wallet_lock,
        WitnessArgs::new_builder()
            .lock(Some(Bytes::from(vec![0u8; 65])).pack())
            .build(),
        FEE_RATE,
    );
    balancer.set_max_fee(Some(MAX_FEE));

    let tx = fill_placeholder_witnesses(tx, &tx_dep_provider, &unlockers)
        .map_err(|e| e.to_string())?
        .0;
    let tx = balancer
        .balance_tx_capacity(
            &tx,
            &mut cell_collector,
            &tx_dep_provider,
            &cell_dep_resolver,
            &header_dep_resolver,
        )
        .map_err(|e| e.to_string())?;
    let (tx, not_unlocked) =
        unlock_tx(tx, &tx_dep_provider, &unlockers).map_err(|e| e.to_string())?;
    assert_secp_signed(&not_unlocked, "reward claim")?;

    send_tx(&ckb_client, tx)?;
    Ok(payout)
}

fn make_unlockers_from_wallet(
    wallet: &crate::config::WalletConfig,
) -> Result<HashMap<ScriptId, Box<dyn ScriptUnlocker>>, String> {
    let key = crate::crypto::load_private_key(&wallet.keychain_id)
        .map_err(|e| format!("load wallet key: {}", e))?;
    make_unlockers(&key)
}
