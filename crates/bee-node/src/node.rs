use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, mpsc};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::config::NodeConfig;
use crate::crypto::{sign_task_result, load_private_key};
use crate::orchestrator_client::{OrchestratorClient, OrchestratorConfig};

use crate::tasks::{TaskExecutor, TaskExecutorBuilder};
use crate::types::{NodeStatus, TaskRequest, TaskResult, NodeInfo, Location, NetworkStats, BeatsReport, TauriWindow};

pub struct NodeWorker {
    config: NodeConfig,
    status: Arc<RwLock<NodeStatus>>,
    stats: Arc<RwLock<NetworkStats>>,
    task_tx: Option<mpsc::Sender<TaskRequest>>,
    task_rx: Option<mpsc::Receiver<TaskRequest>>,
    result_tx: Option<mpsc::Sender<TaskResult>>,
    result_rx: Option<mpsc::Receiver<TaskResult>>,
    worker_handle: Option<JoinHandle<()>>,
    heartbeat_handle: Option<JoinHandle<()>>,
    beats_handle: Option<JoinHandle<()>>,
    orchestrator_handle: Option<JoinHandle<()>>,
    result_handle: Option<JoinHandle<()>>,
    orchestrator_client: Option<OrchestratorClient>,
    window: TauriWindow,
    start_time: Instant,
    total_beats: Arc<RwLock<u64>>,
    total_bytes: Arc<RwLock<u64>>,
}

impl NodeWorker {
    pub async fn new(config: NodeConfig, window: TauriWindow) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (task_tx, task_rx) = mpsc::channel(100);
        let (result_tx, result_rx) = mpsc::channel(100);
        
        let orchestrator_config = OrchestratorConfig::default();
        let orchestrator_client = OrchestratorClient::new(orchestrator_config);
        
        Ok(Self {
            config,
            status: Arc::new(RwLock::new(NodeStatus::Stopped)),
            stats: Arc::new(RwLock::new(NetworkStats::default())),
            task_tx: Some(task_tx),
            task_rx: Some(task_rx),
            result_tx: Some(result_tx),
            result_rx: Some(result_rx),
            worker_handle: None,
            heartbeat_handle: None,
            beats_handle: None,
            orchestrator_handle: None,
            result_handle: None,
            orchestrator_client: Some(orchestrator_client),
            window,
            start_time: Instant::now(),
            total_beats: Arc::new(RwLock::new(0)),
            total_bytes: Arc::new(RwLock::new(0)),
        })
    }

    pub async fn start(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        *self.status.write().await = NodeStatus::Starting;
        self.emit_status().await;

        // Check wallet configuration
        if self.config.wallet.lock_hash.is_empty() {
            *self.status.write().await = NodeStatus::Error("Wallet not configured".into());
            self.emit_status().await;
            return Err("Wallet not configured".into());
        }

        // Derive the node id and hand it to the orchestrator client up-front so
        // task polling can begin even if the orchestrator is briefly offline.
        let node_id = crate::node::generate_node_id(&self.config.wallet.lock_hash, &self.config.install_uuid);
        let orchestrator_client = self.orchestrator_client.take().expect("orchestrator client not available");
        orchestrator_client.set_node_id(node_id.clone()).await;

        // Register node on-chain. Best-effort: the registry entry is required
        // for rewards, but a transient indexer/RPC failure must not prevent the
        // node from running (registration retries on the next start; the op is
        // idempotent when the node already exists).
        if std::env::var("SKIP_ONCHAIN_REG").unwrap_or_default() != "1" {
            *self.status.write().await = NodeStatus::Registering;
            self.emit_status().await;
            match crate::chain::resolve_operator_key(&self.config) {
                Ok(operator_key) => {
                    if let Err(e) = crate::chain::register_node_onchain(
                        &self.config.wallet,
                        &node_id,
                        &self.config.network,
                        &operator_key,
                    )
                    .await
                    {
                        warn!("On-chain registration skipped (will retry next start): {}", e);
                    }
                }
                Err(e) => warn!("On-chain registration skipped: {}", e),
            }
        } else {
            info!("Skipping on-chain registration (SKIP_ONCHAIN_REG=1)");
        }

        // Start task executor with channel from orchestrator
        let task_rx = self.task_rx.take().expect("task_rx not available");
        let task_tx = self.task_tx.clone().expect("task_tx not available");
        let result_tx = self.result_tx.clone().expect("result_tx not available");
        
        let executor = TaskExecutorBuilder::new()
            .config(self.config.clone())
            .task_receiver(task_rx)
            .task_sender(task_tx)
            .result_sender(result_tx)
            .status(self.status.clone())
            .stats(self.stats.clone())
            .total_beats(self.total_beats.clone())
            .total_bytes(self.total_bytes.clone())
            .window(self.window.clone())
            .build();

        let worker_handle = tokio::spawn(executor.run());
        self.worker_handle = Some(worker_handle);

        // Register with the orchestrator (retrying until it answers) and then
        // stream tasks over WebSocket, falling back to HTTP polling. Doing this
        // in the background means a restart or downtime of the orchestrator can
        // never abort node startup.
        let node_info = self.get_info().await;
        let orchestrator_handle = {
            let client = orchestrator_client.clone();
            let task_tx = self.task_tx.clone().expect("task_tx not available");
            let window = self.window.clone();
            tokio::spawn(async move {
                loop {
                    match client.register_node(node_info.clone()).await {
                        Ok(_) => break,
                        Err(e) => {
                            warn!("Orchestrator registration failed, retrying in 10s: {}", e);
                            let _ = window.emit_event("node-status", &NodeStatus::Registering);
                            tokio::time::sleep(Duration::from_secs(10)).await;
                        }
                    }
                }
                if let Err(e) = client.start_websocket(task_tx.clone()).await {
                    warn!("WebSocket unavailable, falling back to HTTP polling: {}", e);
                    if let Err(e) = client.start_task_polling(task_tx).await {
                        error!("Failed to start task polling: {}", e);
                    }
                }
            })
        };
        self.orchestrator_handle = Some(orchestrator_handle);
        self.orchestrator_client = Some(orchestrator_client);

        // Start result handler to submit results to orchestrator
        let result_rx = self.result_rx.take().expect("result_rx not available");
        let orchestrator_client = self.orchestrator_client.clone().expect("orchestrator client not available");
        let result_handle = tokio::spawn(async move {
            let mut result_rx = result_rx;
            while let Some(result) = result_rx.recv().await {
                if let Err(e) = orchestrator_client.submit_result(result).await {
                    warn!("Failed to submit result to orchestrator: {}", e);
                }
            }
        });
        self.result_handle = Some(result_handle);

        // Start heartbeat to orchestrator
        let heartbeat_handle = self.start_orchestrator_heartbeat().await;
        self.heartbeat_handle = Some(heartbeat_handle);

        // Start beats reporter
        let beats_handle = self.start_beats_reporter().await;
        self.beats_handle = Some(beats_handle);

        *self.status.write().await = NodeStatus::Running;
        self.emit_status().await;

        info!("Node started successfully with orchestrator connection");
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Stopping node...");
        
        if let Some(handle) = self.worker_handle.take() {
            handle.abort();
        }
        if let Some(handle) = self.heartbeat_handle.take() {
            handle.abort();
        }
        if let Some(handle) = self.beats_handle.take() {
            handle.abort();
        }
        if let Some(handle) = self.orchestrator_handle.take() {
            handle.abort();
        }
        if let Some(handle) = self.result_handle.take() {
            handle.abort();
        }

        *self.status.write().await = NodeStatus::Stopped;
        self.emit_status().await;

        info!("Node stopped");
        Ok(())
    }

    pub async fn get_status(&self) -> NodeStatus {
        self.status.read().await.clone()
    }

    pub async fn get_info(&self) -> NodeInfo {
        let node_id = crate::node::generate_node_id(&self.config.wallet.lock_hash, &self.config.install_uuid);
        let location = self.detect_location().await;
        
        NodeInfo {
            node_id,
            location,
            capabilities: vec![
                crate::types::TaskType::HttpGet,
                crate::types::TaskType::HttpPost,
                crate::types::TaskType::DnsLookup,
                crate::types::TaskType::TlsCertificate,
            ],
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_secs: self.start_time.elapsed().as_secs(),
            total_beats: *self.total_beats.read().await,
            total_bytes: *self.total_bytes.read().await,
            current_epoch: self.get_current_epoch().await,
        }
    }

    pub async fn get_stats(&self) -> NetworkStats {
        self.stats.read().await.clone()
    }

    async fn emit_status(&self) {
        let status = self.status.read().await.clone();
        let _ = self.window.emit_event("node-status", &status);
    }

    async fn start_orchestrator_heartbeat(&self) -> JoinHandle<()> {
        let orchestrator_client = self.orchestrator_client.clone().expect("orchestrator client not available");
        let status = self.status.clone();
        let window = self.window.clone();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                
                if !matches!(*status.read().await, NodeStatus::Running) {
                    continue;
                }
                
                // Get current task load
                let current_load = 0; // Would track active tasks in real implementation
                
                if let Err(e) = orchestrator_client.send_heartbeat(current_load).await {
                    warn!("Failed to send orchestrator heartbeat: {}", e);
                }
            }
        })
    }

    async fn start_beats_reporter(&self) -> JoinHandle<()> {
        let config = self.config.clone();
        let total_beats = self.total_beats.clone();
        let total_bytes = self.total_bytes.clone();
        let status = self.status.clone();
        let window = self.window.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300)); // Every 5 minutes
            loop {
                interval.tick().await;
                
                if !matches!(*status.read().await, NodeStatus::Running) {
                    continue;
                }

                let beats = *total_beats.read().await;
                let bytes = *total_bytes.read().await;
                
                if beats > 0 || bytes > 0 {
                    // Beat/byte counters are reported to the orchestrator
                    // off-chain; on-chain settlement is coordinator-driven
                    // (epoch close + merkle reward claims), so no tx is sent here.
                    info!("Reporting beats off-chain: beats={}, bytes={}", beats, bytes);
                    *total_beats.write().await = 0;
                    *total_bytes.write().await = 0;
                }
            }
        })
    }

    async fn detect_location(&self) -> Location {
        // Try to get location from IP
        let client = reqwest::Client::new();
        if let Ok(resp) = client.get("https://ipapi.co/json/").timeout(Duration::from_secs(5)).send().await {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                return Location {
                    country: data.get("country_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    region: data.get("region").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    city: data.get("city").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    latitude: data.get("latitude").and_then(|v| v.as_f64()),
                    longitude: data.get("longitude").and_then(|v| v.as_f64()),
                    isp: data.get("org").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    asn: data.get("asn").and_then(|v| v.as_u64()).map(|n| n as u32),
                    ip: data.get("ip").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
                };
            }
        }
        
        Location {
            country: None,
            region: None,
            city: None,
            latitude: None,
            longitude: None,
            isp: None,
            asn: None,
            ip: "unknown".to_string(),
        }
    }

    async fn get_current_epoch(&self) -> u64 {
        // In a real implementation, query the epoch contract
        // For now, return a simulated epoch
        4
    }
}

pub fn generate_node_id(wallet_lock_hash: &str, install_uuid: &str) -> String {
    use ckb_hash::blake2b_256;
    let preimage = format!("{}:{}", wallet_lock_hash, install_uuid);
    let hash = blake2b_256(preimage.as_bytes());
    format!("0x{}", hex::encode(hash))
}