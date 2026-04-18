mod commands;
mod db;
mod error;
mod state;
mod tools;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = tauri::async_runtime::block_on(db::init_db())
                .expect("Failed to initialize database");
            app.manage(AppState {
                db,
                mmaps: tokio::sync::RwLock::new(std::collections::HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::open_project,
            commands::project::list_projects,
            commands::conversion::convert_to_copc,
            commands::ipc::read_copc_range,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
