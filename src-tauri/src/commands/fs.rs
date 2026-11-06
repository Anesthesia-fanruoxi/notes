use std::path::PathBuf;

use crate::encoding::{self, FileDoc};
use crate::large_file;

#[tauri::command]
pub fn read_text_file(path: String, max_bytes: Option<u64>) -> Result<FileDoc, String> {
    encoding::read(&PathBuf::from(path), max_bytes)
}

#[tauri::command]
pub fn write_text_file(
    path: String,
    content: String,
    encoding: String,
    has_bom: bool,
    line_ending: String,
) -> Result<(), String> {
    encoding::write(
        &PathBuf::from(path),
        &content,
        &encoding,
        has_bom,
        &line_ending,
    )
}

/// 文件最后修改时间（毫秒），文件不存在时返回 None。
#[tauri::command]
pub fn file_mtime(path: String) -> Result<Option<u64>, String> {
    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(_) => return Ok(None),
    };
    Ok(meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|gap| gap.as_millis() as u64))
}

/// 打开前先看大小，决定走编辑器还是只读查看器。
#[tauri::command]
pub fn file_info(path: String) -> Result<large_file::FileInfo, String> {
    large_file::file_info(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn large_file_open(path: String) -> Result<large_file::LargeFileMeta, String> {
    tauri::async_runtime::spawn_blocking(move || large_file::open(std::path::Path::new(&path)))
        .await
        .map_err(|e| format!("大文件任务失败：{e}"))?
}

#[tauri::command]
pub async fn large_file_lines(
    path: String,
    start_line: u64,
    count: u64,
) -> Result<large_file::LargeFileWindow, String> {
    tauri::async_runtime::spawn_blocking(move || {
        large_file::lines(std::path::Path::new(&path), start_line, count)
    })
    .await
    .map_err(|e| format!("大文件任务失败：{e}"))?
}

/// 启动参数里第一个存在的文件会由前端拿去当临时文档打开。
#[tauri::command]
pub fn take_cli_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}
