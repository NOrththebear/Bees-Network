use crate::config::{NodeConfig, WalletConfig};
use crate::types::{NodeStatus, TaskRequest, TaskResult, Location, NetworkStats, NodeInfo};
use crate::node::NodeWorker;
use crate::crypto::{generate_keypair, compute_lock_hash, store_private_key, load_private_key, delete_private_key};
#[cfg(feature = "tauri")]
use tauri::{Emitter, State, Window};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletApiResponse {
    pub address: String,
    pub lock_hash: String,
    pub public_key: Option<String>,
    pub has_private_key: bool,
}

pub struct WalletApi;

impl WalletApi {
    pub async fn get_wallet_status(config: &NodeConfig) -> WalletApiResponse {
        WalletApiResponse {
            address: config.wallet.address.clone(),
            lock_hash: config.wallet.lock_hash.clone(),
            public_key: config.wallet.public_key.clone(),
            has_private_key: !config.wallet.keychain_id.is_empty(),
        }
    }

#[cfg(feature = "tauri")]
    pub async fn generate_wallet(window: &Window) -> Result<WalletApiResponse, String> {
        let (priv_key, pub_key, lock_hash) = generate_keypair()
            .map_err(|e| e.to_string())?;
        
        let keychain_id = format!("bee-network-wallet-{}", uuid::Uuid::new_v4());
        store_private_key(&keychain_id, &priv_key)
            .map_err(|e| e.to_string())?;

        let address = crate::rpc::derive_ckb_address(&pub_key, "testnet")
            .await
            .map_err(|e| e.to_string())?;
        
        let config = NodeConfig::load().unwrap_or_default();
        let mut new_config = config.clone();
        new_config.wallet = WalletConfig {
            address,
            lock_hash,
            public_key: Some(pub_key),
            keychain_id,
        };
        new_config.save().await.map_err(|e| e.to_string())?;
        
        window.emit("wallet-updated", &new_config.wallet).ok();
        
        Ok(WalletApiResponse {
            address: new_config.wallet.address.clone(),
            lock_hash: new_config.wallet.lock_hash.clone(),
            public_key: new_config.wallet.public_key.clone(),
            has_private_key: true,
        })
    }

    #[cfg(feature = "tauri")]
    pub async fn import_wallet(
        window: &Window,
        private_key_hex: String,
    ) -> Result<WalletApiResponse, String> {
        let secp = secp256k1::Secp256k1::new();
        let priv_hex = private_key_hex.strip_prefix("0x").unwrap_or(&private_key_hex);
        let priv_bytes = hex::decode(priv_hex).map_err(|e| e.to_string())?;
        let secret_key = secp256k1::SecretKey::from_slice(&priv_bytes).map_err(|e| e.to_string())?;
        let public_key = secp256k1::PublicKey::from_secret_key(&secp, &secret_key);
        let pub_hex = format!("0x{}", hex::encode(public_key.serialize()));
        let computed_lock = compute_lock_hash(&pub_hex).map_err(|e| e.to_string())?;
        let address = crate::rpc::derive_ckb_address(&pub_hex, "testnet")
            .await
            .map_err(|e| e.to_string())?;
        
        let keychain_id = format!("bee-network-wallet-{}", uuid::Uuid::new_v4());
        store_private_key(&keychain_id, &private_key_hex)
            .map_err(|e| e.to_string())?;
        
        let config = NodeConfig::load().unwrap_or_default();
        let mut new_config = config.clone();
        new_config.wallet = WalletConfig {
            address,
            lock_hash: computed_lock,
            public_key: Some(pub_hex),
            keychain_id,
        };
        new_config.save().await.map_err(|e| e.to_string())?;
        
        window.emit("wallet-updated", &new_config.wallet).ok();
        
        Ok(WalletApiResponse {
            address: new_config.wallet.address.clone(),
            lock_hash: new_config.wallet.lock_hash.clone(),
            public_key: new_config.wallet.public_key.clone(),
            has_private_key: true,
        })
    }

    #[cfg(feature = "tauri")]
    pub async fn clear_wallet(window: &Window) -> Result<(), String> {
        let config = NodeConfig::load().unwrap_or_default();
        if !config.wallet.keychain_id.is_empty() {
            delete_private_key(&config.wallet.keychain_id)
                .map_err(|e| e.to_string())?;
        }
        
        let mut new_config = config.clone();
        new_config.wallet = WalletConfig::default();
        new_config.save().await.map_err(|e| e.to_string())?;
        
        window.emit("wallet-updated", &new_config.wallet).ok();
        Ok(())
    }
}

#[cfg(feature = "tauri")]
pub struct NodeApi;

#[cfg(feature = "tauri")]
impl NodeApi {
    pub async fn get_status(worker: &NodeWorker) -> NodeStatus {
        worker.get_status().await
    }

    pub async fn get_node_info(worker: &NodeWorker) -> NodeInfo {
        worker.get_info().await
    }

    pub async fn get_network_stats(worker: &NodeWorker) -> NetworkStats {
        worker.get_stats().await
    }
}