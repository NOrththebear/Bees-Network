#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod chain;
mod config;
mod crypto;
mod node;
mod orchestrator_client;
mod rpc;
mod tasks;
mod types;

#[cfg(feature = "tauri")]
mod tauri_app {
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::{Emitter, Manager, State, WindowEvent};
    use tokio::sync::RwLock;
    use tracing::{error, info, warn};

    use crate::api::{NodeApi, WalletApi};
    use crate::config::{NodeConfig, WalletConfig};
    use crate::node::NodeWorker;
    use crate::types::{NodeStatus, TaskRequest, TaskResult};

    #[derive(Default)]
    struct AppState {
        node_worker: Arc<RwLock<Option<NodeWorker>>>,
        config: Arc<RwLock<NodeConfig>>,
    }

    #[derive(Default)]
    struct TauriState {
        inner: Arc<RwLock<AppState>>,
    }

    #[tauri::command]
    async fn get_node_status(state: State<'_, TauriState>) -> Result<NodeStatus, String> {
        let guard = state.inner.read().await;
        let status = if let Some(worker) = guard.node_worker.read().await.as_ref() {
            worker.get_status().await
        } else {
            NodeStatus::Stopped
        };
        drop(guard);
        Ok(status)
    }

    #[tauri::command]
    async fn start_node(state: State<'_, TauriState>, window: tauri::WebviewWindow) -> Result<(), String> {
        let mut guard = state.inner.write().await;
        let config = guard.config.read().await.clone();
        
        if guard.node_worker.read().await.is_some() {
            return Err("Node already running".into());
        }

        let mut worker = NodeWorker::new(config, crate::types::TauriWindow(window)).await.map_err(|e| e.to_string())?;
        worker.start().await.map_err(|e| e.to_string())?;
        
        *guard.node_worker.write().await = Some(worker);
        Ok(())
    }

    #[tauri::command]
    async fn stop_node(state: State<'_, TauriState>) -> Result<(), String> {
        let mut guard = state.inner.write().await;
        
        if let Some(mut worker) = guard.node_worker.write().await.take() {
            worker.stop().await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[tauri::command]
    async fn get_wallet_config(state: State<'_, TauriState>) -> Result<WalletConfig, String> {
        let guard = state.inner.read().await;
        let wallet = guard.config.read().await.wallet.clone();
        drop(guard);
        Ok(wallet)
    }

    #[tauri::command]
    async fn save_wallet_config(
        state: State<'_, TauriState>,
        config: WalletConfig,
    ) -> Result<(), String> {
        let mut guard = state.inner.write().await;
        guard.config.write().await.wallet = config.clone();
        config.save().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    #[tauri::command]
    async fn init_wallet_from_frontend(
        state: State<'_, TauriState>,
        ckb_secret_key_hex: String,
        keychain_id: String,
    ) -> Result<WalletConfig, String> {
        use crate::config::{NodeConfig, WalletConfig};
        use crate::crypto::{store_private_key, compute_lock_hash};
        use secp256k1::{SecretKey, PublicKey, Secp256k1};
        use hex;

        let secp = Secp256k1::new();
        let priv_hex_str = ckb_secret_key_hex.strip_prefix("0x").unwrap_or(&ckb_secret_key_hex);
        let priv_bytes = hex::decode(priv_hex_str)
            .map_err(|e| format!("Invalid secret key hex: {}", e))?;
        if priv_bytes.len() != 32 {
            return Err(format!("Invalid secret key length: expected 32 bytes, got {}", priv_bytes.len()));
        }
        let secret_key = SecretKey::from_slice(&priv_bytes)
            .map_err(|e| format!("Invalid secret key: {}", e))?;
        let public_key = PublicKey::from_secret_key(&secp, &secret_key);
        let pub_hex = format!("0x{}", hex::encode(public_key.serialize()));
        let lock_hash = compute_lock_hash(&pub_hex).map_err(|e| e.to_string())?;
        
        // Derive CKB address (testnet) — payload 0x00|code_hash|hash_type|args + Bech32m,
        // matching @ckb-ccc/core Address.toString() used by the frontend.
        let address = crate::rpc::derive_ckb_address(&pub_hex, "testnet")
            .await
            .map_err(|e| e.to_string())?;

        let wallet = WalletConfig {
            address,
            lock_hash,
            public_key: Some(pub_hex),
            keychain_id,
        };

        store_private_key(&wallet.keychain_id, &ckb_secret_key_hex).map_err(|e| e.to_string())?;

        let mut guard = state.inner.write().await;
        guard.config.write().await.wallet = wallet.clone();
        wallet.save().await.map_err(|e| e.to_string())?;

        Ok(wallet)
    }

    #[tauri::command]
    async fn get_node_config(state: State<'_, TauriState>) -> Result<NodeConfig, String> {
        let guard = state.inner.read().await;
        let config = guard.config.read().await.clone();
        drop(guard);
        Ok(config)
    }

    #[tauri::command]
    async fn save_node_config(
        state: State<'_, TauriState>,
        config: NodeConfig,
    ) -> Result<(), String> {
        let mut guard = state.inner.write().await;
        *guard.config.write().await = config.clone();
        config.save().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    #[tauri::command]
    async fn register_node(
        state: State<'_, TauriState>,
        device_id: Option<String>,
    ) -> Result<String, String> {
        let mut config = {
            let guard = state.inner.read().await;
            let cfg = guard.config.read().await.clone();
            cfg
        };

        // Keep the backend install_uuid in sync with the frontend device id so
        // both sides derive the same node_id = ckbhash("0x<lockhash>:<deviceId>").
        if let Some(device_id) = device_id.filter(|d| !d.trim().is_empty()) {
            if config.install_uuid != device_id {
                config.install_uuid = device_id;
                if let Err(e) = config.save().await {
                    warn!("failed to persist install_uuid: {}", e);
                }
                let guard = state.inner.write().await;
                *guard.config.write().await = config.clone();
            }
        }

        let wallet = config.wallet.clone();
        if wallet.lock_hash.is_empty() {
            return Err("Wallet not configured".into());
        }

        let node_id = crate::node::generate_node_id(&wallet.lock_hash, &config.install_uuid);
        let operator_key = crate::chain::resolve_operator_key(&config)?;

        crate::chain::register_node_onchain(&wallet, &node_id, &config.network, &operator_key)
            .await
            .map_err(|e| e.to_string())?;

        Ok(node_id)
    }

    #[tauri::command]
    async fn claim_rewards(state: State<'_, TauriState>) -> Result<u64, String> {
        let guard = state.inner.read().await;
        let config = guard.config.read().await.clone();
        let wallet = config.wallet.clone();

        if wallet.lock_hash.is_empty() {
            return Err("Wallet not configured".into());
        }

        let amount = crate::chain::claim_rewards_onchain(&wallet, &config.network)
            .await
            .map_err(|e| e.to_string())?;

        Ok(amount)
    }

    pub fn run() {
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .init();

        let config = NodeConfig::load().unwrap_or_default();
        let app_state = Arc::new(RwLock::new(AppState {
            node_worker: Arc::new(RwLock::new(None)),
            config: Arc::new(RwLock::new(config)),
        }));

        let builder = tauri::Builder::default();
        
        #[cfg(feature = "tauri-plugin-shell")]
        let builder = builder.plugin(tauri_plugin_shell::init());
        
        #[cfg(feature = "tauri-plugin-updater")]
        let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        
        #[cfg(feature = "tauri-plugin-autostart")]
        let builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ));

        builder
            .setup(|app| {
                let state: State<TauriState> = app.state();
                let inner = state.inner.clone();
                let window = app.get_webview_window("main");
                tauri::async_runtime::spawn(async move {
                    // Give the window a moment to appear before doing network work.
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let auto_start = { inner.read().await.config.read().await.auto_start };
                    if !auto_start {
                        return;
                    }
                    if inner.read().await.node_worker.read().await.is_some() {
                        return;
                    }
                    let config = { inner.read().await.config.read().await.clone() };
                    if config.wallet.lock_hash.is_empty() {
                        warn!("auto-start skipped: wallet not configured");
                        return;
                    }
                    let Some(win) = window else {
                        warn!("auto-start skipped: main window not found");
                        return;
                    };
                    let mut worker = match NodeWorker::new(config, crate::types::TauriWindow(win)).await {
                        Ok(w) => w,
                        Err(e) => {
                            warn!("auto-start: failed to create node worker: {}", e);
                            return;
                        }
                    };
                    if let Err(e) = worker.start().await {
                        warn!("auto-start: failed to start node: {}", e);
                        return;
                    }
                    *inner.write().await.node_worker.write().await = Some(worker);
                    info!("Node auto-started (config.auto_start=true)");
                });
                Ok(())
            })
            .manage(TauriState {
                inner: app_state.clone(),
            })
            .invoke_handler(tauri::generate_handler![
                get_node_status,
                start_node,
                stop_node,
                get_wallet_config,
                save_wallet_config,
                init_wallet_from_frontend,
                get_node_config,
                save_node_config,
                register_node,
                claim_rewards,
            ])
            .build(tauri::generate_context!())
            .expect("error while building tauri application")
            .run(|_app_handle, event| {
                if let tauri::RunEvent::ExitRequested { api, .. } = event {
                    api.prevent_exit();
                }
            });
    }
}

#[cfg(feature = "tauri")]
fn main() {
    tauri_app::run();
}

#[cfg(not(feature = "tauri"))]
fn main() {
    // Library mode - run headless node
    use crate::config::NodeConfig;
    use crate::node::NodeWorker;
    use crate::types::TauriWindow;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use tracing_subscriber::EnvFilter;

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            tracing_subscriber::fmt()
                .with_env_filter(EnvFilter::from_default_env())
                .init();

            let mut config = NodeConfig::load().unwrap_or_default();

            // One-shot operator helper: register this wallet's node on-chain
            // (operator-signed) and exit. Used for testing/ops:
            //   BEE_REGISTER_ONCE=1 [BEE_DEVICE_ID=...] bee-node
            if std::env::var("BEE_REGISTER_ONCE").unwrap_or_default() == "1" {
                if let Ok(d) = std::env::var("BEE_DEVICE_ID") {
                    if !d.trim().is_empty() {
                        config.install_uuid = d;
                    }
                }
                if config.wallet.lock_hash.is_empty() {
                    eprintln!("Wallet not configured. Link the wallet first.");
                    std::process::exit(1);
                }
                let node_id =
                    crate::node::generate_node_id(&config.wallet.lock_hash, &config.install_uuid);
                let operator_key = match crate::chain::resolve_operator_key(&config) {
                    Ok(k) => k,
                    Err(e) => {
                        eprintln!("{}", e);
                        std::process::exit(1);
                    }
                };
                match crate::chain::register_node_onchain(
                    &config.wallet,
                    &node_id,
                    &config.network,
                    &operator_key,
                )
                .await
                {
                    Ok(hash) => println!("REGISTERED node_id={} tx={}", node_id, hash),
                    Err(e) => {
                        eprintln!("REGISTER FAILED: {}", e);
                        std::process::exit(1);
                    }
                }
                return;
            }

            // One-shot ops helper: mint a test epoch + single reward share for
            // this wallet's node so the claim path is exercisable:
            //   BEE_SEED_EPOCH=1 [BEE_DEVICE_ID=...] [BEE_EPOCH_ID=...] bee-node
            if std::env::var("BEE_SEED_EPOCH").unwrap_or_default() == "1" {
                if let Ok(d) = std::env::var("BEE_DEVICE_ID") {
                    if !d.trim().is_empty() {
                        config.install_uuid = d;
                    }
                }
                if config.wallet.lock_hash.is_empty() {
                    eprintln!("Wallet not configured. Link the wallet first.");
                    std::process::exit(1);
                }
                let node_id =
                    crate::node::generate_node_id(&config.wallet.lock_hash, &config.install_uuid);
                let epoch_id: u64 = std::env::var("BEE_EPOCH_ID")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(497_586);
                let operator_key = match crate::chain::resolve_operator_key(&config) {
                    Ok(k) => k,
                    Err(e) => {
                        eprintln!("{}", e);
                        std::process::exit(1);
                    }
                };
                match crate::chain::seed_epoch_share_onchain(
                    &config.wallet,
                    &node_id,
                    epoch_id,
                    1_000_000_000_000_000_000u128,
                    &config.network,
                    &operator_key,
                )
                .await
                {
                    Ok(r) => println!(
                        "SEEDED epoch_id={} node_id={} tx={} epoch_op={} share_op={}",
                        epoch_id, node_id, r.tx_hash, r.epoch_out_point, r.share_out_point
                    ),
                    Err(e) => {
                        eprintln!("SEED FAILED: {}", e);
                        std::process::exit(1);
                    }
                }
                return;
            }

            // One-shot ops helper: claim all reward shares for this wallet:
            //   BEE_CLAIM_ONCE=1 bee-node
            if std::env::var("BEE_CLAIM_ONCE").unwrap_or_default() == "1" {
                if config.wallet.lock_hash.is_empty() {
                    eprintln!("Wallet not configured. Link the wallet first.");
                    std::process::exit(1);
                }
                match crate::chain::claim_rewards_onchain(&config.wallet, &config.network).await {
                    Ok(amount) => println!("CLAIMED amount={}", amount),
                    Err(e) => {
                        eprintln!("CLAIM FAILED: {}", e);
                        std::process::exit(1);
                    }
                }
                return;
            }

            // Check if wallet is configured
            if config.wallet.lock_hash.is_empty() {
                eprintln!("Wallet not configured. Set lock_hash in config.");
                std::process::exit(1);
            }

            let window = TauriWindow;
            let mut worker = match NodeWorker::new(config, window).await {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("Failed to create node worker: {}", e);
                    std::process::exit(1);
                }
            };
            if let Err(e) = worker.start().await {
                eprintln!("Failed to start node worker: {}", e);
                eprintln!("If the wallet lock_hash does not match the stored key, re-link the wallet from the desktop app Settings page.");
                std::process::exit(1);
            }

            println!("Bee Node started in headless mode. Press Ctrl+C to stop.");
            
            tokio::signal::ctrl_c().await.expect("Failed to listen for ctrl+c");
            worker.stop().await.expect("Failed to stop node worker");
            println!("Node stopped");
        });
}