import type { Text } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

/**
 * 全局快捷键（Ctrl+F 等）需要拿到唯一的可编辑 EditorView，
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

/** Markdown 预览是独立的只读视图，只登记，不参与编辑与正文读取。 */
let previewView: EditorView | null = null;

export function setPreviewView(view: EditorView | null): void {
  previewView = view;
}

export function getPreviewView(): EditorView | null {
  return previewView;
}

/** 源码视图的每笔修改原样应用到预览，保留预览的滚动位置。 */
export function syncPreviewChanges(update: ViewUpdate): void {
  const view = previewView;
  if (!view) return;
  if (!view.state.doc.eq(update.startState.doc)) {
    syncPreviewDoc(update.state.doc);
    return;
  }
  view.dispatch({ changes: update.changes });
}

/** 切标签或整篇替换时，把预览整篇对齐到给定正文。 */
export function syncPreviewDoc(doc: Text): void {
  const view = previewView;
  if (!view || view.state.doc.eq(doc)) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
}
