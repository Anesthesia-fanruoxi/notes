import type { EditorState } from "@codemirror/state";

/**
 * 每个标签一份 EditorState，放在模块级 Map 里，不进 React（PROMPT §3.1）。
 * 只用一个 EditorView，切换标签时 setState 复用。
 */
const tabStates = new Map<string, EditorState>();

export function getTabState(tabId: string): EditorState | undefined {
  return tabStates.get(tabId);
}

export function putTabState(tabId: string, state: EditorState): void {
  tabStates.set(tabId, state);
}

export function dropTabState(tabId: string): void {
  tabStates.delete(tabId);
}

/** 调试用：DevTools 里 `__noteTabStates()` 看当前缓存数量。 */
export function tabStateCount(): number {
  return tabStates.size;
}
