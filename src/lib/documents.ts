import { open } from "@tauri-apps/plugin-dialog";

import { getActiveEditorView } from "../editor/activeView";
import { createEditorState } from "../editor/createEditor";
import { handleEditorUpdate } from "../editor/handleUpdate";
import { cancelScratch } from "../editor/autosave";
import { readTabContent } from "../editor/content";
import { stopRecovery } from "../editor/recovery";
import { dropTabState, putTabState } from "../editor/tabStates";
import { tierFor } from "../editor/tiers";
import { useAppStore, type TabMeta } from "../store/useAppStore";
import { forgetTempAiState } from "./ai";
import { ipc } from "./ipc";
import { openScratchRecord, refreshScratch } from "./scratch";

export function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

export function stemName(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "txt";
}

export async function refreshLibrary(): Promise<void> {
  const index = await ipc.listLibrary();
  useAppStore.getState().setLibrary(index.categories, index.docs);
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      // 同一个文件只保留一条临时记录：已记录过就直接打开它。
      const known = useAppStore.getState().scratchDocs.find((item) => item.path === path);
      if (known) {
        await openScratchRecord(known);
        continue;
      }

      const name = baseName(path);
      const doc = await ipc.readTextFile(path);
      const mtime = await ipc.fileMtime(path).catch(() => null);
      const id = useAppStore.getState().addTab({
        title: name,
        kind: "temp",
        filename: name,
        scratchSource: "file",
        path,
        diskMtime: mtime ?? undefined,
        encoding: doc.encoding,
        hasBom: doc.hasBom,
        lineEnding: doc.lineEnding,
        sizeBytes: doc.sizeBytes,
        truncated: doc.truncated,
      });
      putTabState(
        id,
        createEditorState(doc.content, handleEditorUpdate, tierFor(doc.sizeBytes, doc.truncated)),
      );
      // 打开即有内容，但不算用户改动。
      useAppStore.getState().updateTab(id, { dirty: false });
      // 落一条记录，关掉标签后仍能从侧栏找到这个文件。
      void ipc
        .saveScratch({
          tabId: id,
          title: name,
          content: doc.content,
          encoding: doc.encoding,
          hasBom: doc.hasBom,
          lineEnding: doc.lineEnding,
          source: "file",
          path,
        })
        .then(refreshScratch)
        .catch((err) => console.warn("[scratch] 记录失败", err));
    } catch (err) {
      console.warn("[open] 无法打开", path, err);
    }
  }
}

export async function pickAndOpenFiles(): Promise<void> {
  const picked = await open({
    multiple: true,
    title: "打开文件",
    filters: [{ name: "文本", extensions: ["txt", "md", "log", "json", "csv", "ts", "js", "py", "go", "rs"] }],
  });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  await openPaths(paths);
}

export async function openLibraryDoc(docId: string): Promise<void> {
  const existing = useAppStore.getState().tabs.find((tab) => tab.docId === docId);
  if (existing) {
    useAppStore.getState().setActiveTab(existing.id);
    return;
  }

  const meta = useAppStore.getState().docs.find((doc) => doc.id === docId);
  const doc = await ipc.readDoc(docId);

  // 库内正文只有保存才覆盖；没保存的改动在 recovery 快照里，打开时直接接着改。
  let content = doc.content;
  let draft = false;
  try {
    const snapshot = await ipc.readRecovery(docId);
    if (snapshot && snapshot.content !== doc.content) {
      content = snapshot.content;
      draft = true;
    }
  } catch {
    // 没有快照，按库内正文打开。
  }

  const id = useAppStore.getState().addTab({
    title: meta?.title ?? "未命名",
    kind: "library",
    docId,
    filename: meta ? `${meta.title}.${meta.extension}` : undefined,
    encoding: doc.encoding,
    hasBom: doc.hasBom,
    lineEnding: doc.lineEnding,
    sizeBytes: doc.sizeBytes,
    truncated: doc.truncated,
    dirty: draft,
  });
  putTabState(
    id,
    createEditorState(content, handleEditorUpdate, tierFor(doc.sizeBytes, doc.truncated)),
  );
  useAppStore.getState().updateTab(id, { dirty: draft });
}

export async function saveLibraryTab(tabId: string): Promise<void> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.docId) return;

  const content = readTabContent(tabId);
  const meta = await ipc.writeDoc(
    tab.docId,
    content,
    tab.encoding,
    tab.hasBom,
    tab.lineEnding,
  );
  // 写回成功，恢复快照已无意义（Rust 侧也会删，这里再兜一次在途写入）。
  stopRecovery(tabId);
  void ipc.dropRecovery(tab.docId).catch(() => undefined);
  useAppStore.getState().updateTab(tabId, {
    dirty: false,
    sizeBytes: meta.sizeBytes,
  });
  await refreshLibrary();
}

/** Ctrl+S：常驻直接写回，临时弹「保存到文档库」。 */
export async function saveActiveTab(): Promise<void> {
  const state = useAppStore.getState();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return;

  if (tab.kind === "library") {
    await saveLibraryTab(tab.id);
  } else if (tab.path) {
    await saveTempFile(tab.id);
  } else {
    state.openDialog("save");
  }
}

/** 临时文档 Ctrl+S：把当前副本写回原文件（只在这一刻覆盖磁盘）。 */
export async function saveTempFile(tabId: string): Promise<void> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.path) return;

  const content = readTabContent(tabId);
  await ipc.writeTextFile(tab.path, content, tab.encoding, tab.hasBom, tab.lineEnding);
  cancelScratch(tabId);
  // 保存后副本与文件一致，继续留一份快照，重开应用仍是这一版。
  void ipc
    .saveScratch({
      tabId,
      title: tab.title,
      content,
      encoding: tab.encoding,
      hasBom: tab.hasBom,
      lineEnding: tab.lineEnding,
      source: tab.scratchSource ?? "file",
      path: tab.path,
    })
    .then(refreshScratch)
    .catch((err) => console.warn("[scratch] 保存后同步失败", err));

  const mtime = await ipc.fileMtime(tab.path).catch(() => null);
  useAppStore.getState().updateTab(tabId, {
    dirty: false,
    external: false,
    missing: false,
    diskMtime: mtime ?? undefined,
  });
}

/** 磁盘文件被删掉后，用编辑器里的副本把它写回去。 */
export async function restoreDeletedFile(tabId: string): Promise<void> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.path) return;

  const content = readTabContent(tabId);
  await ipc.writeTextFile(tab.path, content, tab.encoding, tab.hasBom, tab.lineEnding);
  const mtime = await ipc.fileMtime(tab.path).catch(() => null);
  useAppStore.getState().updateTab(tabId, {
    dirty: false,
    missing: false,
    external: false,
    diskMtime: mtime ?? undefined,
  });
}

/** 文件已删除时选择只删记录：清掉副本和侧栏条目，关掉标签。 */
export async function removeMissingRecord(tabId: string): Promise<void> {
  await ipc.dropScratch(tabId).catch(() => undefined);
  await refreshScratch();

  const state = useAppStore.getState();
  if (state.tabs.some((tab) => tab.id === tabId)) {
    forgetTempAiState(tabId);
    dropTabState(tabId);
    state.closeTab(tabId);
  }
}

/** 外部改动后重新加载：丢弃当前修改，删掉旧快照并按磁盘内容重建。 */
export async function reloadTabFromDisk(tabId: string): Promise<void> {
  const state = useAppStore.getState();
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab?.path) return;

  const doc = await ipc.readTextFile(tab.path);
  const next = createEditorState(
    doc.content,
    handleEditorUpdate,
    tierFor(doc.sizeBytes, doc.truncated),
  );
  putTabState(tabId, next);
  const view = getActiveEditorView();
  if (view && state.activeTabId === tabId) view.setState(next);

  cancelScratch(tabId);
  await ipc.dropScratch(tabId).catch(() => undefined);
  await ipc
    .saveScratch({
      tabId,
      title: tab.title,
      content: doc.content,
      encoding: doc.encoding,
      hasBom: doc.hasBom,
      lineEnding: doc.lineEnding,
      source: tab.scratchSource ?? "file",
      path: tab.path,
    })
    .catch((err) => console.warn("[scratch] 重建副本失败", err));
  await refreshScratch();

  const mtime = await ipc.fileMtime(tab.path).catch(() => null);
  useAppStore.getState().updateTab(tabId, {
    dirty: false,
    external: false,
    missing: false,
    diskMtime: mtime ?? undefined,
    encoding: doc.encoding,
    hasBom: doc.hasBom,
    lineEnding: doc.lineEnding,
    sizeBytes: doc.sizeBytes,
  });
}

/** 外部改动提示条上的「保留当前」：只把基线 mtime 推到最新。 */
export async function ignoreExternalChange(tabId: string): Promise<void> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.path) return;
  const mtime = await ipc.fileMtime(tab.path).catch(() => null);
  useAppStore.getState().updateTab(tabId, {
    external: false,
    diskMtime: mtime ?? tab.diskMtime,
  });
}

export async function saveTempToLibrary(
  tabId: string,
  title: string,
  categoryId: string,
): Promise<void> {
  const state = useAppStore.getState();
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) return;

  const content = readTabContent(tabId);
  const extension = tab.filename ? extensionOf(tab.filename) : "md";
  const meta = await ipc.createDoc({
    title,
    categoryId,
    extension,
    content,
    encoding: tab.encoding,
    hasBom: tab.hasBom,
    lineEnding: tab.lineEnding,
  });

  state.updateTab(tabId, {
    kind: "library",
    docId: meta.id,
    title: meta.title,
    dirty: false,
    sizeBytes: meta.sizeBytes,
  });
  cancelScratch(tabId);
  await ipc.dropScratch(tabId).catch(() => undefined);
  await refreshScratch();
  await refreshLibrary();
}

export async function exportTab(tabId: string, targetDir: string): Promise<string | null> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.docId) return null;
  return ipc.exportDoc(tab.docId, targetDir);
}

export async function pickDirectory(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

export function activeTab(): TabMeta | undefined {
  const state = useAppStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}
