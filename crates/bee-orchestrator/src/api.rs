use crate::orchestrator::{TaskOrchestrator, OrchestratorConfig};
use crate::types::{TaskRequest, TaskResult, NodeInfo};
use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, error};

#[derive(Deserialize)]
struct SubmitTaskQuery {
    target: String,
    method: String,
    timeout_secs: Option<u64>,
    reward_amount: Option<u64>,
}

#[derive(Serialize)]
struct SubmitTaskResponse {
    task_id: String,
    status: String,
}

#[derive(Serialize)]
struct TaskStatusResponse {
    task_id: String,
    status: String,
    result: Option<TaskResult>,
}

async fn submit_task(
    State(orchestrator): State<Arc<TaskOrchestrator>>,
    Query(params): Query<SubmitTaskQuery>,
) -> impl IntoResponse {
    let task = TaskRequest {
        id: uuid::Uuid::new_v4().to_string(),
        task_type: match params.method.as_str() {
            "GET" => crate::types::TaskType::HttpGet,
            "POST" => crate::types::TaskType::HttpPost,
            "DNS" => crate::types::TaskType::DnsLookup,
            "TLS" => crate::types::TaskType::TlsCertificate,
            "WHOIS" => crate::types::TaskType::WhoIs,
            "TRACEROUTE" => crate::types::TaskType::Traceroute,
            _ => crate::types::TaskType::Custom(params.method),
        },
        params: serde_json::json!({
            "url": params.target,
            "timeout_secs": params.timeout_secs.unwrap_or(30)
        }),
        deadline: chrono::Utc::now().timestamp_millis() as u64 + params.timeout_secs.unwrap_or(30) * 1000,
        reward_amount: params.reward_amount.unwrap_or(10_000_000),
        requester_pubkey: "api_client".to_string(),
    };

    match orchestrator.submit_task(task).await {
        Ok(task_id) => Json(SubmitTaskResponse {
            task_id,
            status: "queued".to_string(),
        }).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

async fn get_task_status(
    State(orchestrator): State<Arc<TaskOrchestrator>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    if let Some(result) = orchestrator.get_task_status(&task_id).await {
        Json(TaskStatusResponse {
            task_id: task_id.clone(),
            status: if result.success { "completed" } else { "failed" }.to_string(),
            result: Some(result),
        }).into_response()
    } else if orchestrator.has_task(&task_id).await {
        Json(TaskStatusResponse {
            task_id,
            status: "pending".to_string(),
            result: None,
        }).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Task not found"}))).into_response()
    }
}

async fn register_node(
    State(orchestrator): State<Arc<TaskOrchestrator>>,
    Json(node_info): Json<NodeInfo>,
) -> impl IntoResponse {
    orchestrator.register_node(node_info).await;
    Json(serde_json::json!({"status": "registered"})).into_response()
}

async fn node_heartbeat(
    State(orchestrator): State<Arc<TaskOrchestrator>>,
    Path(node_id): Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let current_load = payload.get("current_load").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    orchestrator.node_heartbeat(node_id, current_load).await;
    Json(serde_json::json!({"status": "ok"})).into_response()
}

async fn submit_task_result(
    State(orchestrator): State<Arc<TaskOrchestrator>>,
    Path((node_id, task_id)): Path<(String, String)>,
    Json(result): Json<TaskResult>,
) -> impl IntoResponse {
    match orchestrator.submit_result(result).await {
        Ok(()) => Json(serde_json::json!({"status": "ok"})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

async fn get_available_nodes(
    State(orchestrator): State<Arc<TaskOrchestrator>>,
) -> impl IntoResponse {
    let nodes = orchestrator.get_available_nodes().await;
    Json(serde_json::json!({"nodes": nodes})).into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(orchestrator): State<Arc<TaskOrchestrator>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, orchestrator))
}

async fn handle_ws(mut socket: axum::extract::ws::WebSocket, orchestrator: Arc<TaskOrchestrator>) {
    use axum::extract::ws::{Message, WebSocket};
    use futures_util::{SinkExt, StreamExt};
    
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
    
    loop {
        tokio::select! {
            _ = interval.tick() => {
                let nodes = orchestrator.get_available_nodes().await;
                let msg = serde_json::json!({
                    "type": "nodes_update",
                    "nodes": nodes
                });
                if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(req) = serde_json::from_str::<serde_json::Value>(&text) {
                            if req.get("type").and_then(|v| v.as_str()) == Some("get_task") {
                                let node_id = req.get("node_id").and_then(|v| v.as_str()).unwrap_or("unknown");
                                if let Some(task) = orchestrator.get_next_task(node_id).await {
                                    let response = serde_json::json!({
                                        "type": "task",
                                        "task": task
                                    });
                                    if socket.send(Message::Text(response.to_string().into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Err(_)) => break,
                    None => break,
                    _ => {}
                }
            }
        }
    }
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({"status": "healthy"})).into_response()
}

pub async fn start_server(config: OrchestratorConfig, addr: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let orchestrator = Arc::new(TaskOrchestrator::new(config));
    orchestrator.start_worker().await;
    
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/tasks", post(submit_task))
        .route("/tasks/{id}", get(get_task_status))
        .route("/nodes", post(register_node))
        .route("/nodes/{id}/heartbeat", post(node_heartbeat))
        .route("/nodes/{node_id}/tasks/{task_id}/result", post(submit_task_result))
        .route("/nodes", get(get_available_nodes))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .with_state(orchestrator);
    
    let listener = TcpListener::bind(addr).await?;
    info!("Orchestrator API server listening on {}", addr);
    axum::serve(listener, app).await?;
    
    Ok(())
}