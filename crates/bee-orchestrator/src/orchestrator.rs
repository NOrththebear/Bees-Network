use crate::types::{TaskRequest, TaskResult, TaskType, NodeInfo, Location, BeatsReport, EpochData};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskAssignment {
    pub task_id: String,
    pub node_id: String,
    pub assigned_at: u64,
    pub deadline: u64,
    pub retry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub node_id: String,
    pub last_heartbeat: u64,
    pub is_healthy: bool,
    pub current_load: u32,
    pub max_concurrent: u32,
    pub capabilities: Vec<TaskType>,
    pub location: Location,
}

impl NodeStatus {
    pub fn is_available(&self) -> bool {
        self.is_healthy && self.current_load < self.max_concurrent
    }
}

type TaskMap = Arc<RwLock<HashMap<String, TaskRequest>>>;
type AssignmentMap = Arc<RwLock<HashMap<String, TaskAssignment>>>;
type ResultMap = Arc<RwLock<HashMap<String, TaskResult>>>;
type NodeMap = Arc<RwLock<HashMap<String, NodeStatus>>>;

pub struct TaskOrchestrator {
    tasks: TaskMap,
    task_assignments: AssignmentMap,
    task_results: ResultMap,
    nodes: NodeMap,
    task_queue: Arc<tokio::sync::Mutex<Vec<String>>>,
    config: OrchestratorConfig,
}

#[derive(Debug, Clone)]
pub struct OrchestratorConfig {
    pub max_retries: u32,
    pub task_timeout_secs: u64,
    pub heartbeat_timeout_secs: u64,
    pub min_nodes_for_task: usize,
    pub reward_per_task: u64,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            task_timeout_secs: 300,
            heartbeat_timeout_secs: 60,
            min_nodes_for_task: 1,
            reward_per_task: 10_000_000,
        }
    }
}

impl TaskOrchestrator {
    pub fn new(config: OrchestratorConfig) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            task_assignments: Arc::new(RwLock::new(HashMap::new())),
            task_results: Arc::new(RwLock::new(HashMap::new())),
            nodes: Arc::new(RwLock::new(HashMap::new())),
            task_queue: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            config,
        }
    }

    pub async fn submit_task(&self, task: TaskRequest) -> Result<String, String> {
        let task_id = task.id.clone();
        self.tasks.write().await.insert(task_id.clone(), task);
        self.task_queue.lock().await.push(task_id.clone());
        info!("Task {} submitted to queue", task_id);
        Ok(task_id)
    }

    pub async fn register_node(&self, node_info: NodeInfo) {
        let status = NodeStatus {
            node_id: node_info.node_id.clone(),
            last_heartbeat: chrono::Utc::now().timestamp_millis() as u64,
            is_healthy: true,
            current_load: 0,
            max_concurrent: 10,
            capabilities: node_info.capabilities,
            location: node_info.location,
        };
        self.nodes.write().await.insert(node_info.node_id.clone(), status);
        info!("Node {} registered", node_info.node_id);
    }

    pub async fn node_heartbeat(&self, node_id: String, current_load: u32) {
        let mut nodes = self.nodes.write().await;
        if let Some(status) = nodes.get_mut(&node_id) {
            status.last_heartbeat = chrono::Utc::now().timestamp_millis() as u64;
            status.current_load = current_load;
            status.is_healthy = true;
        }
    }

    pub async fn submit_result(&self, result: TaskResult) -> Result<(), String> {
        let task_id = result.task_id.clone();
        
        let mut assignments = self.task_assignments.write().await;
        if let Some(assignment) = assignments.get(&task_id) {
            let mut nodes = self.nodes.write().await;
            if let Some(node_status) = nodes.get_mut(&assignment.node_id) {
                node_status.current_load = node_status.current_load.saturating_sub(1);
            }
        }
        
        self.task_results.write().await.insert(task_id.clone(), result);
        assignments.remove(&task_id);
        self.tasks.write().await.remove(&task_id);
        
        info!("Task {} completed", task_id);
        Ok(())
    }

    pub async fn get_next_task(&self, node_id: &str) -> Option<TaskRequest> {
        let mut queue = self.task_queue.lock().await;
        
        while let Some(task_id) = queue.pop() {
            let task = {
                let tasks = self.tasks.read().await;
                tasks.get(&task_id).cloned()
            };
            
            if let Some(task) = task {
                let node_status = {
                    let nodes = self.nodes.read().await;
                    nodes.get(node_id).cloned()
                };
                
                if let Some(node_status) = node_status {
                    if node_status.capabilities.contains(&task.task_type) && node_status.is_available() {
                        let assignment = TaskAssignment {
                            task_id: task_id.clone(),
                            node_id: node_id.to_string(),
                            assigned_at: chrono::Utc::now().timestamp_millis() as u64,
                            deadline: task.deadline,
                            retry_count: 0,
                        };
                        self.task_assignments.write().await.insert(task_id.clone(), assignment);
                        
                        let mut nodes = self.nodes.write().await;
                        if let Some(node_status) = nodes.get_mut(node_id) {
                            node_status.current_load += 1;
                        }
                        
                        return Some(task);
                    }
                }
                queue.push(task_id);
            }
        }
        None
    }

    pub async fn check_timeouts(&self) {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        info!("check_timeouts running at {}", now);
        
        let timed_out: Vec<String> = {
            let assignments = self.task_assignments.read().await;
            assignments
                .iter()
                .filter(|(_, assignment)| now > assignment.deadline)
                .map(|(k, _)| k.clone())
                .collect()
        };
        
        info!("check_timeouts: {} timed out tasks", timed_out.len());
        
        for task_id in timed_out {
            let mut assignments = self.task_assignments.write().await;
            if let Some(assignment) = assignments.get_mut(&task_id) {
                if assignment.retry_count < self.config.max_retries {
                    assignment.retry_count += 1;
                    assignment.assigned_at = now;
                    assignment.deadline = now + self.config.task_timeout_secs * 1000;
                    
                    let task_exists = self.tasks.read().await.contains_key(&task_id);
                    if task_exists {
                        self.task_queue.lock().await.push(task_id.clone());
                        warn!("Task {} requeued (retry {})", task_id, assignment.retry_count);
                    }
                } else {
                    let error_result = TaskResult {
                        task_id: task_id.clone(),
                        success: false,
                        data: None,
                        error: Some("Task timeout after max retries".to_string()),
                        bytes_sent: 0,
                        bytes_received: 0,
                        duration_ms: 0,
                        timestamp: now,
                        signature: None,
                    };
                    self.task_results.write().await.insert(task_id.clone(), error_result);
                    assignments.remove(&task_id);
                    self.tasks.write().await.remove(&task_id);
                    error!("Task {} failed after max retries", task_id);
                }
            }
        }
        
        // Use a single write lock for stale node check to avoid deadlock
        let stale_count = {
            let mut nodes = self.nodes.write().await;
            let mut count = 0;
            for (_, status) in nodes.iter_mut() {
                if now - status.last_heartbeat > self.config.heartbeat_timeout_secs * 1000 {
                    if status.is_healthy {
                        status.is_healthy = false;
                        warn!("Node {} marked unhealthy (no heartbeat)", status.node_id);
                        count += 1;
                    }
                }
            }
            count
        };
        
        info!("check_timeouts: {} stale nodes", stale_count);
        
        info!("check_timeouts completed");
    }

    pub async fn get_task_status(&self, task_id: &str) -> Option<TaskResult> {
        self.task_results.read().await.get(task_id).cloned()
    }

    pub async fn get_available_nodes(&self) -> Vec<NodeStatus> {
        let nodes = self.nodes.read().await;
        nodes
            .values()
            .filter(|s| s.is_healthy)
            .cloned()
            .collect()
    }

    pub async fn has_task(&self, task_id: &str) -> bool {
        self.tasks.read().await.contains_key(task_id)
    }

    pub async fn start_worker(&self) {
        let orchestrator = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            loop {
                interval.tick().await;
                orchestrator.check_timeouts().await;
            }
        });
    }
}

impl Clone for TaskOrchestrator {
    fn clone(&self) -> Self {
        Self {
            tasks: self.tasks.clone(),
            task_assignments: self.task_assignments.clone(),
            task_results: self.task_results.clone(),
            nodes: self.nodes.clone(),
            task_queue: self.task_queue.clone(),
            config: self.config.clone(),
        }
    }
}