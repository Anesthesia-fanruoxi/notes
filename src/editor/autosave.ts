import { ipc } from "../lib/ipc";
import { refreshScratch } from "../lib/scratch";
import { useAppStore } from "../store/useAppStore";
import { getActiveEditorView } from "./activeView";
import { getTabState } from "./tabStates";

/**
 * 临时文档自动保存：停止输入 800ms 后写 scratch，
 * 不弹提示、不打断输入。常驻文档不自动覆盖，走 Ctrl+S。
 */
const timers = new Map<string, number>();

function currentContent(tabId: string): string | undefined {
  const state = useAppStore.getState();
  const view = getActiveEditorView();
  return view && state.activeTabId === tabId
    ? view.state.doc.toString()
    : getTabState(tabId)?.doc.toString();
}

async function writeScratch(tabId: string): Promise<void> {
  const current = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!current || current.kind !== "temp") return;
  const content = currentContent(tabId);
  if (content === undefined) return;

  await ipc.saveScratch({
    tabId,
    title: current.title,
    content,
    encoding: current.encoding,
    hasBom: current.hasBom,
    lineEnding: current.lineEnding,
    source: current.scratchSource ?? "new",
    path: current.path ?? null,
  });
}

export function scheduleScratch(tabId: string): void {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab || tab.kind !== "temp") return;

  const existing = timers.get(tabId);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    timers.delete(tabId);
    void writeScratch(tabId)
      .then(refreshScratch)
      .catch((err) => console.warn("[scratch] 保存失败", err));
  }, 800);

  timers.set(tabId, timer);
}

/** 关闭标签 / 退出前立刻落盘，别把最后几百毫秒的输入留在内存里。 */
export async function flushScratchNow(tabId: string): Promise<void> {
  cancelScratch(tabId);
  try {
    await writeScratch(tabId);
    await refreshScratch();
  } catch (err) {
    console.warn("[scratch] 关闭前保存失败", err);
  }
}

export function cancelScratch(tabId: string): void {
  const timer = timers.get(tabId);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(tabId);
  }
}
