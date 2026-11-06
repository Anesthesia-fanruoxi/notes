//! 大文件只读模式：Rust 侧建立行索引，前端按行窗口取文本。
//! 正文永远不整篇进入 WebView，滚动和跳转只读取当前窗口。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use encoding_rs::{Encoding, GB18030, UTF_8};
use serde::Serialize;

const SAMPLE_BYTES: u64 = 64 * 1024;
const SCAN_CHUNK: usize = 1024 * 1024;
const MAX_WINDOW_BYTES: u64 = 4 * 1024 * 1024;
const MAX_WINDOW_LINES: u64 = 2000;
const MAX_CACHED_FILES: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub size_bytes: u64,
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileMeta {
    pub size_bytes: u64,
    pub line_count: u64,
    pub encoding: String,
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileWindow {
    pub start_line: u64,
    pub lines: Vec<String>,
    pub total_lines: u64,
}

struct IndexedFile {
    size: u64,
    mtime: u64,
    encoding: &'static Encoding,
    /** 每行起始字节偏移，0-based。 */
    starts: Vec<u64>,
}

static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<IndexedFile>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<PathBuf, Arc<IndexedFile>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|gap| gap.as_millis() as u64)
        .unwrap_or(0)
}

pub fn file_info(path: &Path) -> Result<FileInfo, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件信息：{e}"))?;
    Ok(FileInfo {
        size_bytes: meta.len(),
        mtime: mtime_ms(&meta),
    })
}

pub fn open(path: &Path) -> Result<LargeFileMeta, String> {
    let indexed = load(path)?;
    Ok(LargeFileMeta {
        size_bytes: indexed.size,
        line_count: indexed.starts.len() as u64,
        encoding: indexed.encoding.name().to_string(),
        mtime: indexed.mtime,
    })
}

pub fn lines(path: &Path, start_line: u64, count: u64) -> Result<LargeFileWindow, String> {
    let indexed = load(path)?;
    let total = indexed.starts.len() as u64;
    if total == 0 {
        return Ok(LargeFileWindow {
            start_line: 0,
            lines: Vec::new(),
            total_lines: 0,
        });
    }

    let start = start_line.min(total - 1);
    let requested = count.clamp(1, MAX_WINDOW_LINES);
    let mut end = (start + requested).min(total);

    // 单屏通常只有几十行；限制单次读取字节数，避免超长行拖垮 IPC。
    let from = indexed.starts[start as usize];
    let byte_limit = from.saturating_add(MAX_WINDOW_BYTES);
    while end > start + 1 {
        let end_offset = indexed
            .starts
            .get(end as usize)
            .copied()
            .unwrap_or(indexed.size);
        if end_offset <= byte_limit {
            break;
        }
        end -= 1;
    }

    let to = if end < total {
        indexed.starts[end as usize]
    } else {
        indexed.size
    };
    let read_len = (to.saturating_sub(from)).min(MAX_WINDOW_BYTES) as usize;
    let mut bytes = vec![0u8; read_len];

    if read_len > 0 {
        let mut file = File::open(path).map_err(|e| format!("无法读取文件：{e}"))?;
        file.seek(SeekFrom::Start(from))
            .map_err(|e| format!("无法定位文件：{e}"))?;
        file.read_exact(&mut bytes)
            .map_err(|e| format!("无法读取文件：{e}"))?;
    }

    let (text, _, _) = indexed.encoding.decode(&bytes);
    let mut lines: Vec<String> = text
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    lines.truncate((end - start) as usize);

    Ok(LargeFileWindow {
        start_line: start,
        lines,
        total_lines: total,
    })
}

fn load(path: &Path) -> Result<Arc<IndexedFile>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件信息：{e}"))?;
    let size = meta.len();
    let mtime = mtime_ms(&meta);

    if let Some(cached) = cache()
        .lock()
        .map_err(|_| "大文件缓存不可用".to_string())?
        .get(path)
        .cloned()
    {
        if cached.size == size && cached.mtime == mtime {
            return Ok(cached);
        }
    }

    let indexed = Arc::new(build(path, size, mtime)?);
    let mut guard = cache().lock().map_err(|_| "大文件缓存不可用".to_string())?;
    if guard.len() >= MAX_CACHED_FILES {
        guard.clear();
    }
    guard.insert(path.to_path_buf(), Arc::clone(&indexed));
    Ok(indexed)
}

fn build(path: &Path, size: u64, mtime: u64) -> Result<IndexedFile, String> {
    let mut file = File::open(path).map_err(|e| format!("无法读取文件：{e}"))?;
    let (encoding, offset) = sniff_encoding(&mut file, size)?;

    let mut starts: Vec<u64> = Vec::new();
    starts.push(offset);
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("无法定位文件：{e}"))?;

    let mut buffer = vec![0u8; SCAN_CHUNK];
    let mut base = offset;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("无法读取文件：{e}"))?;
        if read == 0 {
            break;
        }
        for position in memchr::memchr_iter(b'\n', &buffer[..read]) {
            starts.push(base + position as u64 + 1);
        }
        base += read as u64;
    }

    Ok(IndexedFile {
        size,
        mtime,
        encoding,
        starts,
    })
}

fn sniff_encoding(file: &mut File, size: u64) -> Result<(&'static Encoding, u64), String> {
    let sample_len = size.min(SAMPLE_BYTES) as usize;
    let mut sample = vec![0u8; sample_len];
    if sample_len > 0 {
        file.seek(SeekFrom::Start(0))
            .map_err(|e| format!("无法定位文件：{e}"))?;
        file.read_exact(&mut sample)
            .map_err(|e| format!("无法读取文件：{e}"))?;
    }

    if sample.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok((UTF_8, 3));
    }
    if sample.starts_with(&[0xFF, 0xFE]) || sample.starts_with(&[0xFE, 0xFF]) {
        return Err("大文件模式暂不支持 UTF-16 编码".to_string());
    }
    if sample.contains(&0) {
        return Err("看起来是二进制文件，已跳过".to_string());
    }

    if decodes_clean(UTF_8, &sample) {
        return Ok((UTF_8, 0));
    }

    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(&sample, false);
    let guessed = detector.guess(None, true);
    if decodes_clean(guessed, &sample) {
        return Ok((guessed, 0));
    }
    for candidate in [GB18030, UTF_8] {
        if decodes_clean(candidate, &sample) {
            return Ok((candidate, 0));
        }
    }

    // 仍然失败：按 UTF-8 有损显示，至少能打开。
    Ok((UTF_8, 0))
}

/** 采样可能截断多字节字符，末尾最多回退 3 字节再判断。 */
fn decodes_clean(encoding: &'static Encoding, bytes: &[u8]) -> bool {
    for cut in 0..=3 {
        if bytes.len() < cut {
            continue;
        }
        let (_, _, had_errors) = encoding.decode(&bytes[..bytes.len() - cut]);
        if !had_errors {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    fn temp_file(bytes: &[u8]) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "note-large-test-{}-{}.txt",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    #[test]
    fn indexes_and_reads_windows() {
        let path = temp_file(b"alpha\r\nbeta\n\ngamma");
        let meta = open(&path).unwrap();
        assert_eq!(meta.line_count, 4);
        assert_eq!(meta.encoding, "UTF-8");

        assert_eq!(lines(&path, 0, 2).unwrap().lines, vec!["alpha", "beta"]);
        assert_eq!(lines(&path, 2, 10).unwrap().lines, vec!["", "gamma"]);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn keeps_trailing_empty_line() {
        let path = temp_file(b"a\n");
        let meta = open(&path).unwrap();
        assert_eq!(meta.line_count, 2);
        assert_eq!(lines(&path, 0, 10).unwrap().lines, vec!["a", ""]);
        let _ = fs::remove_file(path);
    }

    #[test]
    #[ignore]
    fn benchmark_file() {
        let Ok(path) = std::env::var("NOTE_BENCH_FILE") else {
            return;
        };
        let path = PathBuf::from(path);
        let start = std::time::Instant::now();
        let meta = open(&path).unwrap();
        let open_ms = start.elapsed().as_millis();

        let start = std::time::Instant::now();
        let window = lines(&path, meta.line_count / 2, 100).unwrap();
        let read_ms = start.elapsed().as_millis();
        println!(
            "size={}MB lines={} open={}ms window={}ms fetched={}",
            meta.size_bytes / 1024 / 1024,
            meta.line_count,
            open_ms,
            read_ms,
            window.lines.len()
        );
    }

    #[test]
    fn rejects_binary_and_utf16() {
        let binary = temp_file(b"a\0b");
        assert!(open(&binary).is_err());
        let _ = fs::remove_file(binary);

        let utf16 = temp_file(&[0xFF, 0xFE, b'a', 0, b'b', 0]);
        assert!(open(&utf16).is_err());
        let _ = fs::remove_file(utf16);
    }
}
