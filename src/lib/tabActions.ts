import { cancelScratch } from "../editor/autosave";
import { dropTabState } from "../editor/tabStates";
import { useAppStore } from "../store/useAppStore";
import { ipc } from "./ipc";

/**
 * 关闭标签的唯一入口：先确认，再清理 scratch / 缓存，再改元数据。
 * P3 会把 window.confirm 换成应用内对话框。
 */
export function requestCloseTab(id: string): void {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return;

  if (tab.dirty) {
    const message =
      tab.kind === "library"
        ? `「${tab.title}」有未保存改动，关闭后本次修改会丢失。`
        : `「${tab.title}」尚未保存到文档库，关闭后临时内容会删除。`;
    if (!window.confirm(message)) return;
  }

  if (tab.kind === "temp") {
    cancelScratch(id);
    ipc.dropScratch(id).catch(() => undefined);
  }

  dropTabState(id);
  useAppStore.getState().closeTab(id);
}

export function closeActiveTab(): void {
  const id = useAppStore.getState().activeTabId;
  if (id) requestCloseTab(id);
}
