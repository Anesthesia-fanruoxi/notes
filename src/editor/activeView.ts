import type { EditorView } from "@codemirror/view";

/**
 * 全局快捷键（Ctrl+F 等）需要拿到唯一的 EditorView，
 * 通过这里登记，避免在 React 树里层层传 ref。
 */
let activeView: EditorView | null = null;
/** view 当前真正加载的标签；切标签的 effect 跑完前会与 store 不一致。 */
let viewTabId: string | null = null;

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view;
  if (!view) viewTabId = null;
}

export function getActiveEditorView(): EditorView | null {
  return activeView;
}

export function markViewTab(tabId: string | null): void {
  viewTabId = tabId;
}

export function getActiveViewTabId(): string | null {
  return viewTabId;
}
