import { ipc } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import { readTabContent } from "./content";

/**
 * 常驻文档脏时每 5s 写一份 recovery/<docId>.snap（PROMPT §5.5）。
 * 只写快照，绝不覆盖库内正文；保存或正常关闭后清掉。
 */
export const RECOVERY_INTERVAL_MS = 5000;

const timers = new Map<string, number>();

function eligible(tabId: string) {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab || tab.kind !== "library" || !tab.docId || !tab.dirty) return null;
  return tab;
}

export function noteDirty(tabId: string): void {
  if (!eligible(tabId)) return;
  if (timers.has(tabId)) return;
  timers.set(tabId, window.setTimeout(() => void tick(tabId), RECOVERY_INTERVAL_MS));
}

async function tick(tabId: string): Promise<void> {
  // 写入期间保留 map 里的条目，避免重复排定时器。
  const tab = eligible(tabId);
  if (!tab) {
    timers.delete(tabId);
    return;
  }

  try {
    await ipc.saveRecovery({
      docId: tab.docId!,
      title: tab.title,
      content: readTabContent(tabId),
      encoding: tab.encoding,
      hasBom: tab.hasBom,
      lineEnding: tab.lineEnding,
    });
  } catch (err) {
    console.warn("[recovery] 快照写入失败", err);
  }

  if (!eligible(tabId)) {
    timers.delete(tabId);
    return;
  }
  timers.set(tabId, window.setTimeout(() => void tick(tabId), RECOVERY_INTERVAL_MS));
}

export function stopRecovery(tabId: string): void {
  const timer = timers.get(tabId);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(tabId);
  }
}

/** 关闭标签/退出前立刻落一份快照，避免最后 5s 的修改丢失。 */
export async function flushRecoveryNow(tabId: string): Promise<void> {
  const tab = eligible(tabId);
  if (!tab) return;
  try {
    await ipc.saveRecovery({
      docId: tab.docId!,
      title: tab.title,
      content: readTabContent(tabId),
      encoding: tab.encoding,
      hasBom: tab.hasBom,
      lineEnding: tab.lineEnding,
    });
  } catch (err) {
    console.warn("[recovery] 关闭前快照失败", err);
  }
  stopRecovery(tabId);
}
