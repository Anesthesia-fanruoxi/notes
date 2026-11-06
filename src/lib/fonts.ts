/** 全局字体预设：选中后同时覆盖界面字体（--sans）与编辑器字体（--mono）。 */

export type FontPresetId =
  | "system"
  | "system-sans"
  | "jetbrains"
  | "cascadia"
  | "consolas"
  | "fira"
  | "plex"
  | "maple"
  | "yahei"
  | "sourcehan"
  | "sarasa"
  | "sarasa-mono"
  | "sourcehan-serif"
  | "wenkai"
  | "smiley"
  | "glow";

export interface FontPreset {
  id: FontPresetId;
  label: string;
  /** 状态栏和菜单用的短名称。 */
  shortLabel: string;
  sans: string;
  mono: string;
}

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif';
const SYSTEM_MONO =
  '"JetBrains Mono", "Cascadia Code", Consolas, "Sarasa Mono SC", monospace';
const MONO_FALLBACKS = '"Microsoft YaHei UI", "PingFang SC", monospace';

export const FONT_PRESETS: FontPreset[] = [
  {
    id: "system",
    label: "默认（系统界面 + 等宽编辑器）",
    shortLabel: "默认",
    sans: SYSTEM_SANS,
    mono: SYSTEM_MONO,
  },
  {
    id: "system-sans",
    label: "系统无衬线（全局）",
    shortLabel: "系统",
    sans: SYSTEM_SANS,
    mono: SYSTEM_SANS,
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono（全局）",
    shortLabel: "JetBrains",
    sans: `"JetBrains Mono", "Cascadia Code", Consolas, ${MONO_FALLBACKS}`,
    mono: `"JetBrains Mono", "Cascadia Code", Consolas, ${MONO_FALLBACKS}`,
  },
  {
    id: "cascadia",
    label: "Cascadia Code（全局）",
    shortLabel: "Cascadia",
    sans: `"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, ${MONO_FALLBACKS}`,
    mono: `"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, ${MONO_FALLBACKS}`,
  },
  {
    id: "consolas",
    label: "Consolas（全局）",
    shortLabel: "Consolas",
    sans: `Consolas, "JetBrains Mono", ${MONO_FALLBACKS}`,
    mono: `Consolas, "JetBrains Mono", ${MONO_FALLBACKS}`,
  },
  {
    id: "fira",
    label: "Fira Code（全局）",
    shortLabel: "Fira",
    sans: `"Fira Code", "JetBrains Mono", ${MONO_FALLBACKS}`,
    mono: `"Fira Code", "JetBrains Mono", ${MONO_FALLBACKS}`,
  },
  {
    id: "plex",
    label: "IBM Plex Mono（全局）",
    shortLabel: "Plex",
    sans: `"IBM Plex Mono", "JetBrains Mono", ${MONO_FALLBACKS}`,
    mono: `"IBM Plex Mono", "JetBrains Mono", ${MONO_FALLBACKS}`,
  },
  {
    id: "maple",
    label: "Maple Mono（全局）",
    shortLabel: "Maple",
    sans: `"Maple Mono", "Maple Mono NF", "JetBrains Mono", ${MONO_FALLBACKS}`,
    mono: `"Maple Mono", "Maple Mono NF", "JetBrains Mono", ${MONO_FALLBACKS}`,
  },
  {
    id: "yahei",
    label: "微软雅黑（全局）",
    shortLabel: "雅黑",
    sans: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
    mono: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
  },
  {
    id: "sourcehan",
    label: "思源黑体（全局）",
    shortLabel: "思源",
    sans: '"Source Han Sans SC", "Noto Sans CJK SC", "Source Han Sans CN", "思源黑体", "Microsoft YaHei UI", sans-serif',
    mono: '"Source Han Sans SC", "Noto Sans CJK SC", "Source Han Sans CN", "思源黑体", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: "sarasa",
    label: "更纱黑体 SC（全局）",
    shortLabel: "更纱",
    sans: '"Sarasa Gothic SC", "Sarasa UI SC", "更纱黑体 SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif',
    mono: '"Sarasa Gothic SC", "Sarasa UI SC", "更纱黑体 SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: "sarasa-mono",
    label: "更纱等宽 SC（全局）",
    shortLabel: "更纱等宽",
    sans: '"Sarasa Mono SC", "Sarasa Fixed SC", "更纱等宽 SC", "JetBrains Mono", "Microsoft YaHei UI", monospace',
    mono: '"Sarasa Mono SC", "Sarasa Fixed SC", "更纱等宽 SC", "JetBrains Mono", "Microsoft YaHei UI", monospace',
  },
  {
    id: "sourcehan-serif",
    label: "思源宋体（全局）",
    shortLabel: "思源宋",
    sans: '"Source Han Serif SC", "Noto Serif CJK SC", "Source Han Serif CN", "思源宋体", "SimSun", serif',
    mono: '"Source Han Serif SC", "Noto Serif CJK SC", "Source Han Serif CN", "思源宋体", "SimSun", serif',
  },
  {
    id: "smiley",
    label: "得意黑（全局）",
    shortLabel: "得意黑",
    sans: '"Smiley Sans", "Smiley Sans Oblique", "得意黑", "Microsoft YaHei UI", sans-serif',
    mono: '"Smiley Sans", "Smiley Sans Oblique", "得意黑", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: "glow",
    label: "未来荧黑（全局）",
    shortLabel: "荧黑",
    sans: '"Glow Sans SC", "Glow Sans", "未来荧黑", "Microsoft YaHei UI", sans-serif',
    mono: '"Glow Sans SC", "Glow Sans", "未来荧黑", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: "wenkai",
    label: "霞鹜文楷（全局）",
    shortLabel: "文楷",
    sans: '"LXGW WenKai", "LXGW WenKai Mono", "Kaiti SC", "KaiTi", "Sarasa Mono SC", serif',
    mono: '"LXGW WenKai Mono", "LXGW WenKai", "Sarasa Mono SC", "Kaiti SC", "KaiTi", serif',
  },
];

export const DEFAULT_FONT_PRESET: FontPresetId = "system";

export function isFontPresetId(value: unknown): value is FontPresetId {
  return FONT_PRESETS.some((preset) => preset.id === value);
}

export function getFontPreset(id: string): FontPreset {
  return FONT_PRESETS.find((preset) => preset.id === id) ?? FONT_PRESETS[0];
}
