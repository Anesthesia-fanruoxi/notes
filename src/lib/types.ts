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

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
}
