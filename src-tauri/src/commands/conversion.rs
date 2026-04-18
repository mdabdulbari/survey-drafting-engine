//! `convert_to_copc` Tauri command.
//!
//! Orchestrates the three-layer pipeline:
//!
//!   1. [`emitter`]  — typed Tauri event emission for this job.
//!   2. [`watcher`]  — filesystem-based two-phase progress tracking.
//!   3. This module  — process lifecycle, DB update, command entry-point.

mod emitter;
mod watcher;

use crate::error::AppError;
use crate::state::AppState;
use crate::tools;
use emitter::ConversionEmitter;
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};

// ── Command ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn convert_to_copc(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<(), AppError> {
    use sqlx::Row;

    let row = sqlx::query(
        "SELECT laz_path, copc_path, copc_ready FROM projects WHERE id = ?",
    )
    .bind(&project_id)
    .fetch_one(&state.db)
    .await?;

    let laz_path: String = row.try_get("laz_path")?;
    let copc_path: String = row.try_get("copc_path")?;
    let copc_ready: bool = row.try_get::<i64, _>("copc_ready")? == 1;

    let emitter = ConversionEmitter::new(app.clone(), &project_id);

    if copc_ready && Path::new(&copc_path).exists() {
        emitter.log("File already converted, skipping.");
        emitter.done();
        return Ok(());
    }

    let exe = tools::find_pdal().ok_or_else(|| {
        AppError::Other(
            "pdal not found. Install it via Conda:\n  conda install -c conda-forge pdal".into(),
        )
    })?;

    emitter.log(format!("Using pdal:  {}", exe.display()));
    emitter.log(format!("Input:  {}", laz_path));
    emitter.log(format!("Output: {}", copc_path));
    emitter.log("Running pdal translate…");

    let mut child = tokio::process::Command::new(&exe)
        .args([
            "translate",
            "-i", &laz_path,
            "-o", &copc_path,
            "-w", "writers.copc", // explicit: some builds don't infer from .copc.laz
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to start pdal: {}", e)))?;

    // Both streams forwarded — PDAL writes diagnostic output to either.
    forward_stream(child.stdout.take(), emitter.clone());
    forward_stream(child.stderr.take(), emitter.clone());

    let watcher = tokio::spawn(watcher::run(
        emitter.clone(),
        laz_path.clone().into(),
        copc_path.clone().into(),
    ));

    let status = child.wait().await?;
    watcher.abort();

    if status.success() {
        emitter.phase_percent(1, 100.0);
        emitter.phase_percent(2, 100.0);
        emitter.log("pdal translate finished successfully.");
        sqlx::query("UPDATE projects SET copc_ready = 1 WHERE id = ?")
            .bind(&project_id)
            .execute(&state.db)
            .await?;
        emitter.done();
    } else {
        emitter.error(format!("pdal exited with {}", status));
    }

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Spawn a task that reads lines from `stream` and forwards each one to the
/// emitter log.  Consumes `stream` so the caller doesn't need to drain it.
fn forward_stream<R>(stream: Option<R>, emitter: ConversionEmitter)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let Some(r) = stream else { return };
    tokio::spawn(async move {
        let mut lines = BufReader::new(r).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emitter.log(line);
        }
    });
}
