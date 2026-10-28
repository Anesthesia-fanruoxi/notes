use tauri::AppHandle;

use crate::encoding::FileDoc;
use crate::library::{
    self, BackupReport, Category, DocMeta, ImportReport, LibraryIndex, ScratchDoc,
};

#[tauri::command]
pub fn list_library(app: AppHandle) -> Result<LibraryIndex, String> {
    let (_, index) = library::load_index(&app)?;
    Ok(index)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_doc(
    app: AppHandle,
    title: String,
    category_id: String,
    extension: String,
    content: String,
    encoding: String,
    has_bom: bool,
    line_ending: String,
) -> Result<DocMeta, String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::create_doc(
        &paths,
        &mut index,
        &title,
        &category_id,
        &extension,
        &content,
        &encoding,
        has_bom,
        &line_ending,
    )
}

#[tauri::command]
pub fn read_doc(app: AppHandle, doc_id: String) -> Result<FileDoc, String> {
    let (paths, index) = library::load_index(&app)?;
    library::read_doc(&paths, &index, &doc_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn write_doc(
    app: AppHandle,
    doc_id: String,
    content: String,
    encoding: String,
    has_bom: bool,
    line_ending: String,
) -> Result<DocMeta, String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::write_doc(
        &paths,
        &mut index,
        &doc_id,
        &content,
        &encoding,
        has_bom,
        &line_ending,
    )
}

#[tauri::command]
pub fn rename_doc(app: AppHandle, doc_id: String, title: String) -> Result<DocMeta, String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::rename_doc(&paths, &mut index, &doc_id, &title)
}

#[tauri::command]
pub fn move_doc(app: AppHandle, doc_id: String, category_id: String) -> Result<(), String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::move_doc(&paths, &mut index, &doc_id, &category_id)
}

#[tauri::command]
pub fn delete_doc(app: AppHandle, doc_id: String) -> Result<(), String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::delete_doc(&paths, &mut index, &doc_id)
}

#[tauri::command]
pub fn create_category(
    app: AppHandle,
    name: String,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::create_category(&paths, &mut index, &name, parent_id)
}

#[tauri::command]
pub fn rename_category(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::rename_category(&paths, &mut index, &id, &name)
}

#[tauri::command]
pub fn delete_category(app: AppHandle, id: String) -> Result<(), String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::delete_category(&paths, &mut index, &id)
}

#[tauri::command]
pub fn move_category(
    app: AppHandle,
    id: String,
    parent_id: Option<String>,
) -> Result<(), String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::move_category(&paths, &mut index, &id, parent_id)
}

#[tauri::command]
pub fn import_files(
    app: AppHandle,
    items: Vec<(String, String)>,
) -> Result<ImportReport, String> {
    let (paths, mut index) = library::load_index(&app)?;
    library::import_files(&paths, &mut index, items)
}

#[tauri::command]
pub fn export_doc(app: AppHandle, doc_id: String, target_dir: String) -> Result<String, String> {
    let (paths, index) = library::load_index(&app)?;
    library::export_doc(&paths, &index, &doc_id, &target_dir)
}

#[tauri::command]
pub fn save_scratch(
    app: AppHandle,
    tab_id: String,
    title: String,
    content: String,
    encoding: String,
    has_bom: bool,
    line_ending: String,
) -> Result<(), String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    library::save_scratch(
        &paths,
        &tab_id,
        &title,
        &content,
        &encoding,
        has_bom,
        &line_ending,
    )
}

#[tauri::command]
pub fn list_scratch(app: AppHandle) -> Result<Vec<ScratchDoc>, String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    Ok(library::list_scratch(&paths))
}

#[tauri::command]
pub fn read_scratch(app: AppHandle, tab_id: String) -> Result<FileDoc, String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    library::read_scratch(&paths, &tab_id)
}

#[tauri::command]
pub fn drop_scratch(app: AppHandle, tab_id: String) -> Result<(), String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    library::drop_scratch(&paths, &tab_id)
}

#[tauri::command]
pub fn backup_library(app: AppHandle, target_dir: String) -> Result<BackupReport, String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    library::backup_library(&paths, &target_dir)
}

#[tauri::command]
pub fn restore_library(app: AppHandle, backup_dir: String) -> Result<(), String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    library::restore_library(&paths, &backup_dir)
}

#[tauri::command]
pub fn relocate_library(app: AppHandle, new_dir: String) -> Result<(), String> {
    let paths = library::WorkspacePaths::resolve(&app)?;
    library::relocate_library(&paths, &new_dir)
}
