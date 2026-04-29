use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn get_runtime_api_base_url() -> Option<String> {
  for key in ["VITE_API_BASE_URL"] {
    if let Ok(value) = std::env::var(key) {
      let trimmed = value.trim();
      if !trimmed.is_empty() {
        return Some(trimmed.to_string());
      }
    }
  }
  None
}

fn generate_client_id() -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  format!("client-{nanos}-{}", std::process::id())
}

fn is_valid_client_id(value: &str) -> bool {
  let len = value.len();
  if !(8..=128).contains(&len) {
    return false;
  }
  value
    .chars()
    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

#[tauri::command]
fn get_or_create_client_id(app: tauri::AppHandle) -> Result<String, String> {
  let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
  let client_id_path = app_data_dir.join("client_id");

  if client_id_path.exists() {
    let existing = fs::read(&client_id_path).map_err(|e| e.to_string())?;
    let trimmed = String::from_utf8_lossy(&existing).trim().to_string();
    if is_valid_client_id(&trimmed) {
      return Ok(trimmed);
    } else {
      // file exists but content is invalid; regenerate
    }
  } else {
    // file does not exist yet
  }

  let client_id = generate_client_id();
  fs::write(&client_id_path, &client_id).map_err(|e| e.to_string())?;
  Ok(client_id)
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
    .invoke_handler(tauri::generate_handler![get_runtime_api_base_url, get_or_create_client_id])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
