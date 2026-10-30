use std::path::PathBuf;

use crate::encoding::{self, FileDoc};

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

/// 启动参数里第一个存在的文件会由前端拿去当临时文档打开。
#[tauri::command]
pub fn take_cli_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}
