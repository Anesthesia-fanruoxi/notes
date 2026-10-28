import { invoke } from "@tauri-apps/api/core";

import type {
  AiConfig,
  AiMessage,
  BackupReport,
  Category,
  ChatMessage,
  DocMeta,
  FileDoc,
  ImportReport,
  LibraryIndex,
  LineEnding,
  RecoveryMeta,
  RecoverySnap,
  ScratchDoc,
  VersionMeta,
  VersionRestoreResult,
  VersionSnap,
  VersionSource,
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
  setAiReadable: (docId: string, readable: boolean) =>
    call<DocMeta>("set_ai_readable", { docId, readable }),

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

  /* 恢复快照 */
  saveRecovery: (args: {
    docId: string;
    title: string;
    content: string;
    encoding: string;
    hasBom: boolean;
    lineEnding: LineEnding;
  }) => call<void>("save_recovery", args),
  listRecovery: () => call<RecoveryMeta[]>("list_recovery"),
  readRecovery: (docId: string) => call<RecoverySnap>("read_recovery", { docId }),
  dropRecovery: (docId: string) => call<void>("drop_recovery", { docId }),

  /* 版本快照 */
  createVersion: (args: {
    docId: string;
    content: string;
    encoding: string;
    hasBom: boolean;
    lineEnding: LineEnding;
    source: VersionSource;
  }) => call<VersionMeta>("create_version", args),
  listVersions: (docId: string) => call<VersionMeta[]>("list_versions", { docId }),
  readVersion: (docId: string, versionId: string) =>
    call<VersionSnap>("read_version", { docId, versionId }),
  restoreVersion: (args: {
    docId: string;
    versionId: string;
    content: string;
    encoding: string;
    hasBom: boolean;
    lineEnding: LineEnding;
  }) => call<VersionRestoreResult>("restore_version", args),

  /* AI 会话 */
  loadChat: (docId: string) => call<ChatMessage[]>("load_chat", { docId }),
  appendChat: (docId: string, message: ChatMessage) =>
    call<void>("append_chat", { docId, message }),
  clearChat: (docId: string) => call<void>("clear_chat", { docId }),

  /* AI 请求 */
  setSecret: (provider: string, value: string) =>
    call<void>("set_secret", { provider, value }),
  getSecretStatus: (provider: string) => call<boolean>("get_secret_status", { provider }),
  clearSecret: (provider: string) => call<void>("clear_secret", { provider }),
  aiChat: (args: {
    requestId: string;
    docId: string | null;
    config: AiConfig;
    messages: AiMessage[];
  }) => call<void>("ai_chat", args),
  aiAbort: (requestId: string) => call<void>("ai_abort", { requestId }),
  aiTestConnection: (config: AiConfig) => call<number>("ai_test_connection", { config }),

  quitApp: () => call<void>("quit_app"),

  /* 备份 / 恢复 / 迁移 */
  backupLibrary: (targetDir: string) => call<BackupReport>("backup_library", { targetDir }),
  restoreLibrary: (backupDir: string) => call<void>("restore_library", { backupDir }),
  relocateLibrary: (newDir: string) => call<void>("relocate_library", { newDir }),
};
