use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use dirs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConfig {
    pub network: String,
    pub install_uuid: String,
    pub wallet: WalletConfig,
    pub api_port: u16,
    pub auto_start: bool,
    pub max_concurrent_tasks: usize,
    pub request_timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfig {
    pub address: String,
    pub lock_hash: String,
    pub public_key: Option<String>,
    pub keychain_id: String,
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            network: "testnet".into(),
            install_uuid: uuid::Uuid::new_v4().to_string(),
            wallet: WalletConfig::default(),
            api_port: 8765,
            auto_start: false,
            max_concurrent_tasks: 10,
            request_timeout_secs: 30,
        }
    }
}

impl Default for WalletConfig {
    fn default() -> Self {
        Self {
            address: String::new(),
            lock_hash: String::new(),
            public_key: None,
            keychain_id: "bee-network-wallet".into(),
        }
    }
}

impl NodeConfig {
    fn config_path() -> PathBuf {
        let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("bee-network");
        path.push("config.json");
        path
    }

    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_path();
        if path.exists() {
            let content = std::fs::read_to_string(path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    pub async fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

impl WalletConfig {
    pub async fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let mut config = NodeConfig::load().unwrap_or_default();
        config.wallet = self.clone();
        config.save().await
    }
}