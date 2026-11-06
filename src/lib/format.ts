import { findLanguageByName, PLAIN_TEXT } from "../editor/languages";
import type { TabMeta } from "../store/useAppStore";

/**
 * 当前文档是否按 Markdown 处理。
 * 手动切换语言优先于文件名：.txt 选成 Markdown 后也能预览，
 * 反过来 .md 手动切成别的语言就退出 Markdown 预览。
 */
export function isMarkdownTab(tab?: TabMeta | null): boolean {
  if (!tab) return false;
  if (tab.languageOverride === PLAIN_TEXT) return false;
  if (tab.languageOverride) return tab.languageOverride === "Markdown";
  return /\.(md|markdown)$/i.test(tab.filename ?? "") || tab.languageLabel === "Markdown";
}

/**
 * 手动选择语言后，保存时应该使用的文件后缀。
 * 返回 null 表示保持原后缀（自动识别 / 该语言没有可用后缀）。
 */
/** 库文档标题可能已经带后缀，展示文件名时不要拼成 foo.md.md。 */
export function displayFileName(title: string, extension: string): string {
  const ext = extension.replace(/^\./, "").toLowerCase();
  if (!ext) return title;
  return title.toLowerCase().endsWith(`.${ext}`) ? title : `${title}.${ext}`;
}

export function extensionForLanguage(tab?: TabMeta | null): string | null {
  if (!tab) return null;
  if (tab.languageOverride === PLAIN_TEXT) return "txt";
  if (!tab.languageOverride) return null;

  const desc = findLanguageByName(tab.languageOverride);
  if (!desc) return null;

  const extension = desc.extensions
    .map((value) => value.replace(/^\./, "").toLowerCase())
    .find((value) => /^[a-z0-9]{1,12}$/.test(value));
  return extension ?? null;
}
