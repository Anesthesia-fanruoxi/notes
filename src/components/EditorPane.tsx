import clsx from "clsx";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EditorView } from "@codemirror/view";

import LargeFileViewer from "./LargeFileViewer";
import MarkdownOutline from "./MarkdownOutline";
import WelcomePane from "./WelcomePane";

import {
  markViewTab,
  setActiveEditorView,
  setPreviewEnabled,
  setPreviewView,
  syncPreviewDoc,
} from "../editor/activeView";
import { resolveEditorBackground } from "../editor/background";
import {
  applyLanguage,
  createEditorState,
  createEditorView,
  createPreviewView,
} from "../editor/createEditor";
import { handleEditorUpdate } from "../editor/handleUpdate";
import {
  findLanguageByName,
  languageLabel,
  loadLanguage,
  matchLanguageByFilename,
  PLAIN_TEXT,
} from "../editor/languages";
import { livePreviewExtension, type TableBlock } from "../editor/livePreview";
import { scanHeadings, type Heading } from "../editor/outline";
import { getTabState, putTabState } from "../editor/tabStates";
import { tierFor, tierHint } from "../editor/tiers";
import { isMarkdownTab } from "../lib/format";
import {
  ignoreExternalChange,
  reloadTabFromDisk,
  removeMissingRecord,
  restoreDeletedFile,
} from "../lib/documents";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

/**
 * 唯一的可编辑 CodeMirror 挂载点。切换标签靠 setState 换 EditorState（PROMPT §3.1）。
 * Markdown 另有独立的只读预览视图：代码模式左右分栏，预览模式只留右侧。
 */
export default function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewViewRef = useRef<EditorView | null>(null);
  const prevTabIdRef = useRef<string | null>(null);
  const splitSyncRef = useRef<{ live: boolean; tabId: string | null }>({
    live: false,
    tabId: null,
  });
  const jumpingRef = useRef(false);
  const jumpSeqRef = useRef(0);
  const jumpTimerRef = useRef(0);

  const activeTab = useAppStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const activeTabId = activeTab?.id ?? null;
  const filename = activeTab?.filename;
  const override = activeTab?.languageOverride;
  const tier = activeTab ? tierFor(activeTab.sizeBytes, activeTab.truncated) : "full";
  const hint = tierHint(tier);
  const editorBackground = useAppStore((state) => state.editorBackground);
  const editorBg = resolveEditorBackground(editorBackground);
  const livePreview = useAppStore((s) => s.livePreview);
  const outlineWidth = useAppStore((s) => s.outlineWidth);
  const docVersion = useAppStore((s) => s.docVersion);
  const isMarkdown = isMarkdownTab(activeTab);
  const isReadOnly = activeTab?.readOnlyFile === true;
  // 只有完整档的 Markdown 才值得再挂一个预览视图；大文件降级时保留源码。
  const hasPreview = isMarkdown && tier === "full";
  const showSource = !hasPreview || !livePreview;
  const showOutline = hasPreview && livePreview;
  const [outline, setOutline] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState<number | null>(null);
  const [collapsedHeadings, setCollapsedHeadings] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  /** 非 md 后延迟卸载目录，先让收起动画走完。 */
  const [previewMounted, setPreviewMounted] = useState(hasPreview);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = createEditorView(host, handleEditorUpdate);
    viewRef.current = view;
    setActiveEditorView(view);

    return () => {
      const previous = prevTabIdRef.current;
      if (previous) putTabState(previous, view.state);
      markViewTab(null);
      setActiveEditorView(null);
      view.destroy();
      viewRef.current = null;
      prevTabIdRef.current = null;
    };
  }, []);

  // 预览是独立视图：源码负责编辑，它只负责渲染，文档由 handleUpdate 同步。
  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;

    const view = createPreviewView(host);
    previewViewRef.current = view;
    setPreviewView(view);

    return () => {
      setPreviewView(null);
      setPreviewEnabled(false);
      view.destroy();
      previewViewRef.current = null;
    };
  }, []);

  // 预览挂载/收起：非 md 时保留 DOM 约 1.1s，让收起动画走完再卸载目录。
  useEffect(() => {
    if (hasPreview) {
      setPreviewMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setPreviewMounted(false), 1100);
    return () => window.clearTimeout(timer);
  }, [hasPreview]);

  // 只有 Markdown 标签参与预览同步；非 md 时保留最后一份内容用于收起动画。
  useEffect(() => {
    setPreviewEnabled(hasPreview);
    if (!hasPreview || !activeTabId) return;
    const state = getTabState(activeTabId);
    if (state) syncPreviewDoc(state.doc);
  }, [hasPreview, activeTabId]);

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

    const store = useAppStore.getState();
    const tab = store.tabs.find((item) => item.id === activeTabId);

    // 大文件只读：不建 EditorState，编辑器视图留在上一个标签上并隐藏。
    if (tab?.readOnlyFile) {
      prevTabIdRef.current = null;
      markViewTab(null);
      setPreviewEnabled(false);
      store.setCursor(1, 1);
      store.setSelectionChars(0);
      store.setDocSize(tab.sizeBytes);
      return;
    }

    const previewForTab = tier === "full" && isMarkdownTab(tab);
    setPreviewEnabled(previewForTab);

    const state =
      getTabState(activeTabId) ?? createEditorState("", handleEditorUpdate, tier);
    putTabState(activeTabId, state);
    view.setState(state);
    if (previewForTab) syncPreviewDoc(state.doc);
    markViewTab(activeTabId);

    prevTabIdRef.current = activeTabId;

    const previewOnly = previewForTab && store.livePreview;
    if (previewOnly) previewViewRef.current?.focus();
    else view.focus();

    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    store.setCursor(line.number, head - line.from + 1);
    store.setSelectionChars(
      state.selection.main.empty ? 0 : state.selection.main.to - state.selection.main.from,
    );
    store.setDocSize(state.doc.length);
  }, [activeTabId, tier]);

  // 预览目录：标题行号与预览文档一致，编辑/切标签时重扫。
  useEffect(() => {
    if (!hasPreview) {
      // 收起动画期间保留旧目录，动画结束再清空。
      const timer = window.setTimeout(() => {
        setOutline([]);
        setActiveHeading(null);
      }, 1100);
      return () => window.clearTimeout(timer);
    }
    const view = viewRef.current;
    if (!view) return;
    const next = scanHeadings(view.state.doc);
    setOutline(next);
    setActiveHeading((current) =>
      next.some((heading) => heading.line === current)
        ? current
        : (next[0]?.line ?? null),
    );
    // 文档改过之后，已经不存在的标题不该继续留着折叠状态。
    setCollapsedHeadings((current) => {
      if (current.size === 0) return current;
      const lines = new Set(next.map((heading) => heading.line));
      const kept = [...current].filter((line) => lines.has(line));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [hasPreview, activeTabId, docVersion]);

  // 折叠状态按标签隔离，切走后回来是全部展开。
  useEffect(() => {
    setCollapsedHeadings(new Set());
  }, [activeTabId]);

  // 语言：按文件名自动识别，或用手动覆盖值。异步加载，不阻塞挂载。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeTabId || isReadOnly) return;

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
  }, [activeTabId, filename, override, tier, isReadOnly]);

  // 预览也按 Markdown 解析，保证代码块内部与源码同色。
  useEffect(() => {
    if (!hasPreview) return;
    const desc = findLanguageByName("Markdown");
    if (!desc) return;

    let cancelled = false;
    loadLanguage(desc).then((support) => {
      if (cancelled || !support) return;
      const view = previewViewRef.current;
      if (view) applyLanguage(view, support);
    });

    return () => {
      cancelled = true;
    };
  }, [hasPreview]);

  // 切换源码 / 预览：焦点交给当前可见的那一侧。
  useEffect(() => {
    if (!activeTabId || isReadOnly) return;
    if (hasPreview && livePreview) previewViewRef.current?.focus();
    else viewRef.current?.focus();
  }, [activeTabId, hasPreview, livePreview, isReadOnly]);

  // 左右显隐后重新测量，隐藏期间 CodeMirror 量不到正确宽度。
  useEffect(() => {
    window.clearTimeout(jumpTimerRef.current);
    jumpSeqRef.current += 1;
    jumpingRef.current = false;
    const preview = previewViewRef.current;
    if (preview) {
      preview.scrollDOM.style.scrollBehavior = "";
      preview.requestMeasure();
    }
    viewRef.current?.requestMeasure();
  }, [activeTabId, hasPreview, livePreview]);

  useEffect(
    () => () => {
      window.clearTimeout(jumpTimerRef.current);
      jumpSeqRef.current += 1;
    },
    [],
  );

  // Markdown 分栏：按文档位置双向同步滚动；表格按行精确对齐，避免整块表格停住。
  useEffect(() => {
    const source = viewRef.current;
    const preview = previewViewRef.current;
    const previous = splitSyncRef.current;
    splitSyncRef.current = { live: livePreview, tabId: activeTabId };

    if (!source || !preview || !hasPreview || livePreview || isReadOnly) return;

    const sourceScroller = source.scrollDOM;
    const previewScroller = preview.scrollDOM;
    let lock: "source" | "preview" | null = null;
    let timer = 0;
    let retryRaf = 0;
    let pinRaf = 0;
    let pinSerial = 0;
    let active = true;

    const release = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lock = null;
      }, 150);
    };

    const topLineOf = (view: EditorView): number => {
      const rect = view.scrollDOM.getBoundingClientRect();
      const height = (rect.top - view.documentTop) / (view.scaleY || 1);
      return view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0, height)).from).number;
    };

    const tableAt = (line: number): TableBlock | null => {
      const tables = preview.state.field(livePreviewExtension, false)?.tables ?? [];
      return tables.find((table) => line >= table.start && line <= table.end) ?? null;
    };

    const tableDom = (start: number): HTMLElement | null =>
      preview.contentDOM.querySelector(`.cm-md-table[data-table-start="${start}"]`);

    const scrollToPos = (view: EditorView, pos: number) => {
      const block = view.lineBlockAt(pos);
      const rect = view.scrollDOM.getBoundingClientRect();
      view.scrollDOM.scrollTop +=
        view.documentTop + block.top * (view.scaleY || 1) - rect.top;
    };

    const scrollToRow = (table: TableBlock, rowIndex: number): boolean => {
      const row = tableDom(table.start)?.querySelector<HTMLTableSectionElement>("tbody")
        ?.rows[rowIndex];
      if (!row) return false;
      const rect = previewScroller.getBoundingClientRect();
      previewScroller.scrollTop += row.getBoundingClientRect().top - rect.top;
      return true;
    };

    const maxScroll = (view: EditorView) =>
      Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);

    const setScroll = (view: EditorView, top: number) => {
      if (Math.abs(view.scrollDOM.scrollTop - top) > 1) view.scrollDOM.scrollTop = top;
    };

    // 滚到底后 CM 会继续渲染末尾内容，scrollHeight 还会长；多钉几帧直到稳定。
    const pinBottom = (view: EditorView) => {
      const serial = ++pinSerial;
      let attempts = 4;
      const apply = () => {
        pinRaf = 0;
        if (!active || serial !== pinSerial) return;
        setScroll(view, maxScroll(view));
        attempts -= 1;
        if (attempts > 0) pinRaf = window.requestAnimationFrame(apply);
      };
      apply();
    };

    const sourceToPreview = () => {
      const line = topLineOf(source);
      const table = tableAt(line);
      if (!table) {
        scrollToPos(preview, source.state.doc.line(line).from);
        return;
      }
      if (line < table.start + 2) {
        scrollToPos(preview, preview.state.doc.line(table.start).from);
        return;
      }

      const rowIndex = line - (table.start + 2);
      if (scrollToRow(table, rowIndex)) return;

      // 预览还没渲染到表格块：先到表格顶部，下一帧再按行对齐。
      scrollToPos(preview, preview.state.doc.line(table.start).from);
      window.cancelAnimationFrame(retryRaf);
      retryRaf = window.requestAnimationFrame(() => {
        retryRaf = 0;
        if (active && scrollToRow(table, rowIndex)) release();
      });
    };

    const previewToSource = () => {
      const line = topLineOf(preview);
      const table = tableAt(line);
      if (!table) {
        scrollToPos(source, preview.state.doc.line(line).from);
        return;
      }

      const tbody = tableDom(table.start)?.querySelector<HTMLTableSectionElement>("tbody");
      if (!tbody || tbody.rows.length === 0) {
        scrollToPos(source, source.state.doc.line(table.start).from);
        return;
      }

      const rect = previewScroller.getBoundingClientRect();
      if (tbody.rows[0].getBoundingClientRect().top - 1 > rect.top) {
        scrollToPos(source, source.state.doc.line(table.start).from);
        return;
      }

      let lo = 0;
      let hi = tbody.rows.length - 1;
      let found = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tbody.rows[mid].getBoundingClientRect().top <= rect.top) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      scrollToPos(source, source.state.doc.line(table.start + 2 + found).from);
    };

    // 两侧内容总高度不同，顶部/底部必须吸附，否则一边到底另一边还没到底。
    const syncFromSource = () => {
      pinSerial += 1;
      if (sourceScroller.scrollTop <= 0) {
        setScroll(preview, 0);
        return;
      }
      if (sourceScroller.scrollTop >= maxScroll(source) - 10) {
        pinBottom(preview);
        return;
      }
      sourceToPreview();
    };
    const syncFromPreview = () => {
      pinSerial += 1;
      if (previewScroller.scrollTop <= 0) {
        setScroll(source, 0);
        return;
      }
      if (previewScroller.scrollTop >= maxScroll(preview) - 10) {
        pinBottom(source);
        return;
      }
      previewToSource();
    };

    const onSource = () => {
      if (lock === "preview") return;
      lock = "source";
      release();
      syncFromSource();
    };
    const onPreview = () => {
      if (lock === "source") return;
      lock = "preview";
      release();
      syncFromPreview();
    };

    sourceScroller.addEventListener("scroll", onSource, { passive: true });
    previewScroller.addEventListener("scroll", onPreview, { passive: true });

    // 从整页预览切回分栏时，以刚才阅读的位置为准；其余情况以源码位置为准。
    const fromPreview = previous.live && !livePreview && previous.tabId === activeTabId;
    if (fromPreview) {
      lock = "preview";
      syncFromPreview();
    } else {
      lock = "source";
      syncFromSource();
    }
    release();

    return () => {
      active = false;
      window.cancelAnimationFrame(retryRaf);
      window.cancelAnimationFrame(pinRaf);
      sourceScroller.removeEventListener("scroll", onSource);
      previewScroller.removeEventListener("scroll", onPreview);
      window.clearTimeout(timer);
    };
  }, [hasPreview, livePreview, isReadOnly, activeTabId]);

  // 目录当前项：跟随预览顶部所在标题。
  useEffect(() => {
    const preview = previewViewRef.current;
    if (!preview || !showOutline) return;

    const scroller = preview.scrollDOM;
    const update = () => {
      // 目录跳转的滑动期间不让高亮跟着中途标题跑，等落位后再跟随。
      if (jumpingRef.current) return;
      const rect = scroller.getBoundingClientRect();
      const height = (rect.top - preview.documentTop) / (preview.scaleY || 1);
      const line = preview.state.doc.lineAt(
        preview.lineBlockAtHeight(Math.max(0, height)).from,
      ).number;

      let active = outline[0]?.line ?? null;
      for (const heading of outline) {
        if (heading.line <= line + 1) active = heading.line;
        else break;
      }
      setActiveHeading((current) => (current === active ? current : active));
    };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [showOutline, outline, activeTabId]);

  const startOutlineResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = outlineWidth;
    document.body.classList.add("dragging");

    const onMove = (moveEvent: PointerEvent) => {
      useAppStore.getState().setOutlineWidth(startWidth + moveEvent.clientX - startX);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // 等最后一帧宽度落定后再恢复过渡，避免松手时又滑一下。
      window.requestAnimationFrame(() => document.body.classList.remove("dragging"));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const jumpToHeading = (line: number) => {
    const preview = previewViewRef.current;
    if (!preview) return;
    const scroller = preview.scrollDOM;
    const headingLine = Math.min(line, preview.state.doc.lines);
    const pos = preview.state.doc.line(headingLine).from;

    jumpingRef.current = true;
    setActiveHeading(headingLine);

    const seq = ++jumpSeqRef.current;
    window.clearTimeout(jumpTimerRef.current);

    // 长文里没渲染到的表格/代码块只能按估算高度定位，直接算 scrollTop 会偏。
    // 交给 CodeMirror 先把目标行渲染测量出来再滚动，它内部会修正到准确位置。
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.style.scrollBehavior = reduceMotion ? "" : "smooth";

    const settle = (attempt: number) => {
      if (jumpSeqRef.current !== seq) return;
      const coords = preview.coordsAtPos(pos);
      if (coords) {
        const delta = coords.top - scroller.getBoundingClientRect().top;
        const atBottom =
          scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
        // 文档末尾的标题到不了顶部，这是正常的，不再补偿。
        if (!atBottom && Math.abs(delta) > 1 && attempt < 3) {
          scroller.scrollTop += delta;
          jumpTimerRef.current = window.setTimeout(() => settle(attempt + 1), 180);
          return;
        }
      } else if (attempt < 3) {
        // 目标还没渲染出来，等 CM 量完下一帧再校验。
        jumpTimerRef.current = window.setTimeout(() => settle(attempt + 1), 180);
        return;
      }
      jumpingRef.current = false;
    };

    let finished = false;
    const finish = () => {
      if (finished || jumpSeqRef.current !== seq) return;
      finished = true;
      window.clearTimeout(jumpTimerRef.current);
      scroller.removeEventListener("scrollend", finish);
      // 动画结束后先关掉 smooth，落点补偿改为即时对齐，避免再排队一段动画。
      scroller.style.scrollBehavior = "";
      jumpTimerRef.current = window.setTimeout(() => settle(0), 100);
    };

    scroller.addEventListener("scrollend", finish, { once: true });
    // 不支持 scrollend 的 WebView 用超时兜底。
    jumpTimerRef.current = window.setTimeout(finish, 1800);

    preview.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 0 }),
    });
  };

  const toggleHeading = (line: number) => {
    setCollapsedHeadings((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  return (
    <main
      className={styles.pane}
      data-editor-tone={editorBg.tone ?? undefined}
      style={
        editorBg.color
          ? ({
              backgroundColor: editorBg.color,
              "--editor-bg": editorBg.color,
            } as CSSProperties)
          : undefined
      }
    >
      {hint && !isReadOnly && <div className={styles.tierBar}>{hint}</div>}
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
      {!activeTab && <WelcomePane />}
      <div
        className={styles.editorSplit}
        style={
          isReadOnly || !activeTab
            ? { display: "none" }
            : undefined
        }
      >
        {previewMounted && (
          <div
            className={clsx(styles.outlineHost, showOutline && styles.outlineHostOpen)}
            style={{ "--outline-width": `${outlineWidth}px` } as CSSProperties}
            aria-hidden={!showOutline}
          >
            <MarkdownOutline
              headings={outline}
              activeLine={activeHeading}
              collapsed={collapsedHeadings}
              onJump={jumpToHeading}
              onToggle={toggleHeading}
            />
          </div>
        )}
        {previewMounted && (
          <div
            className={clsx(
              styles.outlineSplitter,
              showOutline && styles.outlineSplitterOpen,
            )}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整目录宽度"
            onPointerDown={startOutlineResize}
            onDoubleClick={() => useAppStore.getState().setOutlineWidth(260)}
          >
            <span className={styles.outlineGrip} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        <div
          ref={hostRef}
          className={clsx(styles.editorHost, !showSource && styles.editorHostClosed)}
        />
        <div
          ref={previewHostRef}
          className={clsx(
            styles.previewHost,
            hasPreview && !livePreview && styles.previewSplit,
            !hasPreview && styles.previewHostClosed,
          )}
          aria-hidden={!hasPreview}
        />
      </div>
      {isReadOnly && activeTab?.path && (
        <LargeFileViewer key={activeTab.id} tabId={activeTab.id} path={activeTab.path} />
      )}
    </main>
  );
}
