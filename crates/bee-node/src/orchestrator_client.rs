use crate::types::{TaskRequest, TaskResult, NodeInfo, Location, TaskType};
use reqwest::{Client, ClientBuilder};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
pub struct OrchestratorClient {
    config: Arc<RwLock<OrchestratorConfig>>,
    http_client: Client,
    ws_task_tx: Option<mpsc::Sender<TaskRequest>>,
    node_id: Arc<RwLock<Option<String>>>,
}

#[derive(Debug, Clone)]
pub struct OrchestratorConfig {
    pub base_url: String,
    pub ws_url: String,
    pub reconnect_interval_secs: u64,
    pub heartbeat_interval_secs: u64,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            base_url: std::env::var("ORCHESTRATOR_URL").unwrap_or_else(|_| "http://localhost:8080".to_string()),
            ws_url: std::env::var("ORCHESTRATOR_WS_URL").unwrap_or_else(|_| "ws://localhost:8080/ws".to_string()),
            reconnect_interval_secs: 10,
            heartbeat_interval_secs: 30,
        }
    }
}

impl OrchestratorClient {
    pub fn new(config: OrchestratorConfig) -> Self {
        let http_client = ClientBuilder::new()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");
        
        Self {
            config: Arc::new(RwLock::new(config)),
            http_client,
            ws_task_tx: None,
            node_id: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn register_node(&self, node_info: NodeInfo) -> Result<String, String> {
        let config = self.config.read().await;
        let url = format!("{}/nodes", config.base_url);
        
        let resp = self.http_client
            .post(&url)
            .json(&node_info)
            .send()
            .await
            .map_err(|e| format!("Failed to register node: {}", e))?;
        
        if resp.status().is_success() {
            info!("Node registered with orchestrator");
            let mut node_id_lock = self.node_id.write().await;
            *node_id_lock = Some(node_info.node_id.clone());
            Ok(node_info.node_id)
        } else {
            let err = resp.text().await.unwrap_or_default();
            Err(format!("Registration failed: {}", err))
        }
    }

    pub async fn start_task_polling(
        &self,
        task_tx: mpsc::Sender<TaskRequest>,
    ) -> Result<(), String> {
        let config = self.config.read().await.clone();
        let node_id = self.node_id.read().await.clone().ok_or("Node not registered")?;
        let http_client = self.http_client.clone();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            
            loop {
                interval.tick().await;
                
                let url = format!("{}/nodes/{}/task", config.base_url, node_id);
                match http_client.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(task) = resp.json::<TaskRequest>().await {
                            if task_tx.send(task).await.is_err() {
                                break;
                            }
                        }
                    }
                    Ok(resp) if resp.status().as_u16() == 204 => {
                        // No task available
                    }
                    Err(e) => {
                        warn!("Failed to poll task: {}", e);
                    }
                    _ => {}
                }
            }
        });
        
        Ok(())
    }

    pub async fn start_websocket(&self, task_tx: mpsc::Sender<TaskRequest>) -> Result<(), String> {
        let config = self.config.read().await.clone();
        let node_id = self.node_id.read().await.clone().ok_or("Node not registered")?;
        
        tokio::spawn(async move {
            let mut reconnect_interval = tokio::time::interval(Duration::from_secs(config.reconnect_interval_secs));
            
            loop {
                match connect_async(&config.ws_url).await {
                    Ok((ws_stream, _)) => {
                        info!("Connected to orchestrator WebSocket");
                        let (mut ws_sink, mut ws_stream) = ws_stream.split();
                        
                        // Send get_task message
                        let get_task_msg = serde_json::json!({
                            "type": "get_task",
                            "node_id": node_id
                        });
                        if ws_sink.send(Message::Text(get_task_msg.to_string())).await.is_err() {
                            error!("Failed to send get_task message");
                            continue;
                        }
                        
                        let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(config.heartbeat_interval_secs));
                        let mut get_task_interval = tokio::time::interval(Duration::from_secs(10));
                        
                        loop {
                            tokio::select! {
                                msg = ws_stream.next() => {
                                    match msg {
                                        Some(Ok(Message::Text(text))) => {
                                            if let Ok(response) = serde_json::from_str::<serde_json::Value>(&text) {
                                                // Handle task response: {"type": "task", "task": {...}}
                                                if response.get("type").and_then(|v| v.as_str()) == Some("task") {
                                                    if let Some(task_obj) = response.get("task") {
                                                        if let Ok(task) = serde_json::from_value::<TaskRequest>(task_obj.clone()) {
                                                            if task_tx.send(task).await.is_err() {
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                                // Handle nodes_update (optional)
                                                // else if response.get("type").and_then(|v| v.as_str()) == Some("nodes_update") { ... }
                                            }
                                        }
                                        Some(Ok(Message::Close(_))) => break,
                                        Some(Err(e)) => {
                                            error!("WebSocket error: {}", e);
                                            break;
                                        }
                                        None => break,
                                        _ => {}
                                    }
                                }
                                _ = heartbeat_interval.tick() => {
                                    let hb = serde_json::json!({"type": "heartbeat", "node_id": node_id});
                                    if ws_sink.send(Message::Text(hb.to_string())).await.is_err() {
                                        break;
                                    }
                                }
                                _ = get_task_interval.tick() => {
                                    let get_task_msg = serde_json::json!({
                                        "type": "get_task",
                                        "node_id": node_id
                                    });
                                    if ws_sink.send(Message::Text(get_task_msg.to_string())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to connect to orchestrator: {}", e);
                    }
                }
                
                reconnect_interval.tick().await;
                warn!("Reconnecting to orchestrator...");
            }
        });
        
        Ok(())
    }

    pub async fn submit_result(&self, result: TaskResult) -> Result<(), String> {
        let config = self.config.read().await;
        let node_id = self.node_id.read().await.clone().ok_or("Node not registered")?;
        let url = format!("{}/nodes/{}/tasks/{}/result", config.base_url, node_id, result.task_id);
        
        let resp = self.http_client
            .post(&url)
            .json(&result)
            .send()
            .await
            .map_err(|e| format!("Failed to submit result: {}", e))?;
        
        if resp.status().is_success() {
            Ok(())
        } else {
            let err = resp.text().await.unwrap_or_default();
            Err(format!("Submit result failed: {}", err))
        }
    }

    pub async fn send_heartbeat(&self, current_load: u32) -> Result<(), String> {
        let config = self.config.read().await;
        let node_id = self.node_id.read().await.clone().ok_or("Node not registered")?;
        let url = format!("{}/nodes/{}/heartbeat", config.base_url, node_id);
        
        let payload = serde_json::json!({"current_load": current_load});
        
        let resp = self.http_client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Failed to send heartbeat: {}", e))?;
        
        if resp.status().is_success() {
            Ok(())
        } else {
            let err = resp.text().await.unwrap_or_default();
            Err(format!("Heartbeat failed: {}", err))
        }
    }
}