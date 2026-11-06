/**
 * 大文件分档（PROMPT §5.3）。阈值集中在这里，方便调整。
 */
export type EditorTier = "full" | "lite" | "plain";

export const SIZE_LIMITS = {
  /** 小于 2MB：完整档 */
  full: 2 * 1024 * 1024,
  /** 2–20MB：精简档；超过 20MB：纯文本档 */
  lite: 20 * 1024 * 1024,
};

/** 超过该大小的文件不再进入编辑器，改用只读查看器。 */
export const LARGE_FILE_LIMIT = SIZE_LIMITS.lite;

export function tierFor(sizeBytes: number, truncated = false): EditorTier {
  if (truncated || sizeBytes > SIZE_LIMITS.lite) return "plain";
  if (sizeBytes > SIZE_LIMITS.full) return "lite";
  return "full";
}

export function tierHint(tier: EditorTier): string | null {
  if (tier === "plain") return "大文件模式：已关闭语法高亮与折叠";
  if (tier === "lite") return "精简模式：已关闭语法高亮，保留搜索与行号";
  return null;
}
