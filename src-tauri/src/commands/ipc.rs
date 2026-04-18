use crate::error::AppError;
use crate::state::AppState;

/// Read a contiguous byte range from the memory-mapped COPC file.
///
/// Returns raw bytes as `tauri::ipc::Response` — no JSON encoding, no base64.
/// On the JS side, `invoke<ArrayBuffer>('read_copc_range', {...})` returns an `ArrayBuffer`.
#[tauri::command]
pub async fn read_copc_range(
    state: tauri::State<'_, AppState>,
    project_id: String,
    offset: u64,
    len: u64,
) -> Result<tauri::ipc::Response, AppError> {
    // Clone the Arc so we release the read lock before the (potentially large) copy.
    let mmap = {
        let mmaps = state.mmaps.read().await;
        mmaps
            .get(&project_id)
            .cloned()
            .ok_or_else(|| AppError::Other(format!("No mmap for project '{}'", project_id)))?
    };

    let start = offset as usize;
    let end = offset
        .checked_add(len)
        .ok_or_else(|| AppError::Other("Integer overflow in range calculation".to_string()))?
        as usize;

    if end > mmap.len() {
        return Err(AppError::Other(format!(
            "Range out of bounds: requested [{}..{}], file is {} bytes",
            start,
            end,
            mmap.len()
        )));
    }

    Ok(tauri::ipc::Response::new(mmap[start..end].to_vec()))
}
