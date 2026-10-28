import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

/** 手动选择「纯文本」时写入的哨兵值。 */
export const PLAIN_TEXT = "__plain";

/** 语言包只加载一次，失败也缓存，避免反复重试。 */
const cache = new Map<string, Promise<LanguageSupport | null>>();

export function matchLanguageByFilename(filename?: string): LanguageDescription | null {
  if (!filename) return null;
  return LanguageDescription.matchFilename(languages, filename) ?? null;
}

export function findLanguageByName(name: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, name, true) ?? null;
}

export function languageLabel(desc: LanguageDescription | null): string {
  return desc?.name ?? "纯文本";
}

/**
 * 按需加载语言包。Markdown 单独处理：注入 codeLanguages，
 * 让 ```lang 代码块内部也能高亮（PROMPT §5.1）。
 */
export function loadLanguage(desc: LanguageDescription): Promise<LanguageSupport | null> {
  const key = desc.name;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      if (desc.name === "Markdown") {
        return markdown({ base: markdownLanguage, codeLanguages: languages });
      }
      return await desc.load();
    } catch {
      return null;
    }
  })();

  cache.set(key, pending);
  return pending;
}

/** 状态栏手动切换用的列表；找不到的名字会被过滤掉。 */
const COMMON_NAMES = [
  "Markdown",
  "TypeScript",
  "JavaScript",
  "TSX",
  "JSX",
  "JSON",
  "HTML",
  "CSS",
  "SCSS",
  "Python",
  "Go",
  "Rust",
  "Java",
  "C",
  "C++",
  "SQL",
  "YAML",
  "TOML",
  "XML",
  "Shell",
  "PowerShell",
];

export const commonLanguages: LanguageDescription[] = COMMON_NAMES.map((name) =>
  findLanguageByName(name),
).filter((desc): desc is LanguageDescription => desc !== null);
