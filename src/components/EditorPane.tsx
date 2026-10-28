import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";

import { setActiveEditorView } from "../editor/activeView";
import { applyLanguage, createEditorState, createEditorView } from "../editor/createEditor";
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = createEditorView(host, handleEditorUpdate);
    viewRef.current = view;
    setActiveEditorView(view);

    return () => {
      const previous = prevTabIdRef.current;
      if (previous) putTabState(previous, view.state);
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

    const state = getTabState(activeTabId) ?? createEditorState("", handleEditorUpdate, tier);
    putTabState(activeTabId, state);
    view.setState(state);
    view.focus();

    prevTabIdRef.current = activeTabId;

    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const store = useAppStore.getState();
    store.setCursor(line.number, head - line.from + 1);
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

  return (
    <main className={styles.pane}>
      {hint && <div className={styles.tierBar}>{hint}</div>}
      <div ref={hostRef} className={styles.editorHost} />
    </main>
  );
}
