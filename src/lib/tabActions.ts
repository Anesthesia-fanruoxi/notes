import { cancelScratch, flushScratchNow } from "../editor/autosave";
import { flushRecoveryNow, stopRecovery } from "../editor/recovery";
import { dropTabState } from "../editor/tabStates";
import { useAppStore } from "../store/useAppStore";
import { forgetTempAiState } from "./ai";

/**
 * 关闭 / 退出：所有未保存内容都落快照（临时文件落 scratch，常驻落 recovery），
 * 一律不弹确认，下次打开直接接着改。
 */

/** 兼容旧确认框：现在关闭不再询问，这里只负责收掉残留的弹层状态。 */
export function answerClose(_choice?: "save" | "discard" | "cancel"): void {
  useAppStore.getState().setClosePrompt(null);
}

let saveResolver: ((saved: boolean) => void) | null = null;

/** SaveToLibraryDialog 保存成功 / 取消时调用（关闭流程已不再等待它）。 */
export function resolveSaveToLibrary(saved: boolean): void {
  const resolve = saveResolver;
  saveResolver = null;
  resolve?.(saved);
}

function cleanupTab(id: string): void {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return;

  // 临时文档：关闭标签只收起视图，文件留在临时目录，由侧栏记录管理。
  if (tab.kind === "temp") {
    cancelScratch(id);
    forgetTempAiState(id);
  }
  if (tab.docId) {
    stopRecovery(id);
  }
  dropTabState(id);
}

export async function confirmCloseTab(id: string): Promise<boolean> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return true;

  // 关闭标签只收起视图：临时文件落 scratch，常驻文档落 recovery 快照，
  // 下次打开仍是这一版，所以一律不弹确认。
  if (tab.kind === "temp") {
    await flushScratchNow(id);
  } else {
    await flushRecoveryNow(id);
  }
  cleanupTab(id);
  useAppStore.getState().closeTab(id);
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
 * 退出应用：所有未保存的改动都落快照，不弹确认。
 * 下次打开文档时直接接着改（临时文件同理）。
 */
export async function confirmExit(): Promise<boolean> {
  const tabs = useAppStore.getState().tabs;
  await Promise.all(
    tabs.map((tab) =>
      tab.kind === "temp" ? flushScratchNow(tab.id) : flushRecoveryNow(tab.id),
    ),
  );
  return true;
}
