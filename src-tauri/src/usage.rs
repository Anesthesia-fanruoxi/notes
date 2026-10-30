//! AI 调用记录：每次请求追加一行 JSONL，按月分文件，只保留最近 12 个月。
//!
//! 数据量很小（一次调用一行），不做数据库；聚合与分桶交给前端按本地时区算。

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const KEEP_MONTHS: i64 = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub ts: i64,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub doc_id: Option<String>,
    #[serde(default)]
    pub doc_title: String,
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub completion_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
    #[serde(default)]
    pub cache_hit_tokens: u64,
    #[serde(default)]
    pub cache_miss_tokens: u64,
    #[serde(default)]
    pub cached_tokens: u64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub prompt_preview: String,
}

/// 聚合用的精简行，不带提示词正文。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePoint {
    pub ts: i64,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub cache_hit_tokens: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePage {
    pub total: usize,
    pub items: Vec<UsageRecord>,
}

fn usage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("usage");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建用量目录：{e}"))?;
    Ok(dir)
}

fn month_of(ts: i64) -> (i64, u32) {
    let (year, month, _) = civil_from_days(ts.div_euclid(86_400));
    (year, month)
}

fn month_index(year: i64, month: u32) -> i64 {
    year * 12 + month as i64 - 1
}

fn file_for(dir: &PathBuf, ts: i64) -> PathBuf {
    let (year, month) = month_of(ts);
    dir.join(format!("usage-{year:04}-{month:02}.jsonl"))
}

/// 追加一条记录；写失败不影响对话本身。
pub fn append(app: &AppHandle, record: &UsageRecord) {
    let Ok(dir) = usage_dir(app) else {
        return;
    };
    let path = file_for(&dir, record.ts);
    let Ok(line) = serde_json::to_string(record) else {
        return;
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

fn read_records(dir: &PathBuf) -> Vec<UsageRecord> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut records = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<UsageRecord>(&line) {
                records.push(record);
            }
        }
    }
    records
}

/// 删掉超过保留期的月文件。
pub fn prune(app: &AppHandle) {
    let Ok(dir) = usage_dir(app) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let (year, month) = month_of(now_ms());
    let oldest = month_index(year, month) - (KEEP_MONTHS - 1);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name
            .strip_prefix("usage-")
            .and_then(|rest| rest.strip_suffix(".jsonl"))
        else {
            continue;
        };
        let mut parts = stem.split('-');
        let (Some(y), Some(m)) = (parts.next(), parts.next()) else {
            continue;
        };
        let (Ok(y), Ok(m)) = (y.parse::<i64>(), m.parse::<u32>()) else {
            continue;
        };
        if month_index(y, m) < oldest {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[tauri::command]
pub fn ai_usage_scan(app: AppHandle, since: i64) -> Result<Vec<UsagePoint>, String> {
    let dir = usage_dir(&app)?;
    let mut points: Vec<UsagePoint> = read_records(&dir)
        .into_iter()
        .filter(|record| record.ts >= since)
        .map(|record| UsagePoint {
            ts: record.ts,
            provider: record.provider,
            model: record.model,
            prompt_tokens: record.prompt_tokens,
            completion_tokens: record.completion_tokens,
            total_tokens: record.total_tokens,
            cache_hit_tokens: record.cache_hit_tokens,
        })
        .collect();
    points.sort_by_key(|point| point.ts);
    Ok(points)
}

#[tauri::command]
pub fn ai_usage_records(app: AppHandle, offset: usize, limit: usize) -> Result<UsagePage, String> {
    let dir = usage_dir(&app)?;
    let mut records = read_records(&dir);
    records.sort_by(|a, b| b.ts.cmp(&a.ts));
    let total = records.len();
    let items = records.into_iter().skip(offset).take(limit).collect();
    Ok(UsagePage { total, items })
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Howard Hinnant 的 civil_from_days：把「1970-01-01 起的天数」换成 (年, 月, 日)。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn civil_roundtrip() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(20_000), (2024, 10, 4));
    }
}
