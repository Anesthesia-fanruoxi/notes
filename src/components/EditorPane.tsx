import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";

import { markViewTab, setActiveEditorView } from "../editor/activeView";
import { resolveEditorBackground } from "../editor/background";
import { applyLanguage, createEditorState, createEditorView, setLivePreview } from "../editor/createEditor";
import { closeLivePreviewPopovers } from "../editor/livePreview";
import { handleEditorUpdate } from "../editor/handleUpdate";
import {
  findLanguageByName,
  languageLabel,
  loadLanguage,
  matchLanguageByFilename,
  PLAIN_TEXT,
} from "../editor/languages";
import { getTabState, putTabState } from "../editor/tabStates";
import { tierFor, tierHint } from "../editor/tiers";
import {
  ignoreExternalChange,
  reloadTabFromDisk,
  removeMissingRecord,
  restoreDeletedFile,
} from "../lib/documents";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

/**
 * 唯一的 CodeMirror 挂载点。整个应用只有一个 EditorView，
 * 切换标签靠 setState 换 EditorState（PROMPT §3.1）。
 */
export default function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const prevTabIdRef = useRef<string | null>(null);

  const activeTab = useAppStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const activeTabId = activeTab?.id ?? null;
  const filename = activeTab?.filename;
  const override = activeTab?.languageOverride;
  const tier = activeTab ? tierFor(activeTab.sizeBytes, activeTab.truncated) : "full";
  const hint = tierHint(tier);
  const editorBackground = useAppStore((state) => state.editorBackground);
  const editorBg = resolveEditorBackground(editorBackground);
  const livePreview = useAppStore((s) => s.livePreview);
  const isMarkdown = /\.(md|markdown)$/i.test(filename ?? "");
  const shouldLive = isMarkdown && livePreview;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = createEditorView(host, handleEditorUpdate);
    viewRef.current = view;
    setActiveEditorView(view);

    return () => {
      closeLivePreviewPopovers();
      const previous = prevTabIdRef.current;
      if (previous) putTabState(previous, view.state);
      markViewTab(null);
      setActiveEditorView(null);
      view.destroy();
      viewRef.current = null;
      prevTabIdRef.current = null;
    };
  }, []);

  // 切标签：先回存旧 state，再换成目标标签的 state。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeTabId) return;

    const previous = prevTabIdRef.current;
    const previousStillOpen =
      previous !== null && useAppStore.getState().tabs.some((tab) => tab.id === previous);

    // 关掉的标签不再回存，避免 Map 里留死数据。
    if (previous && previous !== activeTabId && previousStillOpen) {
      putTabState(previous, view.state);
    }

    const state =
      getTabState(activeTabId) ??
      createEditorState("", handleEditorUpdate, tier, shouldLive);
    putTabState(activeTabId, state);
    closeLivePreviewPopovers();
    view.setState(state);
    view.focus();
    markViewTab(activeTabId);

    prevTabIdRef.current = activeTabId;

    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const store = useAppStore.getState();
    store.setCursor(line.number, head - line.from + 1);
    store.setSelectionChars(
      state.selection.main.empty ? 0 : state.selection.main.to - state.selection.main.from,
    );
    store.setDocSize(state.doc.length);
  }, [activeTabId, tier]);

  // 语言：按文件名自动识别，或用手动覆盖值。异步加载，不阻塞挂载。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeTabId) return;

    // 精简档 / 纯文本档没有语言槽，直接按纯文本显示。
    if (tier !== "full") {
      useAppStore.getState().setLanguageLabel(activeTabId, "纯文本");
      return;
    }

    const desc =
      override === PLAIN_TEXT
        ? null
        : override
          ? findLanguageByName(override)
          : matchLanguageByFilename(filename);

    useAppStore.getState().setLanguageLabel(activeTabId, languageLabel(desc));

    // 先清空，避免上一个标签的高亮残留到切换瞬间。
    applyLanguage(view, null);
    if (!desc) return;

    let cancelled = false;
    loadLanguage(desc).then((support) => {
      if (cancelled || !support) return;
      // 加载完成时用户可能已经切走，别把语言塞进别的标签。
      if (useAppStore.getState().activeTabId !== activeTabId) return;
      const current = viewRef.current;
      if (!current) return;
      applyLanguage(current, support);
      putTabState(activeTabId, current.state);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTabId, filename, override, tier]);

  // 源码 ↔ 实时渲染：只重配一个 compartment，保留撤销栈。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeTabId) return;
    setLivePreview(view, shouldLive);
    putTabState(activeTabId, view.state);
  }, [shouldLive, activeTabId]);

  return (
    <main
      className={styles.pane}
      data-editor-tone={editorBg.tone ?? undefined}
      style={editorBg.color ? { backgroundColor: editorBg.color } : undefined}
    >
      {hint && <div className={styles.tierBar}>{hint}</div>}
      {activeTab?.missing && activeTab.path ? (
        <div className={clsx(styles.externalBar, styles.externalDanger)}>
          <span>「{activeTab.title}」已从磁盘删除，编辑器里是最后一份副本。</span>
          <button
            type="button"
            className={styles.externalBtn}
            onClick={() => void restoreDeletedFile(activeTab.id)}
          >
            恢复文件
          </button>
          <button
            type="button"
            className={styles.externalBtn}
            onClick={() => void removeMissingRecord(activeTab.id)}
          >
            删除记录
          </button>
        </div>
      ) : (
        activeTab?.external &&
        activeTab.path && (
          <div className={styles.externalBar}>
            <span>「{activeTab.title}」已被外部修改，当前编辑的是副本。</span>
            <button
              type="button"
              className={styles.externalBtn}
              onClick={() => void reloadTabFromDisk(activeTab.id)}
            >
              重新加载
            </button>
            <button
              type="button"
              className={styles.externalBtn}
              onClick={() => void ignoreExternalChange(activeTab.id)}
            >
              保留当前
            </button>
          </div>
        )
      )}
      <div ref={hostRef} className={styles.editorHost} />
    </main>
  );
}
