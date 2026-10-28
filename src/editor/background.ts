/**
 * 编辑区背景预设。只作用于编辑器（正文 / 行号 / 查找面板），
 * 不改变侧栏、标签栏、AI 面板与状态栏。
 */
export type EditorTone = "light" | "dark";

export interface EditorBgPreset {
  id: string;
  label: string;
  color: string;
  tone: EditorTone;
}

export const EDITOR_BACKGROUNDS: EditorBgPreset[] = [
  { id: "paper", label: "纸白", color: "#fbfaf6", tone: "light" },
  { id: "sepia", label: "米黄", color: "#f6efdf", tone: "light" },
  { id: "green", label: "豆沙绿", color: "#e8f1e4", tone: "light" },
  { id: "mist", label: "雾灰", color: "#f2f3f5", tone: "light" },
  { id: "solarized-light", label: "Solar 浅", color: "#fdf6e3", tone: "light" },
  { id: "solarized-dark", label: "Solar 深", color: "#002b36", tone: "dark" },
  { id: "nord", label: "Nord", color: "#2e3440", tone: "dark" },
  { id: "charcoal", label: "炭灰", color: "#24272c", tone: "dark" },
  { id: "black", label: "纯黑", color: "#0c0e11", tone: "dark" },
];

export interface ResolvedEditorBg {
  color: string | null;
  tone: EditorTone | null;
  label: string;
}

/** 自定义色按亮度决定深/浅文字，保证可读。 */
export function toneForColor(hex: string): EditorTone {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "light";
  const value = Number.parseInt(match[1], 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map(
    (channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    },
  );
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  // WCAG 分界：相对亮度 > 0.179 时，深色文字的对比更高。
  return luminance > 0.179 ? "light" : "dark";
}

export function resolveEditorBackground(value: string): ResolvedEditorBg {
  if (value.startsWith("custom:")) {
    const color = value.slice("custom:".length);
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return { color, tone: toneForColor(color), label: `自定义 ${color}` };
    }
  }
  const preset = EDITOR_BACKGROUNDS.find((item) => item.id === value);
  if (preset) {
    return { color: preset.color, tone: preset.tone, label: preset.label };
  }
  return { color: null, tone: null, label: "跟随主题" };
}
