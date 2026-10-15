mod api;
mod orchestrator;
mod types;

use crate::orchestrator::OrchestratorConfig;
use std::panic;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    // Set up panic hook
    panic::set_hook(Box::new(|panic_info| {
        eprintln!("PANIC: {:?}", panic_info);
        if let Some(location) = panic_info.location() {
            eprintln!("Location: {}:{}:{}", location.file(), location.line(), location.column());
        }
    }));

    let config = OrchestratorConfig::default();
    let addr = std::env::var("ORCHESTRATOR_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());

    api::start_server(config, &addr).await
}