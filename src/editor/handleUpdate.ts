import type { ViewUpdate } from "@codemirror/view";

import { useAppStore } from "../store/useAppStore";
import { scheduleScratch } from "./autosave";

/**
 * 编辑器的唯一 update 监听：只往 store 写元数据（光标、大小、脏标记），
 * 正文始终留在 EditorState 里。抽出来是为了让 dev 样例入口也能复用。
 */
export function handleEditorUpdate(update: ViewUpdate): void {
  const state = update.state;

  if (update.selectionSet || update.docChanged) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    useAppStore.getState().setCursor(line.number, head - line.from + 1);
  }

  if (update.docChanged) {
    const store = useAppStore.getState();
    if (store.activeTabId) {
      store.markDirty(store.activeTabId);
      scheduleScratch(store.activeTabId);
    }
    store.setDocSize(state.doc.length);
  }
}
