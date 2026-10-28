import { cancelScratch } from "../editor/autosave";
import { stopRecovery } from "../editor/recovery";
import { dropTabState } from "../editor/tabStates";
import { useAppStore, type CloseMode } from "../store/useAppStore";
import { forgetTempAiState } from "./ai";
import { saveLibraryTab } from "./documents";
import { ipc } from "./ipc";

/**
 * 关闭 / 退出前的唯一确认入口。
 * 确认框是应用内组件（CloseConfirmDialog），这里用 Promise 串行等待用户选择；
 * 临时文档选「保存到库」时复用 SaveToLibraryDialog，并等它真正保存完。
 */
type CloseChoice = "save" | "discard" | "cancel";

let closeResolver: ((choice: CloseChoice) => void) | null = null;
let saveResolver: ((saved: boolean) => void) | null = null;

function askClose(tabId: string, mode: CloseMode): Promise<CloseChoice> {
  // 已有确认框时忽略新的请求，避免覆盖正在等待的 Promise。
  if (closeResolver) return Promise.resolve("cancel");
  return new Promise((resolve) => {
    closeResolver = resolve;
    useAppStore.getState().setClosePrompt({ tabId, mode });
  });
}

/** CloseConfirmDialog 的三个按钮都走这里。 */
export function answerClose(choice: CloseChoice): void {
  useAppStore.getState().setClosePrompt(null);
  const resolve = closeResolver;
  closeResolver = null;
  resolve?.(choice);
}

function askSaveToLibrary(tabId: string): Promise<boolean> {
  if (saveResolver) return Promise.resolve(false);
  return new Promise((resolve) => {
    saveResolver = resolve;
    // 关闭非活动标签时也要让保存对话框展示正确的那篇。
    useAppStore.getState().setActiveTab(tabId);
    useAppStore.getState().openDialog("save");
  });
}

/** SaveToLibraryDialog 保存成功 / 取消时调用。 */
export function resolveSaveToLibrary(saved: boolean): void {
  const resolve = saveResolver;
  saveResolver = null;
  resolve?.(saved);
}

function cleanupTab(id: string): void {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return;

  if (tab.kind === "temp") {
    cancelScratch(id);
    forgetTempAiState(id);
    void ipc.dropScratch(id).catch(() => undefined);
  }
  if (tab.docId) {
    stopRecovery(id);
    void ipc.dropRecovery(tab.docId).catch(() => undefined);
  }
  dropTabState(id);
}

function closeNow(id: string): void {
  cleanupTab(id);
  useAppStore.getState().closeTab(id);
}

async function saveThenClose(id: string): Promise<boolean> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return true;

  if (tab.kind === "library") {
    try {
      await saveLibraryTab(id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "保存失败");
      return false;
    }
    return true;
  }

  return askSaveToLibrary(id);
}

export async function confirmCloseTab(id: string): Promise<boolean> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return true;

  if (tab.dirty) {
    const choice = await askClose(id, "close");
    if (choice === "cancel") return false;
    if (choice === "save" && !(await saveThenClose(id))) return false;
  }

  closeNow(id);
  return true;
}

export function requestCloseTab(id: string): void {
  void confirmCloseTab(id);
}

export function closeActiveTab(): void {
  const id = useAppStore.getState().activeTabId;
  if (id) requestCloseTab(id);
}

/**
 * 退出应用：逐个处理脏标签。先把所有选择问完，
 * 再统一执行丢弃，避免中途取消时把前面已经丢掉的内容弄丢。
 */
export async function confirmExit(): Promise<boolean> {
  const dirty = useAppStore
    .getState()
    .tabs.filter((tab) => tab.dirty)
    .map((tab) => tab.id);

  const discards: string[] = [];

  for (const id of dirty) {
    const current = useAppStore.getState().tabs.find((tab) => tab.id === id);
    if (!current?.dirty) continue;

    const choice = await askClose(id, "exit");
    if (choice === "cancel") return false;

    if (choice === "save") {
      if (!(await saveThenClose(id))) return false;
    } else {
      discards.push(id);
    }
  }

  for (const id of discards) cleanupTab(id);
  return true;
}
