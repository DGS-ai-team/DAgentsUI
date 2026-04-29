#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn get_runtime_api_base_url() -> Option<String> {
  for key in ["DAGENTS_API_BASE_URL", "VITE_API_BASE_URL"] {
    if let Ok(value) = std::env::var(key) {
      let trimmed = value.trim();
      if !trimmed.is_empty() {
        return Some(trimmed.to_string());
      }
    }
  }
  None
}

pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
          let env_path = exe_dir.join(".env");
          let _ = dotenvy::from_path_override(env_path);
        }
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_runtime_api_base_url])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
