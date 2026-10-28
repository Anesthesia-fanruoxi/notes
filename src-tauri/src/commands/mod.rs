pub mod fs;
pub mod library;

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}
