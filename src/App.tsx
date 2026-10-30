import { useEffect, type PointerEvent as ReactPointerEvent } from "react";

import ChatPanel from "./components/ChatPanel";
import CloseConfirmDialog from "./components/CloseConfirmDialog";
import EditorPane from "./components/EditorPane";
import LibrarySidebar from "./components/LibrarySidebar";
import QuickOpen from "./components/QuickOpen";
import SaveToLibraryDialog from "./components/SaveToLibraryDialog";
import SettingsDialog from "./components/SettingsDialog";
import StatusBar from "./components/StatusBar";
import TabBar from "./components/TabBar";
import VersionDialog from "./components/VersionDialog";
import { getActiveEditorView } from "./editor/activeView";
import { createEditorState } from "./editor/createEditor";
import { handleEditorUpdate } from "./editor/handleUpdate";
import { openFind } from "./editor/search";
import { putTabState } from "./editor/tabStates";
import {
  activeTab,
  exportTab,
  openPaths,
  pickAndOpenFiles,
  pickDirectory,
  refreshLibrary,
  saveActiveTab,
} from "./lib/documents";
import { applyGlobalShortcut } from "./lib/globalShortcut";
import { ipc } from "./lib/ipc";
import { writePref } from "./lib/prefs";
import { addTempTab } from "./lib/scratch";
import { answerClose, closeActiveTab, confirmExit } from "./lib/tabActions";
import { useAppStore } from "./store/useAppStore";
import styles from "./styles/app.module.css";

export default function App() {
  const aiOpen = useAppStore((s) => s.aiOpen);
  const dialog = useAppStore((s) => s.dialog);
  const toggleAi = useAppStore((s) => s.toggleAi);
  const toggleLivePreview = useAppStore((s) => s.toggleLivePreview);
  const livePreview = useAppStore((s) => s.livePreview);
  const cycleTab = useAppStore((s) => s.cycleTab);
  const openDialog = useAppStore((s) => s.openDialog);

  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const aiWidth = useAppStore((s) => s.aiWidth);
  const themeMode = useAppStore((s) => s.themeMode);
  const fontSize = useAppStore((s) => s.fontSize);
  const lineHeight = useAppStore((s) => s.lineHeight);
  const editorBackground = useAppStore((s) => s.editorBackground);
  const globalShortcut = useAppStore((s) => s.globalShortcut);
  const closeToTray = useAppStore((s) => s.closeToTray);

  // 启动：拉库、恢复临时文档、处理命令行文件。
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let libraryLoaded = false;
      try {
        await refreshLibrary();
        libraryLoaded = true;
      } catch (err) {
        console.warn("[library] 初始化失败", err);
      }

      try {
        const scratches = await ipc.listScratch();
        useAppStore.getState().setScratchDocs(scratches);
        let restored = 0;
        for (const item of scratches.slice(0, 10)) {
          const doc = await ipc.readScratch(item.tabId);
          const name = item.path ? item.path.split(/[\\/]/).pop() ?? item.title : item.title;
          useAppStore.getState().addRestoredTab(item.tabId, {
            title: item.title,
            kind: "temp",
            filename: name,
            scratchSource: item.source,
            path: item.path ?? undefined,
            encoding: doc.encoding,
            hasBom: doc.hasBom,
            lineEnding: doc.lineEnding,
            sizeBytes: doc.sizeBytes,
          });
          putTabState(item.tabId, createEditorState(doc.content, handleEditorUpdate));
          restored += 1;
        }

        // 恢复出来的内容接管界面时，把启动时那个空白标签收掉。
        if (restored > 0) {
          const state = useAppStore.getState();
          const blank = state.tabs.find(
            (tab) => tab.kind === "temp" && !tab.dirty && tab.title.startsWith("未命名"),
          );
          if (blank && state.tabs.length > 1) state.closeTab(blank.id);
        }
      } catch (err) {
        console.warn("[scratch] 恢复失败", err);
      }

      // 常驻文档的草稿快照不再在启动时弹窗：打开文档时自动接着改。
      // 只清理索引里已经不存在的手残留快照。
      try {
        const recoveries = await ipc.listRecovery();
        const known = new Set(useAppStore.getState().docs.map((doc) => doc.id));
        for (const item of recoveries) {
          if (!known.has(item.docId) && libraryLoaded) {
            await ipc.dropRecovery(item.docId).catch(() => undefined);
          }
        }
      } catch (err) {
        console.warn("[recovery] 扫描失败", err);
      }

      try {
        const args = await ipc.takeCliArgs();
        const files = args.filter((arg) => arg && !arg.startsWith("-"));
        if (files.length > 0 && !cancelled) {
          await openPaths(files);
        }
      } catch {
        // 命令行参数不是必需能力，失败不打扰用户。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 外部修改检测：窗口重新聚焦或切换标签时比对文件 mtime。
  useEffect(() => {
    let checking = false;
    const check = async () => {
      if (checking) return;
      const state = useAppStore.getState();
      const tab = state.tabs.find((item) => item.id === state.activeTabId);
      if (!tab?.path || tab.diskMtime === undefined) return;
      checking = true;
      try {
        const mtime = await ipc.fileMtime(tab.path);
        if (mtime === null) {
          useAppStore.getState().updateTab(tab.id, { missing: true, external: false });
        } else if (mtime !== tab.diskMtime) {
          useAppStore.getState().updateTab(tab.id, { external: true, missing: false });
        }
      } catch {
        // 读不到文件信息就不打扰。
      } finally {
        checking = false;
      }
    };
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (prev.activeTabId !== state.activeTabId) void check();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, []);

  // 主题：system 跟随系统，手动锁定。
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const mode = useAppStore.getState().themeMode;
      const dark = mode === "dark" || (mode === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const dark = themeMode === "dark" || (themeMode === "system" && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [themeMode]);

  // 只改 CSS 变量，不重建 EditorState。
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--editor-line-height", String(lineHeight));
  }, [fontSize, lineHeight]);

  useEffect(() => {
    writePref("sidebarWidth", sidebarWidth);
    writePref("sidebarCollapsed", sidebarCollapsed);
    writePref("aiWidth", aiWidth);
    writePref("themeMode", themeMode);
    writePref("fontSize", fontSize);
    writePref("lineHeight", lineHeight);
    writePref("editorBackground", editorBackground);
    writePref("globalShortcut", globalShortcut);
    writePref("closeToTray", closeToTray);
    writePref("livePreview", livePreview);
  }, [
    sidebarWidth,
    sidebarCollapsed,
    aiWidth,
    themeMode,
    fontSize,
    lineHeight,
    editorBackground,
    globalShortcut,
    closeToTray,
    livePreview,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;

      if (!(event.ctrlKey || event.metaKey)) {
        if (event.key === "Escape") {
          const state = useAppStore.getState();
          if (state.closePrompt) answerClose("cancel");
          else if (state.dialog !== "none") state.openDialog("none");
          else if (state.aiOpen) state.toggleAi();
        }
        return;
      }

      // 等用户处理未保存确认时，不要让快捷键在弹层后面改状态。
      if (useAppStore.getState().closePrompt) return;

      const key = event.key.toLowerCase();

      switch (key) {
        // 无 Shift 的 Ctrl+/ 留给编辑器做注释切换，这里只抢 Shift 组合。
        case "/":
          if (!event.shiftKey) break;
          event.preventDefault();
          toggleAi();
          break;
        case "v":
          if (!event.shiftKey) break;
          // 只有 Markdown 有实时渲染态，其它文件不响应（保留纯文本粘贴）。
          if (!/\.(md|markdown)$/i.test(activeTab()?.filename ?? "")) break;
          event.preventDefault();
          toggleLivePreview();
          break;
        case ",":
          event.preventDefault();
          useAppStore.getState().setSettingsSection("general");
          openDialog("settings");
          break;
        case "n":
          event.preventDefault();
          addTempTab();
          break;
        case "p":
          event.preventDefault();
          openDialog("quickopen");
          break;
        case "o":
          event.preventDefault();
          void pickAndOpenFiles();
          break;
        case "s":
          event.preventDefault();
          if (event.shiftKey) {
            void (async () => {
              const tab = activeTab();
              if (tab?.kind === "library" && tab.docId) {
                const dir = await pickDirectory("导出到文件夹");
                if (!dir) return;
                const name = await exportTab(tab.id, dir);
                if (name) window.alert(`已导出：${name}`);
              } else {
                openDialog("save");
              }
            })();
          } else {
            void saveActiveTab().catch((err) =>
              window.alert(err instanceof Error ? err.message : "保存失败"),
            );
          }
          break;
        case "w":
          event.preventDefault();
          closeActiveTab();
          break;
        case "f":
        case "h": {
          const view = getActiveEditorView();
          if (view) {
            event.preventDefault();
            openFind(view);
          }
          break;
        }
        case "tab":
          event.preventDefault();
          cycleTab(event.shiftKey ? -1 : 1);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAi, cycleTab, openDialog, toggleLivePreview]);

  // 关闭窗口：默认收进托盘；设置为退出时逐个确认脏标签。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let confirming = false;
    let exiting = false;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const stop = await win.onCloseRequested(async (event) => {
          if (exiting) return;
          if (confirming) {
            event.preventDefault();
            return;
          }

          if (useAppStore.getState().closeToTray) {
            event.preventDefault();
            await win.hide();
            return;
          }

          const dirty = useAppStore.getState().tabs.some((tab) => tab.dirty);
          if (!dirty) return;

          event.preventDefault();
          confirming = true;
          const ok = await confirmExit();
          confirming = false;
          if (!ok) return;

          exiting = true;
          await ipc.quitApp();
        });

        if (disposed) stop();
        else unlisten = stop;
      } catch (err) {
        console.warn("[exit] 无法监听窗口关闭", err);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 全局唤起键，改设置后自动换绑。
  useEffect(() => {
    applyGlobalShortcut(globalShortcut);
  }, [globalShortcut]);

  // 拖拽入窗：文件 → 临时文档，多文件多标签。
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            void openPaths(event.payload.paths);
          }
        });
        if (disposed) unlisten();
        else stop = unlisten;
      } catch (err) {
        console.warn("[drop] 监听失败", err);
      }
    })();

    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  // 单实例转发参数 / 托盘菜单。
  useEffect(() => {
    let disposed = false;
    let stops: (() => void)[] = [];

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisteners = await Promise.all([
          listen<string[]>("cli://open", (event) => {
            void openPaths(event.payload);
          }),
          listen("app://new-doc", () => {
            addTempTab();
          }),
          listen("app://quit", async () => {
            const ok = await confirmExit();
            if (ok) await ipc.quitApp();
          }),
        ]);
        if (disposed) unlisteners.forEach((fn) => fn());
        else stops = unlisteners;
      } catch (err) {
        console.warn("[events] 监听失败", err);
      }
    })();

    return () => {
      disposed = true;
      stops.forEach((fn) => fn());
    };
  }, []);

  const startResize =
    (kind: "side" | "ai") => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const state = useAppStore.getState();
      const startWidth = kind === "side" ? state.sidebarWidth : state.aiWidth;

      document.body.classList.add("dragging");

      const onMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const store = useAppStore.getState();
        if (kind === "side") {
          store.setSidebarWidth(startWidth + delta);
        } else {
          store.setAiWidth(startWidth - delta);
        }
      };

      const onUp = () => {
        document.body.classList.remove("dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

  return (
    <div className={styles.app}>
      <div className={styles.body}>
        {sidebarCollapsed ? (
          <div className={styles.sidebarRail}>
            <button
              type="button"
              className={styles.railBtn}
              title="展开文档库"
              aria-label="展开文档库"
              onClick={toggleSidebar}
            >
              »
            </button>
            <span className={styles.railLabel}>文档库</span>
          </div>
        ) : (
          <>
            <LibrarySidebar />
            <div
              className={styles.resizer}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整文档库宽度"
              onPointerDown={startResize("side")}
              onDoubleClick={() => useAppStore.getState().setSidebarWidth(240)}
            />
          </>
        )}

        <div className={styles.mainCol}>
          <TabBar />
          <div className={styles.editorRow}>
            <EditorPane />

            {aiOpen && (
              <>
                <div
                  className={styles.resizer}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整 AI 面板宽度"
                  onPointerDown={startResize("ai")}
                  onDoubleClick={() => useAppStore.getState().setAiWidth(356)}
                />
                <ChatPanel />
              </>
            )}
          </div>
        </div>
      </div>

      <StatusBar />

      {dialog === "save" && <SaveToLibraryDialog />}
      {dialog === "versions" && <VersionDialog />}
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "quickopen" && <QuickOpen />}
      <CloseConfirmDialog />
    </div>
  );
}
