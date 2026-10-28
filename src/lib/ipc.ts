import { invoke } from "@tauri-apps/api/core";

import type {
  BackupReport,
  Category,
  DocMeta,
  FileDoc,
  ImportReport,
  LibraryIndex,
  LineEnding,
  ScratchDoc,
} from "./types";

/**
 * 全应用唯一的 invoke 出口（PROMPT §3.3）。
 */

export class IpcError extends Error {
  readonly command: string;

  constructor(message: string, command: string) {
    super(message);
    this.name = "IpcError";
    this.command = command;
  }
}

function readable(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err instanceof Error && err.message) return err.message;
  return "操作失败，请稍后重试";
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new IpcError(readable(err), command);
  }
}

export const ipc = {
  ping: () => call<string>("ping"),

  /* 单文件 */
  readTextFile: (path: string, maxBytes?: number) =>
    call<FileDoc>("read_text_file", { path, maxBytes }),
  writeTextFile: (
    path: string,
    content: string,
    encoding: string,
    hasBom: boolean,
    lineEnding: LineEnding,
  ) => call<void>("write_text_file", { path, content, encoding, hasBom, lineEnding }),
  takeCliArgs: () => call<string[]>("take_cli_args"),

  /* 文档库 */
  listLibrary: () => call<LibraryIndex>("list_library"),
  createDoc: (args: {
    title: string;
    categoryId: string;
    extension: string;
    content: string;
    encoding: string;
    hasBom: boolean;
    lineEnding: LineEnding;
  }) => call<DocMeta>("create_doc", args),
  readDoc: (docId: string) => call<FileDoc>("read_doc", { docId }),
  writeDoc: (
    docId: string,
    content: string,
    encoding: string,
    hasBom: boolean,
    lineEnding: LineEnding,
  ) => call<DocMeta>("write_doc", { docId, content, encoding, hasBom, lineEnding }),
  renameDoc: (docId: string, title: string) => call<DocMeta>("rename_doc", { docId, title }),
  moveDoc: (docId: string, categoryId: string) => call<void>("move_doc", { docId, categoryId }),
  deleteDoc: (docId: string) => call<void>("delete_doc", { docId }),

  createCategory: (name: string, parentId: string | null) =>
    call<Category>("create_category", { name, parentId }),
  renameCategory: (id: string, name: string) => call<void>("rename_category", { id, name }),
  deleteCategory: (id: string) => call<void>("delete_category", { id }),
  moveCategory: (id: string, parentId: string | null) =>
    call<void>("move_category", { id, parentId }),

  importFiles: (items: [string, string][]) => call<ImportReport>("import_files", { items }),
  exportDoc: (docId: string, targetDir: string) =>
    call<string>("export_doc", { docId, targetDir }),

  /* 临时文档 */
  saveScratch: (args: {
    tabId: string;
    title: string;
    content: string;
    encoding: string;
    hasBom: boolean;
    lineEnding: LineEnding;
  }) => call<void>("save_scratch", args),
  listScratch: () => call<ScratchDoc[]>("list_scratch"),
  readScratch: (tabId: string) => call<FileDoc>("read_scratch", { tabId }),
  dropScratch: (tabId: string) => call<void>("drop_scratch", { tabId }),

  /* 备份 / 恢复 / 迁移 */
  backupLibrary: (targetDir: string) => call<BackupReport>("backup_library", { targetDir }),
  restoreLibrary: (backupDir: string) => call<void>("restore_library", { backupDir }),
  relocateLibrary: (newDir: string) => call<void>("relocate_library", { newDir }),
};
