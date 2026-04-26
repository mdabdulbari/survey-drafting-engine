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
    /// File-system status of source LAZ + COPC artifact, computed on every
    /// `list_projects` / `open_project`. Frontend uses this to render
    /// "Ready" / "Needs conversion" / "File missing" pills.
    pub laz_exists: bool,
    pub copc_exists: bool,
    pub laz_size: Option<u64>,
}

fn stat_paths(laz_path: &str, copc_path: &str) -> (bool, bool, Option<u64>) {
    let laz_meta = std::fs::metadata(laz_path).ok();
    let copc_exists = std::fs::metadata(copc_path).is_ok();
    let laz_exists = laz_meta.is_some();
    let laz_size = laz_meta.map(|m| m.len());
    (laz_exists, copc_exists, laz_size)
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

    let (laz_exists, copc_exists, laz_size) = stat_paths(&laz_path, &copc_path);

    Ok(ProjectMeta {
        id,
        name,
        laz_path,
        copc_path,
        copc_ready: copc_ready == 1,
        created_at,
        laz_exists,
        copc_exists,
        laz_size,
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
            let laz_path: String = row.try_get("laz_path")?;
            let copc_path: String = row.try_get("copc_path")?;
            let (laz_exists, copc_exists, laz_size) = stat_paths(&laz_path, &copc_path);
            Ok(ProjectMeta {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                laz_path,
                copc_path,
                copc_ready: copc_ready == 1,
                created_at: row.try_get("created_at")?,
                laz_exists,
                copc_exists,
                laz_size,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn delete_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    delete_copc_file: bool,
) -> Result<(), AppError> {
    use sqlx::Row;

    let row = sqlx::query("SELECT copc_path FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.db)
        .await?;

    state.mmaps.write().await.remove(&project_id);

    if let Some(row) = row {
        let copc_path: String = row.try_get("copc_path")?;
        if delete_copc_file && Path::new(&copc_path).exists() {
            let _ = std::fs::remove_file(&copc_path);
        }
    }

    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&project_id)
        .execute(&state.db)
        .await?;

    Ok(())
}

#[tauri::command]
pub async fn reveal_in_folder(path: String) -> Result<(), AppError> {
    let p = Path::new(&path);
    let target = if p.exists() {
        p.to_path_buf()
    } else {
        p.parent()
            .ok_or_else(|| AppError::Other(format!("Path has no parent: {}", path)))?
            .to_path_buf()
    };

    #[cfg(target_os = "windows")]
    {
        if p.exists() {
            std::process::Command::new("explorer")
                .args(["/select,", &path])
                .spawn()
                .map_err(|e| AppError::Other(format!("explorer failed: {}", e)))?;
        } else {
            std::process::Command::new("explorer")
                .arg(target.as_os_str())
                .spawn()
                .map_err(|e| AppError::Other(format!("explorer failed: {}", e)))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if p.exists() {
            cmd.arg("-R").arg(&path);
        } else {
            cmd.arg(target.as_os_str());
        }
        cmd.spawn()
            .map_err(|e| AppError::Other(format!("open failed: {}", e)))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {}", e)))?;
    }

    Ok(())
}
