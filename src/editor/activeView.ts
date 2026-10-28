import type { EditorView } from "@codemirror/view";

/**
 * 全局快捷键（Ctrl+F 等）需要拿到唯一的 EditorView，
 * 通过这里登记，避免在 React 树里层层传 ref。
 */
let activeView: EditorView | null = null;

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view;
}

export function getActiveEditorView(): EditorView | null {
  return activeView;
}
