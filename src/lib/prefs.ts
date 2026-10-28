/**
 * 轻量 UI 偏好（主题、字号、面板宽度）。
 * 只放本地界面状态，不涉及任何文档内容或密钥。
 * P2 接设置页后仍然沿用这里，AI 配置走 keyring + plugin-store。
 */

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`note.pref.${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`note.pref.${key}`, JSON.stringify(value));
  } catch {
    // 无痕模式或配额满时静默降级，不影响编辑。
  }
}
