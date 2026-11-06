import type { ThemeMode } from "../store/useAppStore";

/**
 * 全局主题：明/暗两套基础变量之上，命名主题只覆盖背景、边框、强调色等一小组变量。
 * 编辑区背景仍是独立设置，选中具体底色时会覆盖整个编辑区。
 */
export interface ThemeOption {
  value: ThemeMode;
  label: string;
  swatch: string;
  base: "light" | "dark";
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    value: "system",
    label: "跟随系统",
    swatch: "linear-gradient(135deg, #f2f4f7 50%, #1e2024 50%)",
    base: "light",
  },
  { value: "light", label: "浅色", swatch: "#ffffff", base: "light" },
  { value: "dark", label: "深色", swatch: "#1e2024", base: "dark" },
  { value: "green", label: "护眼绿", swatch: "#e7f0e5", base: "light" },
  { value: "sepia", label: "暖米色", swatch: "#f0eadf", base: "light" },
  { value: "mist", label: "雾蓝", swatch: "#e8eef5", base: "light" },
  { value: "rose", label: "豆沙粉", swatch: "#f3e9e6", base: "light" },
  { value: "charcoal", label: "炭灰", swatch: "#202327", base: "dark" },
  { value: "midnight", label: "午夜蓝", swatch: "#151f2b", base: "dark" },
];

const THEME_MAP = new Map(THEME_OPTIONS.map((option) => [option.value, option]));

export function themeLabel(mode: ThemeMode): string {
  return THEME_MAP.get(mode)?.label ?? "跟随系统";
}

export function themeBase(mode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return THEME_MAP.get(mode)?.base ?? (prefersDark ? "dark" : "light");
}

/** 命名主题给 `<html data-tone>`，基础明暗给 `data-theme`。 */
export function applyTheme(mode: ThemeMode, prefersDark: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = themeBase(mode, prefersDark);
  if (THEME_MAP.has(mode) && mode !== "system" && mode !== "light" && mode !== "dark") {
    root.dataset.tone = mode;
  } else {
    delete root.dataset.tone;
  }
}
