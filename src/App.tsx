import { useEffect, type PointerEvent as ReactPointerEvent } from "react";

import ChatPanel from "./components/ChatPanel";
import EditorPane from "./components/EditorPane";
import LibrarySidebar from "./components/LibrarySidebar";
import SaveToLibraryDialog from "./components/SaveToLibraryDialog";
import SettingsDialog from "./components/SettingsDialog";
import StatusBar from "./components/StatusBar";
import TabBar from "./components/TabBar";
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
import { ipc } from "./lib/ipc";
import { writePref } from "./lib/prefs";
import { closeActiveTab } from "./lib/tabActions";
import { useAppStore } from "./store/useAppStore";
import styles from "./styles/app.module.css";

export default function App() {
  const aiOpen = useAppStore((s) => s.aiOpen);
  const dialog = useAppStore((s) => s.dialog);
  const toggleAi = useAppStore((s) => s.toggleAi);
  const addTab = useAppStore((s) => s.addTab);
  const cycleTab = useAppStore((s) => s.cycleTab);
  const openDialog = useAppStore((s) => s.openDialog);

  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const aiWidth = useAppStore((s) => s.aiWidth);
  const themeMode = useAppStore((s) => s.themeMode);
  const fontSize = useAppStore((s) => s.fontSize);
  const lineHeight = useAppStore((s) => s.lineHeight);

  // 启动：拉库、恢复临时文档、处理命令行文件。
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await refreshLibrary();
      } catch (err) {
        console.warn("[library] 初始化失败", err);
      }

      try {
        const scratches = await ipc.listScratch();
        let restored = 0;
        for (const item of scratches.slice(0, 10)) {
          const doc = await ipc.readScratch(item.tabId);
          useAppStore.getState().addRestoredTab(item.tabId, {
            title: item.title,
            kind: "temp",
            filename: item.title,
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

      try {
        const args = await ipc.takeCliArgs();
        const file = args.find((arg) => arg && !arg.startsWith("-"));
        if (file && !cancelled) {
          await openPaths([file]);
        }
      } catch {
        // 命令行参数不是必需能力，失败不打扰用户。
      }
    })();

    return () => {
      cancelled = true;
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
    writePref("aiWidth", aiWidth);
    writePref("themeMode", themeMode);
    writePref("fontSize", fontSize);
    writePref("lineHeight", lineHeight);
  }, [sidebarWidth, aiWidth, themeMode, fontSize, lineHeight]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;

      if (!(event.ctrlKey || event.metaKey)) {
        if (event.key === "Escape") {
          const state = useAppStore.getState();
          if (state.dialog !== "none") state.openDialog("none");
          else if (state.aiOpen) state.toggleAi();
        }
        return;
      }

      const key = event.key.toLowerCase();

      switch (key) {
        case "/":
          event.preventDefault();
          toggleAi();
          break;
        case "n":
          event.preventDefault();
          addTab({ title: "未命名" });
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
  }, [toggleAi, addTab, cycleTab, openDialog]);

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
      <TabBar />

      <div className={styles.body}>
        <LibrarySidebar />
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整文档库宽度"
          onPointerDown={startResize("side")}
          onDoubleClick={() => useAppStore.getState().setSidebarWidth(240)}
        />

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

      <StatusBar />

      {dialog === "save" && <SaveToLibraryDialog />}
      {dialog === "settings" && <SettingsDialog />}
    </div>
  );
}
