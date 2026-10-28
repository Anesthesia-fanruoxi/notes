//! 文档库的磁盘布局、索引与读写。
//!
//! ```text
//! <app_data>/
//!   library/                 # 可迁移，位置记录在 library-path.txt
//!     index.json
//!     docs/<docId>.<ext>
//!     chats/<docId>.json
//!     versions/<docId>/*.snap
//!   recovery/<docId>.snap    # 常驻文档未保存改动
//!   scratch/<tabId>.md/.json # 临时文档自动保存
//! ```

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::encoding::{self, FileDoc};

pub const INDEX_VERSION: u32 = 1;
pub const UNCATEGORIZED_ID: &str = "uncategorized";
const LOCATION_FILE: &str = "library-path.txt";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub id: String,
    pub title: String,
    pub category_id: String,
    /// 无点号的扩展名，例如 "md" / "ts"。
    pub extension: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub ai_readable: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    pub version: u32,
    pub categories: Vec<Category>,
    pub docs: Vec<DocMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchDoc {
    pub tab_id: String,
    pub title: String,
    pub updated_at: i64,
    pub encoding: String,
    pub line_ending: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: Vec<String>,
    pub renamed: Vec<[String; 2]>,
    pub skipped: Vec<[String; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub path: String,
    pub docs: usize,
    pub categories: usize,
}

#[derive(Debug, Clone)]
pub struct WorkspacePaths {
    pub app_data: PathBuf,
    pub library: PathBuf,
    pub index: PathBuf,
    pub docs: PathBuf,
    pub chats: PathBuf,
    pub versions: PathBuf,
    pub recovery: PathBuf,
    pub scratch: PathBuf,
    pub location_file: PathBuf,
}

impl WorkspacePaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法定位应用数据目录：{e}"))?;
        let location_file = app_data.join(LOCATION_FILE);

        // 迁移过的库位置优先级最高。
        let library = fs::read_to_string(&location_file)
            .ok()
            .map(|s| PathBuf::from(s.trim()))
            .filter(|p| p.is_dir())
            .unwrap_or_else(|| app_data.join("library"));

        Ok(Self {
            index: library.join("index.json"),
            docs: library.join("docs"),
            chats: library.join("chats"),
            versions: library.join("versions"),
            recovery: app_data.join("recovery"),
            scratch: app_data.join("scratch"),
            location_file,
            library,
            app_data,
        })
    }
}

pub fn ensure_layout(app: &AppHandle) -> Result<(), String> {
    let paths = WorkspacePaths::resolve(app)?;

    for dir in [
        &paths.docs,
        &paths.chats,
        &paths.versions,
        &paths.recovery,
        &paths.scratch,
    ] {
        fs::create_dir_all(dir).map_err(|e| format!("无法创建目录：{e}"))?;
    }

    if !paths.index.exists() {
        let index = LibraryIndex {
            version: INDEX_VERSION,
            categories: vec![Category {
                id: UNCATEGORIZED_ID.to_string(),
                name: "未分类".to_string(),
                parent_id: None,
                order: 0,
            }],
            docs: Vec::new(),
        };
        save_index(&paths, &index)?;
    }

    Ok(())
}

pub fn load_index(app: &AppHandle) -> Result<(WorkspacePaths, LibraryIndex), String> {
    let paths = WorkspacePaths::resolve(app)?;
    let raw = fs::read_to_string(&paths.index).map_err(|e| format!("无法读取索引：{e}"))?;

    let mut index: LibraryIndex = match serde_json::from_str(&raw) {
        Ok(index) => index,
        Err(err) => {
            // 索引坏了不能崩：备份一份再按 docs 目录重建。
            let broken = paths
                .library
                .join(format!("index.broken-{}.json", now_ms()));
            let _ = fs::copy(&paths.index, &broken);
            let _ = err;
            rebuild_index(&paths)?
        }
    };

    if !index
        .categories
        .iter()
        .any(|c| c.id == UNCATEGORIZED_ID)
    {
        index.categories.insert(
            0,
            Category {
                id: UNCATEGORIZED_ID.to_string(),
                name: "未分类".to_string(),
                parent_id: None,
                order: 0,
            },
        );
    }

    // 引用了不存在分类的文档，回落到未分类。
    let known: Vec<String> = index.categories.iter().map(|c| c.id.clone()).collect();
    let mut changed = false;
    for doc in &mut index.docs {
        if !known.contains(&doc.category_id) {
            doc.category_id = UNCATEGORIZED_ID.to_string();
            changed = true;
        }
    }
    if changed {
        save_index(&paths, &index)?;
    }

    Ok((paths, index))
}

pub fn save_index(paths: &WorkspacePaths, index: &LibraryIndex) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| format!("索引序列化失败：{e}"))?;
    write_atomic(&paths.index, &bytes).map_err(|e| format!("索引写入失败：{e}"))
}

fn rebuild_index(paths: &WorkspacePaths) -> Result<LibraryIndex, String> {
    let mut docs = Vec::new();
    if let Ok(entries) = fs::read_dir(&paths.docs) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if id.is_empty() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("txt")
                .to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            docs.push(DocMeta {
                title: id.clone(),
                id,
                category_id: UNCATEGORIZED_ID.to_string(),
                extension,
                created_at: now_ms(),
                updated_at: now_ms(),
                ai_readable: true,
                size_bytes: size,
            });
        }
    }

    let index = LibraryIndex {
        version: INDEX_VERSION,
        categories: vec![Category {
            id: UNCATEGORIZED_ID.to_string(),
            name: "未分类".to_string(),
            parent_id: None,
            order: 0,
        }],
        docs,
    };
    save_index(paths, &index)?;
    Ok(index)
}

/* ---------- 分类 ---------- */

pub fn create_category(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    name: &str,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名不能为空".into());
    }
    if let Some(parent) = &parent_id {
        if !index.categories.iter().any(|c| &c.id == parent) {
            return Err("父分类不存在".into());
        }
    }
    let duplicated = index.categories.iter().any(|c| {
        c.parent_id == parent_id && c.name.eq_ignore_ascii_case(name)
    });
    if duplicated {
        return Err("同级已有同名分类".into());
    }

    let order = index
        .categories
        .iter()
        .filter(|c| c.parent_id == parent_id)
        .count() as i32;

    let category = Category {
        id: generate_id("cat"),
        name: name.to_string(),
        parent_id,
        order,
    };
    index.categories.push(category.clone());
    save_index(paths, index)?;
    Ok(category)
}

pub fn rename_category(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    id: &str,
    name: &str,
) -> Result<(), String> {
    if id == UNCATEGORIZED_ID {
        return Err("内置分类不可改名".into());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名不能为空".into());
    }

    let parent = index
        .categories
        .iter()
        .find(|c| c.id == id)
        .ok_or("分类不存在")?
        .parent_id
        .clone();

    if index
        .categories
        .iter()
        .any(|c| c.id != id && c.parent_id == parent && c.name.eq_ignore_ascii_case(name))
    {
        return Err("同级已有同名分类".into());
    }

    let target = index
        .categories
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or("分类不存在")?;
    target.name = name.to_string();
    save_index(paths, index)
}

pub fn delete_category(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    id: &str,
) -> Result<(), String> {
    if id == UNCATEGORIZED_ID {
        return Err("内置分类不可删除".into());
    }
    if !index.categories.iter().any(|c| c.id == id) {
        return Err("分类不存在".into());
    }

    // 整棵子树一起删，文档全部回落未分类。
    let mut doomed = vec![id.to_string()];
    let mut cursor = 0;
    while cursor < doomed.len() {
        let current = doomed[cursor].clone();
        cursor += 1;
        for child in index.categories.iter().filter(|c| c.parent_id.as_deref() == Some(&current)) {
            if !doomed.contains(&child.id) {
                doomed.push(child.id.clone());
            }
        }
    }

    for doc in &mut index.docs {
        if doomed.contains(&doc.category_id) {
            doc.category_id = UNCATEGORIZED_ID.to_string();
        }
    }
    index.categories.retain(|c| !doomed.contains(&c.id));
    save_index(paths, index)
}

pub fn move_category(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    id: &str,
    parent_id: Option<String>,
) -> Result<(), String> {
    if id == UNCATEGORIZED_ID {
        return Err("内置分类不可移动".into());
    }
    if !index.categories.iter().any(|c| c.id == id) {
        return Err("分类不存在".into());
    }
    if let Some(parent) = &parent_id {
        if parent == id {
            return Err("不能移动到自己下面".into());
        }
        if !index.categories.iter().any(|c| &c.id == parent) {
            return Err("父分类不存在".into());
        }
        if is_descendant(index, parent, id) {
            return Err("不能移动到自己的子分类下".into());
        }
    }

    let target = index
        .categories
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or("分类不存在")?;
    target.parent_id = parent_id;
    save_index(paths, index)
}

fn is_descendant(index: &LibraryIndex, candidate: &str, ancestor: &str) -> bool {
    let mut current = index
        .categories
        .iter()
        .find(|c| c.id == candidate)
        .and_then(|c| c.parent_id.clone());

    while let Some(id) = current {
        if id == ancestor {
            return true;
        }
        current = index
            .categories
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.parent_id.clone());
    }
    false
}

/* ---------- 文档 ---------- */

pub fn create_doc(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    title: &str,
    category_id: &str,
    extension: &str,
    content: &str,
    encoding_name: &str,
    has_bom: bool,
    line_ending: &str,
) -> Result<DocMeta, String> {
    let category_id = normalize_category(index, category_id);
    let (title, _) = unique_title(index, title, None);
    let id = generate_id("doc");
    let extension = normalize_extension(extension);

    let path = paths.docs.join(format!("{id}.{extension}"));
    encoding::write(&path, content, encoding_name, has_bom, line_ending)?;
    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let doc = DocMeta {
        id,
        title,
        category_id,
        extension,
        created_at: now_ms(),
        updated_at: now_ms(),
        ai_readable: true,
        size_bytes: size,
    };
    index.docs.push(doc.clone());
    save_index(paths, index)?;
    Ok(doc)
}

pub fn read_doc(
    paths: &WorkspacePaths,
    index: &LibraryIndex,
    doc_id: &str,
) -> Result<FileDoc, String> {
    let doc = find_doc(index, doc_id)?;
    encoding::read(&doc_path(paths, doc), None)
}

pub fn write_doc(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    doc_id: &str,
    content: &str,
    encoding_name: &str,
    has_bom: bool,
    line_ending: &str,
) -> Result<DocMeta, String> {
    let doc = find_doc(index, doc_id)?;
    encoding::write(
        &doc_path(paths, doc),
        content,
        encoding_name,
        has_bom,
        line_ending,
    )?;
    let size = fs::metadata(doc_path(paths, doc))
        .map(|m| m.len())
        .unwrap_or(0);

    let updated = index
        .docs
        .iter_mut()
        .find(|d| d.id == doc_id)
        .ok_or("文档不存在")?;
    updated.size_bytes = size;
    updated.updated_at = now_ms();
    let clone = updated.clone();
    save_index(paths, index)?;
    Ok(clone)
}

pub fn rename_doc(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    doc_id: &str,
    title: &str,
) -> Result<DocMeta, String> {
    if !index.docs.iter().any(|d| d.id == doc_id) {
        return Err("文档不存在".into());
    }
    let (title, _) = unique_title(index, title, Some(doc_id));
    let doc = index
        .docs
        .iter_mut()
        .find(|d| d.id == doc_id)
        .ok_or("文档不存在")?;
    doc.title = title;
    doc.updated_at = now_ms();
    let clone = doc.clone();
    save_index(paths, index)?;
    Ok(clone)
}

pub fn move_doc(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    doc_id: &str,
    category_id: &str,
) -> Result<(), String> {
    let category_id = normalize_category(index, category_id);
    let doc = index
        .docs
        .iter_mut()
        .find(|d| d.id == doc_id)
        .ok_or("文档不存在")?;
    doc.category_id = category_id;
    doc.updated_at = now_ms();
    save_index(paths, index)
}

pub fn delete_doc(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    doc_id: &str,
) -> Result<(), String> {
    let doc = find_doc(index, doc_id)?.clone();
    let path = doc_path(paths, &doc);
    if path.exists() {
        // 只进回收站，绝不直接 unlink。
        trash::delete(&path).map_err(|e| format!("无法移入回收站：{e}"))?;
    }
    index.docs.retain(|d| d.id != doc_id);
    save_index(paths, index)
}

/* ---------- 导入 / 导出 ---------- */

pub fn import_files(
    paths: &WorkspacePaths,
    index: &mut LibraryIndex,
    items: Vec<(String, String)>,
) -> Result<ImportReport, String> {
    let mut report = ImportReport {
        imported: Vec::new(),
        renamed: Vec::new(),
        skipped: Vec::new(),
    };

    for (source, category_id) in items {
        let source_path = PathBuf::from(&source);
        if !source_path.is_file() {
            report
                .skipped
                .push([source.clone(), "不是文件".to_string()]);
            continue;
        }

        let original_title = source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名")
            .to_string();
        let extension = source_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("txt")
            .to_string();

        let (title, renamed) = unique_title(index, &original_title, None);
        if renamed {
            report
                .renamed
                .push([original_title.clone(), title.clone()]);
        }

        let id = generate_id("doc");
        let target = paths.docs.join(format!("{id}.{}", normalize_extension(&extension)));
        if let Err(err) = fs::copy(&source_path, &target) {
            report.skipped.push([source, format!("复制失败：{err}")]);
            continue;
        }

        let size = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        index.docs.push(DocMeta {
            id,
            title: title.clone(),
            category_id: normalize_category(index, &category_id),
            extension: normalize_extension(&extension),
            created_at: now_ms(),
            updated_at: now_ms(),
            ai_readable: true,
            size_bytes: size,
        });
        report.imported.push(title);
    }

    save_index(paths, index)?;
    Ok(report)
}

pub fn export_doc(
    paths: &WorkspacePaths,
    index: &LibraryIndex,
    doc_id: &str,
    target_dir: &str,
) -> Result<String, String> {
    let doc = find_doc(index, doc_id)?;
    let dir = PathBuf::from(target_dir);
    if !dir.is_dir() {
        return Err("目标目录不存在".into());
    }
    let filename = format!("{}.{}", sanitize_filename(&doc.title), doc.extension);
    let target = dir.join(&filename);
    fs::copy(doc_path(paths, doc), &target).map_err(|e| format!("导出失败：{e}"))?;
    Ok(filename)
}

/* ---------- 临时文档 ---------- */

pub fn save_scratch(
    paths: &WorkspacePaths,
    tab_id: &str,
    title: &str,
    content: &str,
    encoding_name: &str,
    has_bom: bool,
    line_ending: &str,
) -> Result<(), String> {
    encoding::write(
        &paths.scratch.join(format!("{tab_id}.md")),
        content,
        encoding_name,
        has_bom,
        line_ending,
    )?;
    let meta = ScratchDoc {
        tab_id: tab_id.to_string(),
        title: title.to_string(),
        updated_at: now_ms(),
        encoding: encoding_name.to_string(),
        line_ending: line_ending.to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
    write_atomic(&paths.scratch.join(format!("{tab_id}.json")), &bytes)
        .map_err(|e| format!("临时文档写入失败：{e}"))
}

pub fn list_scratch(paths: &WorkspacePaths) -> Vec<ScratchDoc> {
    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(&paths.scratch) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(meta) = serde_json::from_str::<ScratchDoc>(&raw) {
                    if paths.scratch.join(format!("{}.md", meta.tab_id)).exists() {
                        items.push(meta);
                    }
                }
            }
        }
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    items
}

pub fn read_scratch(paths: &WorkspacePaths, tab_id: &str) -> Result<FileDoc, String> {
    let mut doc = encoding::read(&paths.scratch.join(format!("{tab_id}.md")), None)?;

    // 单行文件探测不出换行符，且纯 ASCII 内容可能被猜成别的编码，
    // scratch 的 sidecar 里记着原始值，以它为准。
    if let Ok(raw) = fs::read_to_string(paths.scratch.join(format!("{tab_id}.json"))) {
        if let Ok(meta) = serde_json::from_str::<ScratchDoc>(&raw) {
            doc.encoding = meta.encoding;
            doc.line_ending = meta.line_ending;
        }
    }

    Ok(doc)
}

pub fn drop_scratch(paths: &WorkspacePaths, tab_id: &str) -> Result<(), String> {
    let md = paths.scratch.join(format!("{tab_id}.md"));
    let meta = paths.scratch.join(format!("{tab_id}.json"));
    if md.exists() {
        fs::remove_file(&md).map_err(|e| format!("清理临时文件失败：{e}"))?;
    }
    if meta.exists() {
        let _ = fs::remove_file(&meta);
    }
    Ok(())
}

/* ---------- 备份 / 恢复 / 迁移 ---------- */

pub fn backup_library(paths: &WorkspacePaths, target_dir: &str) -> Result<BackupReport, String> {
    let target = PathBuf::from(target_dir).join(format!("NoteLibrary-{}", now_ms()));
    copy_dir(&paths.library, &target)?;

    let index = read_index_at(&target)?;
    Ok(BackupReport {
        path: target.to_string_lossy().to_string(),
        docs: index.docs.len(),
        categories: index.categories.len(),
    })
}

pub fn restore_library(paths: &WorkspacePaths, backup_dir: &str) -> Result<(), String> {
    let source = PathBuf::from(backup_dir);
    let index = read_index_at(&source)?;

    // 先给当前库留后路。
    let safety = paths
        .app_data
        .join(format!("library.bak-{}", now_ms()));
    copy_dir(&paths.library, &safety)?;

    // 逐项覆盖：先清空索引与正文，再复制回来。
    let _ = fs::remove_dir_all(&paths.library);
    copy_dir(&source, &paths.library)?;

    // 校验复制结果，否则用备份回滚。
    match read_index_at(&paths.library) {
        Ok(_) => Ok(()),
        Err(err) => {
            let _ = fs::remove_dir_all(&paths.library);
            let _ = copy_dir(&safety, &paths.library);
            Err(format!("恢复失败，已回滚：{err}（文档数 {})", index.docs.len()))
        }
    }
}

pub fn relocate_library(paths: &WorkspacePaths, new_dir: &str) -> Result<(), String> {
    let target = PathBuf::from(new_dir).join("NoteLibrary");
    if target.exists() && fs::read_dir(&target).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("目标目录已存在且不为空".into());
    }
    copy_dir(&paths.library, &target)?;
    read_index_at(&target)?;

    fs::create_dir_all(&paths.app_data).map_err(|e| e.to_string())?;
    fs::write(&paths.location_file, target.to_string_lossy().as_bytes())
        .map_err(|e| format!("无法记录新库位置：{e}"))?;
    Ok(())
}

fn read_index_at(library: &Path) -> Result<LibraryIndex, String> {
    let raw = fs::read_to_string(library.join("index.json"))
        .map_err(|e| format!("备份内容不完整：{e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("索引无法解析：{e}"))
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("创建目录失败：{e}"))?;
    let entries = fs::read_dir(from).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let target = to.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| format!("复制 {} 失败：{e}", path.display()))?;
        }
    }
    Ok(())
}

/* ---------- 工具 ---------- */

pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("目标路径没有父目录"))?;
    fs::create_dir_all(parent)?;

    let tmp = parent.join(format!(".write-{}.tmp", next_seq()));
    fs::write(&tmp, bytes)?;
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(err);
    }
    Ok(())
}

fn next_seq() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    SEQ.fetch_add(1, Ordering::Relaxed)
}

/// 26 位 hex：时间戳 + 进程内自增 + pid；分类用短前缀区分。
pub fn generate_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let raw = format!("{nanos:x}{:x}{:x}", next_seq(), std::process::id());
    let trimmed = if raw.len() >= 26 {
        raw[raw.len() - 26..].to_string()
    } else {
        format!("{raw:0>26}")
    };
    format!("{prefix}_{trimmed}")
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn find_doc<'a>(index: &'a LibraryIndex, doc_id: &str) -> Result<&'a DocMeta, String> {
    index
        .docs
        .iter()
        .find(|d| d.id == doc_id)
        .ok_or_else(|| "文档不存在".to_string())
}

fn doc_path(paths: &WorkspacePaths, doc: &DocMeta) -> PathBuf {
    paths
        .docs
        .join(format!("{}.{}", doc.id, normalize_extension(&doc.extension)))
}

fn normalize_category(index: &LibraryIndex, category_id: &str) -> String {
    if index.categories.iter().any(|c| c.id == category_id) {
        category_id.to_string()
    } else {
        UNCATEGORIZED_ID.to_string()
    }
}

fn normalize_extension(extension: &str) -> String {
    let ext = extension.trim().trim_start_matches('.').to_lowercase();
    if ext.is_empty() || ext.len() > 12 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        "txt".to_string()
    } else {
        ext
    }
}

fn unique_title(index: &LibraryIndex, title: &str, ignore: Option<&str>) -> (String, bool) {
    let base = title.trim();
    let base = if base.is_empty() { "未命名" } else { base };

    let taken = |candidate: &str| {
        index
            .docs
            .iter()
            .any(|d| Some(d.id.as_str()) != ignore && d.title.eq_ignore_ascii_case(candidate))
    };

    if !taken(base) {
        return (base.to_string(), false);
    }
    for n in 2..10_000 {
        let candidate = format!("{base} ({n})");
        if !taken(&candidate) {
            return (candidate, true);
        }
    }
    (format!("{base} ({})", now_ms()), true)
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "未命名".to_string()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths() -> WorkspacePaths {
        let base = std::env::temp_dir().join(format!("note-lib-{}", next_seq()));
        let library = base.join("library");
        fs::create_dir_all(library.join("docs")).unwrap();
        fs::create_dir_all(library.join("chats")).unwrap();
        fs::create_dir_all(library.join("versions")).unwrap();
        fs::create_dir_all(base.join("recovery")).unwrap();
        fs::create_dir_all(base.join("scratch")).unwrap();
        WorkspacePaths {
            index: library.join("index.json"),
            docs: library.join("docs"),
            chats: library.join("chats"),
            versions: library.join("versions"),
            recovery: base.join("recovery"),
            scratch: base.join("scratch"),
            location_file: base.join("library-path.txt"),
            library,
            app_data: base,
        }
    }

    fn empty_index() -> LibraryIndex {
        LibraryIndex {
            version: INDEX_VERSION,
            categories: vec![Category {
                id: UNCATEGORIZED_ID.into(),
                name: "未分类".into(),
                parent_id: None,
                order: 0,
            }],
            docs: Vec::new(),
        }
    }

    #[test]
    fn create_doc_makes_unique_titles_and_writes_file() {
        let paths = temp_paths();
        let mut index = empty_index();

        let first = create_doc(
            &paths, &mut index, "笔记", UNCATEGORIZED_ID, "md", "hello", "UTF-8", false, "LF",
        )
        .unwrap();
        let second = create_doc(
            &paths, &mut index, "笔记", UNCATEGORIZED_ID, "md", "world", "UTF-8", false, "LF",
        )
        .unwrap();

        assert_eq!(first.title, "笔记");
        assert_eq!(second.title, "笔记 (2)");
        assert!(paths.docs.join(format!("{}.md", first.id)).exists());
        assert_eq!(index.docs.len(), 2);

        let _ = fs::remove_dir_all(&paths.app_data);
    }

    #[test]
    fn deleting_parent_category_moves_docs_to_uncategorized() {
        let paths = temp_paths();
        let mut index = empty_index();
        let parent = create_category(&paths, &mut index, "父", None).unwrap();
        let child =
            create_category(&paths, &mut index, "子", Some(parent.id.clone())).unwrap();
        create_doc(&paths, &mut index, "A", &child.id, "md", "x", "UTF-8", false, "LF").unwrap();

        delete_category(&paths, &mut index, &parent.id).unwrap();

        assert!(index.categories.iter().all(|c| c.id == UNCATEGORIZED_ID));
        assert_eq!(index.docs[0].category_id, UNCATEGORIZED_ID);

        let _ = fs::remove_dir_all(&paths.app_data);
    }

    #[test]
    fn category_cannot_move_into_its_own_descendant() {
        let paths = temp_paths();
        let mut index = empty_index();
        let a = create_category(&paths, &mut index, "A", None).unwrap();
        let b = create_category(&paths, &mut index, "B", Some(a.id.clone())).unwrap();

        assert!(move_category(&paths, &mut index, &a.id, Some(b.id.clone())).is_err());

        let _ = fs::remove_dir_all(&paths.app_data);
    }

    #[test]
    fn scratch_roundtrip_keeps_encoding() {
        let paths = temp_paths();
        save_scratch(&paths, "tab-1", "会议记录", "中文内容", "GBK", false, "CRLF").unwrap();

        let listed = list_scratch(&paths);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].encoding, "GBK");

        let doc = read_scratch(&paths, "tab-1").unwrap();
        assert_eq!(doc.content, "中文内容");
        assert_eq!(doc.line_ending, "CRLF");

        drop_scratch(&paths, "tab-1").unwrap();
        assert!(list_scratch(&paths).is_empty());

        let _ = fs::remove_dir_all(&paths.app_data);
    }

    #[test]
    fn backup_and_restore_roundtrip() {
        let paths = temp_paths();
        let mut index = empty_index();
        create_doc(&paths, &mut index, "备份我", UNCATEGORIZED_ID, "md", "内容", "UTF-8", false, "LF")
            .unwrap();
        save_index(&paths, &index).unwrap();

        let backup_root = paths.app_data.join("bk");
        fs::create_dir_all(&backup_root).unwrap();
        let report = backup_library(&paths, backup_root.to_str().unwrap()).unwrap();
        assert_eq!(report.docs, 1);

        let doc_id = index.docs[0].id.clone();
        delete_doc(&paths, &mut index, &doc_id).unwrap();
        restore_library(&paths, report.path.as_str()).unwrap();

        let restored = read_index_at(&paths.library).unwrap();
        assert_eq!(restored.docs.len(), 1);

        let _ = fs::remove_dir_all(&paths.app_data);
    }
}
