import { useEffect, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import type { LargeFileMeta } from "../lib/types";
import { DEFAULT_FONT_SIZE, useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

/** 浏览器能稳定承载的滚动高度上限；超过后按比例映射到行号。 */
const MAX_SCROLL_HEIGHT = 24_000_000;
const OVERSCAN = 10;

interface Props {
  tabId: string;
  path: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "无法读取大文件";
}

export default function LargeFileViewer({ tabId, path }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const requestRef = useRef(0);
  const rafRef = useRef(0);
  const anchorRef = useRef(0);
  const rowHeightRef = useRef(0);

  const lineHeight = useAppStore((s) => s.lineHeight);
  // 行高按编辑器 CSS 基准字号计算；整页缩放会同步放大，不能再用字号设置重复乘算。
  const rowHeight = Math.max(14, Math.round(DEFAULT_FONT_SIZE * lineHeight));

  const [meta, setMeta] = useState<LargeFileMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [anchorLine, setAnchorLine] = useState(0);
  const [windowFrom, setWindowFrom] = useState(0);
  const [windowLines, setWindowLines] = useState<string[]>([]);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [jumpValue, setJumpValue] = useState("");

  const totalLines = meta?.lineCount ?? 0;
  const naturalHeight = totalLines * rowHeight;
  const contentHeight = Math.min(naturalHeight, MAX_SCROLL_HEIGHT);
  const scaled = naturalHeight > contentHeight;
  const viewportRows = Math.max(8, Math.ceil(viewportHeight / rowHeight) + 2);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMeta(null);
    setWindowLines([]);
    setWindowFrom(0);
    setAnchorLine(0);
    anchorRef.current = 0;

    ipc
      .largeFileOpen(path)
      .then((next) => {
        if (cancelled) return;
        setMeta(next);
        useAppStore.getState().updateTab(tabId, {
          encoding: next.encoding,
          sizeBytes: next.sizeBytes,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorText(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, tabId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!meta) return;

    const from = Math.max(0, anchorLine - OVERSCAN);
    const available = meta.lineCount - from;
    if (available <= 0) {
      setWindowFrom(from);
      setWindowLines([]);
      setLoading(false);
      return;
    }

    const count = Math.min(available, viewportRows + OVERSCAN * 2);
    const request = requestRef.current + 1;
    requestRef.current = request;

    ipc
      .largeFileLines(path, from, count)
      .then((window) => {
        if (requestRef.current !== request) return;
        setWindowFrom(window.startLine);
        setWindowLines(window.lines);
        setLoading(false);
        if (!focusedRef.current) {
          focusedRef.current = true;
          scrollRef.current?.focus({ preventScroll: true });
        }
      })
      .catch((err) => {
        if (requestRef.current !== request) return;
        setError(errorText(err));
        setLoading(false);
      });
  }, [meta, anchorLine, viewportRows, path]);

  useEffect(() => {
    if (rowHeightRef.current === rowHeight) return;
    rowHeightRef.current = rowHeight;
    const element = scrollRef.current;
    if (!element || !meta) return;
    element.scrollTop = scrollForAnchor(anchorRef.current);
  }, [rowHeight, meta, totalLines, contentHeight, scaled]);

  useEffect(
    () => () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      requestRef.current += 1;
    },
    [],
  );

  function anchorForScroll(scrollTop: number): number {
    if (totalLines <= 0) return 0;
    const line = scaled
      ? Math.floor((scrollTop / Math.max(1, contentHeight)) * totalLines)
      : Math.floor(scrollTop / rowHeight);
    return Math.max(0, Math.min(totalLines - 1, line));
  }

  function scrollForAnchor(line: number): number {
    if (totalLines <= 0) return 0;
    const clamped = Math.max(0, Math.min(totalLines - 1, line));
    return scaled
      ? (clamped / totalLines) * contentHeight
      : clamped * rowHeight;
  }

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const element = scrollRef.current;
      if (!element) return;
      const next = anchorForScroll(element.scrollTop);
      if (next === anchorRef.current) return;
      anchorRef.current = next;
      setAnchorLine(next);
    });
  };

  const jumpToLine = () => {
    const parsed = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(parsed) || totalLines <= 0) return;
    const line = Math.max(0, Math.min(totalLines - 1, parsed - 1));
    anchorRef.current = line;
    setAnchorLine(line);
    const element = scrollRef.current;
    if (element) element.scrollTop = scrollForAnchor(line);
    setJumpValue("");
  };

  const anchorTop = scaled
    ? (anchorLine / Math.max(1, totalLines)) * contentHeight
    : anchorLine * rowHeight;
  const windowTop = Math.max(0, anchorTop - (anchorLine - windowFrom) * rowHeight);
  const gutterWidth = Math.max(
    44,
    String(Math.max(1, totalLines)).length * Math.ceil(DEFAULT_FONT_SIZE * 0.62) + 18,
  );

  return (
    <div className={styles.largeViewer}>
      <div className={styles.largeBar}>
        <span className={styles.largeReadonly}>只读</span>
        <span className={styles.largeMeta}>
          {formatSize(meta?.sizeBytes ?? 0)}
          {meta ? ` · ${meta.lineCount.toLocaleString()} 行 · ${meta.encoding}` : ""}
        </span>
        <span className={styles.largeBarSpacer} />
        <label className={styles.largeJumpLabel}>
          转到行
          <input
            className={styles.largeJumpInput}
            value={jumpValue}
            inputMode="numeric"
            aria-label="转到行"
            onChange={(event) => setJumpValue(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter") jumpToLine();
              if (event.key === "Escape") setJumpValue("");
            }}
          />
        </label>
        <button type="button" className={styles.largeJumpBtn} onClick={jumpToLine}>
          跳转
        </button>
      </div>

      <div className={styles.largeBody}>
        <div
          ref={scrollRef}
          className={styles.largeScroll}
          onScroll={onScroll}
          tabIndex={0}
        >
          <div className={styles.largeSpacer} style={{ height: contentHeight }}>
            <div className={styles.largeRows} style={{ top: windowTop }}>
              {windowLines.map((text, index) => {
                const lineNumber = windowFrom + index + 1;
                return (
                  <div
                    key={lineNumber}
                    className={styles.largeRow}
                    style={{ height: rowHeight }}
                  >
                    <span className={styles.largeNo} style={{ width: gutterWidth }}>
                      {lineNumber}
                    </span>
                    <span className={styles.largeText}>{text || " "}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {(loading || error) && (
          <div className={styles.largeNotice}>{error ?? "正在建立行索引…"}</div>
        )}
      </div>
    </div>
  );
}
