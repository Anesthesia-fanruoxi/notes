import { createEditorState } from "../editor/createEditor";
import { handleEditorUpdate } from "../editor/handleUpdate";
import { dropTabState, putTabState } from "../editor/tabStates";
import { useAppStore } from "../store/useAppStore";
import { forgetTempAiState } from "./ai";
import { ipc } from "./ipc";
import type { ScratchDoc } from "./types";

/**
 * 临时文件记录：标签页关掉只是不展示，记录和文件都留在本机，
 * 侧栏「临时文档」以这里的记录为准。
 */

export async function refreshScratch(): Promise<void> {
  try {
    useAppStore.getState().setScratchDocs(await ipc.listScratch());
  } catch (err) {
    console.warn("[scratch] 列表刷新失败", err);
  }
}

function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/** + / Ctrl+N：立刻在临时目录落一个空文件，侧栏马上能看到记录。 */
export function addTempTab(): string {
  const state = useAppStore.getState();
  const used = new Set(state.tabs.map((tab) => tab.title));
  for (const item of state.scratchDocs) used.add(item.title);
  let index = 1;
  while (used.has(`未命名-${index}`)) index += 1;
  const title = `未命名-${index}`;

  const id = state.addTab({ title, scratchSource: "new" });
  void ipc
    .saveScratch({
      tabId: id,
      title,
      content: "",
      encoding: "UTF-8",
      hasBom: false,
      lineEnding: "LF",
      source: "new",
    })
    .then(refreshScratch)
    .catch((err) => console.warn("[scratch] 新建失败", err));
  return id;
}

/** 点侧栏记录：已打开就切过去，否则从临时区读出来开一个标签。 */
export async function openScratchRecord(record: ScratchDoc): Promise<void> {
  const state = useAppStore.getState();
  if (state.tabs.some((tab) => tab.id === record.tabId)) {
    state.setActiveTab(record.tabId);
    return;
  }

  try {
    const doc = await ipc.readScratch(record.tabId);
    const mtime = record.path ? await ipc.fileMtime(record.path).catch(() => null) : null;
    useAppStore.getState().addRestoredTab(record.tabId, {
      title: record.title,
      kind: "temp",
      filename: record.path ? baseName(record.path) : record.title,
      scratchSource: record.source,
      path: record.path ?? undefined,
      diskMtime: mtime ?? undefined,
      missing: record.path !== null && mtime === null,
      encoding: doc.encoding,
      hasBom: doc.hasBom,
      lineEnding: doc.lineEnding,
      sizeBytes: doc.sizeBytes,
      truncated: doc.truncated,
    });
    putTabState(record.tabId, createEditorState(doc.content, handleEditorUpdate));
    useAppStore.getState().setActiveTab(record.tabId);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "打开临时文件失败");
  }
}

/**
 * 侧栏记录右侧的 ×（确认由调用方负责）：
 * - + 新建的临时文件：删掉临时目录里的文件；
 * - 从磁盘打开的文件：只删记录，磁盘上的文件不动。
 */
export async function purgeScratchRecord(record: ScratchDoc): Promise<void> {
  await ipc.dropScratch(record.tabId);

  const state = useAppStore.getState();
  if (state.tabs.some((tab) => tab.id === record.tabId)) {
    forgetTempAiState(record.tabId);
    dropTabState(record.tabId);
    state.closeTab(record.tabId);
  }
  await refreshScratch();
}
