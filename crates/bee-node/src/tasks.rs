use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinSet;
use tracing::{debug, error, info, warn};

use crate::config::NodeConfig;
use crate::crypto::{sign_task_result, load_private_key};
use crate::types::{TaskRequest, TaskResult, TaskType, NetworkStats, NodeStatus, TauriWindow};

pub struct TaskExecutor {
    config: NodeConfig,
    task_rx: mpsc::Receiver<TaskRequest>,
    task_tx: mpsc::Sender<TaskRequest>,
    result_tx: mpsc::Sender<TaskResult>,
    status: Arc<RwLock<NodeStatus>>,
    stats: Arc<RwLock<NetworkStats>>,
    total_beats: Arc<RwLock<u64>>,
    total_bytes: Arc<RwLock<u64>>,
    window: TauriWindow,
    active_tasks: Arc<RwLock<JoinSet<()>>>,
}

pub struct TaskExecutorBuilder {
    config: Option<NodeConfig>,
    task_receiver: Option<mpsc::Receiver<TaskRequest>>,
    task_sender: Option<mpsc::Sender<TaskRequest>>,
    result_sender: Option<mpsc::Sender<TaskResult>>,
    status: Option<Arc<RwLock<NodeStatus>>>,
    stats: Option<Arc<RwLock<NetworkStats>>>,
    total_beats: Option<Arc<RwLock<u64>>>,
    total_bytes: Option<Arc<RwLock<u64>>>,
    window: Option<TauriWindow>,
}

impl TaskExecutorBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn config(mut self, config: NodeConfig) -> Self {
        self.config = Some(config);
        self
    }

    pub fn task_receiver(mut self, rx: mpsc::Receiver<TaskRequest>) -> Self {
        self.task_receiver = Some(rx);
        self
    }

    pub fn task_sender(mut self, tx: mpsc::Sender<TaskRequest>) -> Self {
        self.task_sender = Some(tx);
        self
    }

    pub fn status(mut self, status: Arc<RwLock<NodeStatus>>) -> Self {
        self.status = Some(status);
        self
    }

    pub fn stats(mut self, stats: Arc<RwLock<NetworkStats>>) -> Self {
        self.stats = Some(stats);
        self
    }

    pub fn total_beats(mut self, beats: Arc<RwLock<u64>>) -> Self {
        self.total_beats = Some(beats);
        self
    }

    pub fn total_bytes(mut self, bytes: Arc<RwLock<u64>>) -> Self {
        self.total_bytes = Some(bytes);
        self
    }

    pub fn window(mut self, window: TauriWindow) -> Self {
        self.window = Some(window);
        self
    }

    pub fn result_sender(mut self, tx: mpsc::Sender<TaskResult>) -> Self {
        self.result_sender = Some(tx);
        self
    }

    pub fn build(self) -> TaskExecutor {
        TaskExecutor {
            config: self.config.expect("config required"),
            task_rx: self.task_receiver.expect("task_receiver required"),
            task_tx: self.task_sender.expect("task_sender required"),
            result_tx: self.result_sender.expect("result_sender required"),
            status: self.status.expect("status required"),
            stats: self.stats.expect("stats required"),
            total_beats: self.total_beats.expect("total_beats required"),
            total_bytes: self.total_bytes.expect("total_bytes required"),
            window: self.window.expect("window required"),
            active_tasks: Arc::new(RwLock::new(JoinSet::new())),
        }
    }
}

impl Default for TaskExecutorBuilder {
    fn default() -> Self {
        Self {
            config: None,
            task_receiver: None,
            task_sender: None,
            result_sender: None,
            status: None,
            stats: None,
            total_beats: None,
            total_bytes: None,
            window: None,
        }
    }
}

impl TaskExecutor {
    pub async fn run(mut self) {
        info!("Task executor started");
        
        loop {
            tokio::select! {
                Some(task) = self.task_rx.recv() => {
                    if !matches!(*self.status.read().await, NodeStatus::Running) {
                        warn!("Received task but node not running, dropping");
                        continue;
                    }
                    
                    let max_concurrent = self.config.max_concurrent_tasks;
                    let active = self.active_tasks.read().await.len();
                    
                    if active >= max_concurrent {
                        warn!("Max concurrent tasks reached ({}), queuing", max_concurrent);
                        // Re-queue task
                        let _ = self.task_tx.send(task).await;
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    
                    self.spawn_task(task).await;
                }
                else => {
                    info!("Task channel closed, executor stopping");
                    break;
                }
            }
            
            // Clean up completed tasks
            self.cleanup_tasks().await;
        }
        
        // Wait for all active tasks to complete
        while let Some(res) = self.active_tasks.write().await.join_next().await {
            if let Err(e) = res {
                error!("Task panicked: {}", e);
            }
        }
        
        info!("Task executor stopped");
    }

    async fn spawn_task(&self, task: TaskRequest) {
        let config = self.config.clone();
        let status = self.status.clone();
        let stats = self.stats.clone();
        let total_beats = self.total_beats.clone();
        let total_bytes = self.total_bytes.clone();
        let window = self.window.clone();
        let result_tx = self.result_tx.clone();
        
        self.active_tasks.write().await.spawn(async move {
            let result = execute_task(config.clone(), task).await;
            
            // Update stats
            {
                let mut stats = stats.write().await;
                if result.success {
                    stats.completed_tasks += 1;
                    stats.total_earned += result.data.as_ref()
                        .and_then(|d| d.get("reward").and_then(|r| r.as_u64()))
                        .unwrap_or(0);
                } else {
                    stats.failed_tasks += 1;
                }
            }
            
            // Update beats/bytes
            *total_beats.write().await += 1;
            *total_bytes.write().await += result.bytes_sent + result.bytes_received;
            
            // Sign result
            let signed_result = if let Ok(priv_key) = load_private_key(&config.wallet.keychain_id) {
                sign_task_result(&config.wallet, &result).await.unwrap_or(result)
            } else {
                result
            };
            
            // Send result to orchestrator
            let _ = result_tx.send(signed_result.clone()).await;
            
            // Emit result
            let _ = window.emit_event("task-result", &signed_result);
        });
    }

    async fn cleanup_tasks(&self) {
        let mut tasks = self.active_tasks.write().await;
        while let Some(res) = tasks.try_join_next() {
            match res {
                Ok(_) => {}
                Err(e) => error!("Task join error: {}", e),
            }
        }
    }
}

async fn execute_task(config: NodeConfig, task: TaskRequest) -> TaskResult {
    let start = Instant::now();
    let mut bytes_sent = 0u64;
    let mut bytes_received = 0u64;
    let task_id = task.id.clone();
    
    let result = match task.task_type {
        TaskType::HttpGet => execute_http_get(&config, &task).await,
        TaskType::HttpPost => execute_http_post(&config, &task).await,
        TaskType::DnsLookup => execute_dns_lookup(&task).await,
        TaskType::TlsCertificate => execute_tls_cert(&task).await,
        TaskType::WhoIs => execute_whois(&task).await,
        TaskType::Traceroute => execute_traceroute(&task).await,
        TaskType::Custom(ref cmd) => execute_custom(&task, cmd).await,
    };
    
    let duration_ms = start.elapsed().as_millis() as u64;
    
    match result {
        Ok((data, sent, recv)) => {
            bytes_sent = sent;
            bytes_received = recv;
            TaskResult {
                task_id,
                success: true,
                data: Some(data),
                error: None,
                bytes_sent,
                bytes_received,
                duration_ms,
                timestamp: chrono::Utc::now().timestamp_millis() as u64,
                signature: None,
            }
        }
        Err(e) => {
            TaskResult {
                task_id,
                success: false,
                data: None,
                error: Some(e.to_string()),
                bytes_sent,
                bytes_received,
                duration_ms,
                timestamp: chrono::Utc::now().timestamp_millis() as u64,
                signature: None,
            }
        }
    }
}

async fn execute_http_get(config: &NodeConfig, task: &TaskRequest) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(task.params.get("timeout_secs").and_then(|v| v.as_u64()).unwrap_or(config.request_timeout_secs)))
        .build()?;
    
    let url = task.params.get("url").and_then(|v| v.as_str()).ok_or("Missing url")?;
    let headers = task.params.get("headers").and_then(|v| v.as_object());
    
    let mut req = client.get(url);
    
    if let Some(h) = headers {
        for (k, v) in h {
            if let Some(v_str) = v.as_str() {
                req = req.header(k, v_str);
            }
        }
    }
    
    let resp = req.send().await?;
    let bytes_received = resp.content_length().unwrap_or(0);
    let body = resp.text().await?;
    let bytes_sent = url.len() as u64;
    
    Ok((serde_json::json!({"body": body, "status": 200}), bytes_sent, bytes_received))
}

async fn execute_http_post(config: &NodeConfig, task: &TaskRequest) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(task.params.get("timeout_secs").and_then(|v| v.as_u64()).unwrap_or(config.request_timeout_secs)))
        .build()?;
    
    let url = task.params.get("url").and_then(|v| v.as_str()).ok_or("Missing url")?;
    let body = task.params.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let headers = task.params.get("headers").and_then(|v| v.as_object());
    
    let mut req = client.post(url).body(body.to_string());
    
    if let Some(h) = headers {
        for (k, v) in h {
            if let Some(v_str) = v.as_str() {
                req = req.header(k, v_str);
            }
        }
    }
    
    let resp = req.send().await?;
    let bytes_received = resp.content_length().unwrap_or(0);
    let resp_body = resp.text().await?;
    let bytes_sent = body.len() as u64 + url.len() as u64;
    
    Ok((serde_json::json!({"body": resp_body, "status": 200}), bytes_sent, bytes_received))
}

async fn execute_dns_lookup(task: &TaskRequest) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    use trust_dns_resolver::TokioAsyncResolver;
    use trust_dns_resolver::config::{ResolverConfig, ResolverOpts};
    
    let domain = task.params.get("domain").and_then(|v| v.as_str()).ok_or("Missing domain")?;
    let resolver = TokioAsyncResolver::tokio(ResolverConfig::default(), ResolverOpts::default());
    let response = resolver.lookup_ip(domain).await?;
    
    let ips: Vec<String> = response.iter().map(|ip| ip.to_string()).collect();
    let data = serde_json::json!({"domain": domain, "ips": ips});
    
    Ok((data, domain.len() as u64, 100))
}

async fn execute_tls_cert(task: &TaskRequest) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync + '_>> {
    let host = task.params.get("host")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or("Missing host".to_string())?;
    let port = task.params.get("port").and_then(|v| v.as_u64()).unwrap_or(443);
    
    let addr = format!("{}:{}", host, port);
    let tcp_stream = tokio::net::TcpStream::connect(&addr).await?;
    let client_config = std::sync::Arc::new(rustls::ClientConfig::builder()
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth());
    
    let connector = tokio_rustls::TlsConnector::from(client_config);
    let domain = host.clone().try_into()?;
    let _tls_stream = connector.connect(domain, tcp_stream).await?;
    
    // Handshake is done during connect
    // let _ = tls_stream.get_ref().1.peer_certificates();
    
    let data = serde_json::json!({
        "host": host, 
        "certificates": "certificate parsing requires x509-parser crate"
    });
    Ok((data, host.len() as u64, 500))
}

async fn execute_whois(task: &TaskRequest) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let domain = task.params.get("domain").and_then(|v| v.as_str()).ok_or("Missing domain")?;
    
    // Simplified whois - in production use a proper whois library
    let output = tokio::process::Command::new("whois")
        .arg(domain)
        .output()
        .await?;
    
    let data = serde_json::json!({
        "domain": domain,
        "raw": String::from_utf8_lossy(&output.stdout)
    });
    
    Ok((data, domain.len() as u64, output.stdout.len() as u64))
}

async fn execute_traceroute(task: &TaskRequest) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let target = task.params.get("target").and_then(|v| v.as_str()).ok_or("Missing target")?;
    
    let output = tokio::process::Command::new("traceroute")
        .arg("-n")
        .arg(target)
        .output()
        .await?;
    
    let hops: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect();
    
    let data = serde_json::json!({"target": target, "hops": hops});
    Ok((data, target.len() as u64, output.stdout.len() as u64))
}

async fn execute_custom(task: &TaskRequest, cmd: &str) -> Result<(serde_json::Value, u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let output = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .output()
        .await?;
    
    let data = serde_json::json!({
        "command": cmd,
        "stdout": String::from_utf8_lossy(&output.stdout),
        "stderr": String::from_utf8_lossy(&output.stderr),
        "exit_code": output.status.code(),
    });
    
    Ok((data, cmd.len() as u64, output.stdout.len() as u64))
}