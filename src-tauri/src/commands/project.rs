use crate::error::AppError;
use crate::state::AppState;
use memmap2::Mmap;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[derive(serde::Serialize)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub laz_path: String,
    pub copc_path: String,
    pub copc_ready: bool,
    pub created_at: String,
}

#[tauri::command]
pub async fn create_project(
    state: tauri::State<'_, AppState>,
    name: String,
    laz_path: String,
) -> Result<String, AppError> {
    if !Path::new(&laz_path).exists() {
        return Err(AppError::Other(format!("File not found: {}", laz_path)));
    }

    let laz = Path::new(&laz_path);
    let stem = laz
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Other("Invalid file name".to_string()))?;
    let dir = laz
        .parent()
        .ok_or_else(|| AppError::Other("Invalid file path".to_string()))?;
    let copc_path = dir
        .join(format!("{}.copc.laz", stem))
        .to_string_lossy()
        .to_string();

    let project_id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO projects (id, name, laz_path, copc_path, copc_ready, created_at)
         VALUES (?, ?, ?, ?, 0, ?)",
    )
    .bind(&project_id)
    .bind(&name)
    .bind(&laz_path)
    .bind(&copc_path)
    .bind(&created_at)
    .execute(&state.db)
    .await?;

    Ok(project_id)
}

#[tauri::command]
pub async fn open_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<ProjectMeta, AppError> {
    use sqlx::Row;

    let row = sqlx::query(
        "SELECT id, name, laz_path, copc_path, copc_ready, created_at FROM projects WHERE id = ?",
    )
    .bind(&project_id)
    .fetch_one(&state.db)
    .await?;

    let id: String = row.try_get("id")?;
    let name: String = row.try_get("name")?;
    let laz_path: String = row.try_get("laz_path")?;
    let copc_path: String = row.try_get("copc_path")?;
    let copc_ready: i64 = row.try_get("copc_ready")?;
    let created_at: String = row.try_get("created_at")?;

    if copc_ready == 1 {
        let file = std::fs::File::open(&copc_path)
            .map_err(|e| AppError::Other(format!("Failed to open COPC file: {}", e)))?;
        let mmap = unsafe { Mmap::map(&file) }
            .map_err(|e| AppError::Other(format!("Failed to memory-map COPC file: {}", e)))?;
        state.mmaps.write().await.insert(id.clone(), Arc::new(mmap));
    }

    Ok(ProjectMeta {
        id,
        name,
        laz_path,
        copc_path,
        copc_ready: copc_ready == 1,
        created_at,
    })
}

#[tauri::command]
pub async fn list_projects(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProjectMeta>, AppError> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT id, name, laz_path, copc_path, copc_ready, created_at
         FROM projects ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    rows.into_iter()
        .map(|row| {
            let copc_ready: i64 = row.try_get("copc_ready")?;
            Ok(ProjectMeta {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                laz_path: row.try_get("laz_path")?,
                copc_path: row.try_get("copc_path")?,
                copc_ready: copc_ready == 1,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect()
}
