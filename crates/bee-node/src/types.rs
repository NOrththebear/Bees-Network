use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(feature = "tauri")]
use tauri::{Emitter, WebviewWindow};

#[cfg(not(feature = "tauri"))]
#[derive(Clone)]
pub struct TauriWindow;

#[cfg(not(feature = "tauri"))]
impl TauriWindow {
    pub fn emit_event<T: serde::Serialize>(&self, _event: &str, _payload: &T) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(feature = "tauri")]
#[derive(Clone)]
pub struct TauriWindow(pub WebviewWindow);

#[cfg(feature = "tauri")]
impl TauriWindow {
    pub fn emit_event<T: serde::Serialize>(&self, event: &str, payload: &T) -> Result<(), String> {
        tauri::Emitter::emit(&self.0, event, payload).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpochData {
    pub epoch_id: u64,
    pub registry_id: String,
    pub merkle_root: String,
    pub evidence_hash: String,
    pub pool: u64,
    pub rewards_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Stopped,
    Starting,
    Running,
    Registering,
    Error(String),
}

impl Default for NodeStatus {
    fn default() -> Self {
        Self::Stopped
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRequest {
    pub id: String,
    pub task_type: TaskType,
    pub params: serde_json::Value,
    pub deadline: u64,
    pub reward_amount: u64,
    pub requester_pubkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    HttpGet,
    HttpPost,
    DnsLookup,
    TlsCertificate,
    WhoIs,
    Traceroute,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub duration_ms: u64,
    pub timestamp: u64,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub node_id: String,
    pub location: Location,
    pub capabilities: Vec<TaskType>,
    pub version: String,
    pub uptime_secs: u64,
    pub total_beats: u64,
    pub total_bytes: u64,
    pub current_epoch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Location {
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub isp: Option<String>,
    pub asn: Option<u32>,
    pub ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStats {
    pub connected_peers: usize,
    pub pending_tasks: usize,
    pub completed_tasks: u64,
    pub failed_tasks: u64,
    pub total_earned: u64,
    pub current_epoch_rewards: u64,
}

impl Default for NetworkStats {
    fn default() -> Self {
        Self {
            connected_peers: 0,
            pending_tasks: 0,
            completed_tasks: 0,
            failed_tasks: 0,
            total_earned: 0,
            current_epoch_rewards: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeatsReport {
    pub node_id: String,
    pub epoch: u64,
    pub beats: u64,
    pub bytes: u64,
    pub timestamp: u64,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservationRequest {
    pub id: String,
    pub target: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_secs: u64,
    pub follow_redirects: bool,
    pub max_response_size: usize,
}