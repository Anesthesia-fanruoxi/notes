mod ai;
mod commands;
mod encoding;
mod library;
mod usage;

use std::path::Path;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// 记住窗口尺寸/位置/最大化，但不记 VISIBLE（关闭到托盘时会隐藏）。
const STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::DECORATIONS)
    .union(StateFlags::FULLSCREEN);

/// 窗口尺寸/位置随改随存（防抖 500ms），这样即使进程被强杀也能恢复上次大小。
fn setup_window_state_persist(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // 拖动窗口会连着来一串事件：等安静 500ms 再落盘。
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let mut more = false;
                while rx.try_recv().is_ok() {
                    more = true;
                }
                if !more {
                    break;
                }
            }
            let _ = app.save_window_state(STATE_FLAGS);
        }
    });

    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::CloseRequested { .. }
        ) {
            let _ = tx.send(());
        }
    });
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn collect_file_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
        .collect()
}

fn toggle_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let minimized = window.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = window.hide();
        } else {
            focus_main(app);
        }
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let new_doc = MenuItem::with_id(app, "new", "新建文档", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_doc, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main(app),
            "new" => {
                focus_main(app);
                let _ = app.emit("app://new-doc", ());
            }
            "quit" => {
                focus_main(app);
                let _ = app.emit("app://quit", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// 前端确认完未保存修改后调用；托盘退出也走同一条确认链。
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例必须最先注册：二启时转发文件参数并聚焦已有窗口。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            focus_main(app);
            let paths = collect_file_args(argv);
            if !paths.is_empty() {
                let _ = app.emit("cli://open", paths);
            }
        }))
        // 不记忆 VISIBLE：关闭到托盘时窗口是隐藏的，记下来会导致下次启动看不见。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(STATE_FLAGS)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 首启时把库目录骨架建好，后续命令直接按约定路径读写。
            library::ensure_layout(app.handle()).map_err(std::io::Error::other)?;
            usage::prune(app.handle());
            setup_tray(app)?;
            setup_window_state_persist(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::fs::read_text_file,
            commands::fs::write_text_file,
            commands::fs::file_mtime,
            commands::fs::take_cli_args,
            commands::library::list_library,
            commands::library::create_doc,
            commands::library::read_doc,
            commands::library::write_doc,
            commands::library::rename_doc,
            commands::library::move_doc,
            commands::library::delete_doc,
            commands::library::set_ai_readable,
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
            commands::library::save_recovery,
            commands::library::list_recovery,
            commands::library::read_recovery,
            commands::library::drop_recovery,
            commands::library::create_version,
            commands::library::list_versions,
            commands::library::read_version,
            commands::library::restore_version,
            commands::library::load_chat,
            commands::library::append_chat,
            commands::library::clear_chat,
            commands::library::backup_library,
            commands::library::restore_library,
            commands::library::relocate_library,
            ai::set_secret,
            ai::get_secret_status,
            ai::clear_secret,
            ai::ai_chat,
            ai::ai_abort,
            ai::ai_test_connection,
            ai::ai_list_models,
            usage::ai_usage_scan,
            usage::ai_usage_records,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
