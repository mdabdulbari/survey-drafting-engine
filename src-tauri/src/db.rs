use crate::error::AppError;
use sqlx::SqlitePool;
use std::path::PathBuf;

pub async fn init_db() -> Result<SqlitePool, AppError> {
    let app_data = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("survey-drafting-engine");

    std::fs::create_dir_all(&app_data)?;

    let db_path = app_data.join("survey.db");
    let db_url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());

    let pool = SqlitePool::connect(&db_url).await?;
    sqlx::query(include_str!("migrations/001_init.sql"))
        .execute(&pool)
        .await?;

    Ok(pool)
}
