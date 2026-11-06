/** 文件类型徽标：从完整文件名提取后缀，按格式给颜色。 */

const EXT_COLORS: Record<string, string> = {
  md: "#3b82f6",
  markdown: "#3b82f6",
  txt: "#64748b",
  log: "#6b7280",
  yaml: "#d97706",
  yml: "#d97706",
  json: "#ca8a04",
  jsonc: "#ca8a04",
  sh: "#16a34a",
  bash: "#16a34a",
  zsh: "#16a34a",
  ts: "#2563eb",
  tsx: "#2563eb",
  js: "#eab308",
  jsx: "#0ea5e9",
  py: "#0d9488",
  rs: "#c2410c",
  go: "#0891b2",
  java: "#dc2626",
  c: "#7c3aed",
  cpp: "#7c3aed",
  sql: "#9333ea",
  html: "#ea580c",
  css: "#0284c7",
  scss: "#db2777",
  toml: "#b45309",
  xml: "#ea580c",
  csv: "#16a34a",
  diff: "#64748b",
  ini: "#64748b",
  conf: "#64748b",
};

export function suffixOfName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function extensionColor(ext: string | null | undefined): string {
  if (!ext) return "#94a3b8";
  return EXT_COLORS[ext.toLowerCase()] ?? "#94a3b8";
}

/** 无后缀时徽标显示 -。 */
export function extensionLabel(ext: string | null | undefined): string {
  return ext && ext.length > 0 ? ext : "-";
}
