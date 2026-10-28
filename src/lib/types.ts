/**
 * 与 Rust 侧一一对应的类型（serde rename_all = camelCase）。
 */

export type LineEnding = "LF" | "CRLF";

export interface FileDoc {
  content: string;
  encoding: string;
  hasBom: boolean;
  lineEnding: LineEnding;
  sizeBytes: number;
  truncated: boolean;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

export interface DocMeta {
  id: string;
  title: string;
  categoryId: string;
  /** 无点号的扩展名。 */
  extension: string;
  createdAt: number;
  updatedAt: number;
  aiReadable: boolean;
  sizeBytes: number;
}

export interface LibraryIndex {
  version: number;
  categories: Category[];
  docs: DocMeta[];
}

export interface ScratchDoc {
  tabId: string;
  title: string;
  updatedAt: number;
  encoding: string;
  lineEnding: LineEnding;
}

export interface ImportReport {
  imported: string[];
  renamed: [string, string][];
  skipped: [string, string][];
}

export interface BackupReport {
  path: string;
  docs: number;
  categories: number;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  ts: number;
}

/* ---------- AI ---------- */

export type AiTemplate = "deepseek" | "qwen" | "ollama";
export type AiScope = "selection" | "document";

export interface AiConfig {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

export interface AiMessage {
  role: ChatRole;
  content: string;
}

/* ---------- 恢复 / 版本快照 ---------- */

export interface RecoveryMeta {
  docId: string;
  title: string;
  savedAt: number;
  sizeBytes: number;
}

export interface RecoverySnap {
  docId: string;
  title: string;
  content: string;
  encoding: string;
  hasBom: boolean;
  lineEnding: LineEnding;
  savedAt: number;
}

/** before-ai / before-restore 为系统写入，manual 为手动快照。 */
export type VersionSource = "before-ai" | "before-restore" | "manual";

export interface VersionMeta {
  id: string;
  docId: string;
  source: VersionSource;
  createdAt: number;
  sizeBytes: number;
}

export interface VersionSnap {
  id: string;
  docId: string;
  source: VersionSource;
  createdAt: number;
  encoding: string;
  hasBom: boolean;
  lineEnding: LineEnding;
  content: string;
}

export interface VersionRestoreResult {
  content: string;
  encoding: string;
  hasBom: boolean;
  lineEnding: LineEnding;
  meta: DocMeta;
  /** 还原前自动留下的 before-restore 快照。 */
  snapshot: VersionMeta;
}
