use memmap2::Mmap;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub db: SqlitePool,
    pub mmaps: RwLock<HashMap<String, Arc<Mmap>>>,
}
