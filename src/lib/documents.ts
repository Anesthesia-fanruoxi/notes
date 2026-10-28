import { open } from "@tauri-apps/plugin-dialog";

import { createEditorState } from "../editor/createEditor";
import { handleEditorUpdate } from "../editor/handleUpdate";
import { cancelScratch } from "../editor/autosave";
import { readTabContent } from "../editor/content";
import { stopRecovery } from "../editor/recovery";
import { putTabState } from "../editor/tabStates";
import { tierFor } from "../editor/tiers";
import { useAppStore, type TabMeta } from "../store/useAppStore";
import { ipc } from "./ipc";

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
      const name = baseName(path);
      const doc = await ipc.readTextFile(path);
      const id = useAppStore.getState().addTab({
        title: name,
        kind: "temp",
        filename: name,
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
  });
  putTabState(
    id,
    createEditorState(doc.content, handleEditorUpdate, tierFor(doc.sizeBytes, doc.truncated)),
  );
  useAppStore.getState().updateTab(id, { dirty: false });
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
  } else {
    state.openDialog("save");
  }
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
