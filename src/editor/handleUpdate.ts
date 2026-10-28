import type { ViewUpdate } from "@codemirror/view";

import { useAppStore } from "../store/useAppStore";
import { scheduleScratch } from "./autosave";
import { noteDirty } from "./recovery";

/**
 * 编辑器的唯一 update 监听：只往 store 写元数据（光标、大小、脏标记），
 * 正文始终留在 EditorState 里。抽出来是为了让 dev 样例入口也能复用。
 */
export function handleEditorUpdate(update: ViewUpdate): void {
  const state = update.state;

  if (update.selectionSet || update.docChanged) {
    const selection = state.selection.main;
    const line = state.doc.lineAt(selection.head);
    const store = useAppStore.getState();
    store.setCursor(line.number, selection.head - line.from + 1);
    store.setSelectionChars(selection.empty ? 0 : selection.to - selection.from);
  }

  if (update.docChanged) {
    const store = useAppStore.getState();
    if (store.activeTabId) {
      store.markDirty(store.activeTabId);
      scheduleScratch(store.activeTabId);
      noteDirty(store.activeTabId);
    }
    store.setDocSize(state.doc.length);
  }
}
