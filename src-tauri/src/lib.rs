mod commands;
mod encoding;
mod library;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 首启时把库目录骨架建好，后续命令直接按约定路径读写。
            library::ensure_layout(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::fs::read_text_file,
            commands::fs::write_text_file,
            commands::fs::take_cli_args,
            commands::library::list_library,
            commands::library::create_doc,
            commands::library::read_doc,
            commands::library::write_doc,
            commands::library::rename_doc,
            commands::library::move_doc,
            commands::library::delete_doc,
            commands::library::create_category,
            commands::library::rename_category,
            commands::library::delete_category,
            commands::library::move_category,
            commands::library::import_files,
            commands::library::export_doc,
            commands::library::save_scratch,
            commands::library::list_scratch,
            commands::library::read_scratch,
            commands::library::drop_scratch,
            commands::library::backup_library,
            commands::library::restore_library,
            commands::library::relocate_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
