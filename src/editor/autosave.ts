import { ipc } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import { getActiveEditorView } from "./activeView";
import { getTabState } from "./tabStates";

/**
 * 临时文档自动保存：停止输入 800ms 后写 scratch，
 * 不弹提示、不打断输入。常驻文档不自动覆盖，走 Ctrl+S。
 */
const timers = new Map<string, number>();

export function scheduleScratch(tabId: string): void {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab || tab.kind !== "temp") return;

  const existing = timers.get(tabId);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    timers.delete(tabId);

    const state = useAppStore.getState();
    const current = state.tabs.find((item) => item.id === tabId);
    if (!current || current.kind !== "temp") return;

    const view = getActiveEditorView();
    const content =
      view && state.activeTabId === tabId
        ? view.state.doc.toString()
        : getTabState(tabId)?.doc.toString();
    if (content === undefined) return;

    ipc
      .saveScratch({
        tabId,
        title: current.title,
        content,
        encoding: current.encoding,
        hasBom: current.hasBom,
        lineEnding: current.lineEnding,
      })
      .catch((err) => console.warn("[scratch] 保存失败", err));
  }, 800);

  timers.set(tabId, timer);
}

export function cancelScratch(tabId: string): void {
  const timer = timers.get(tabId);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(tabId);
  }
}
