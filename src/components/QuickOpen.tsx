import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { openLibraryDoc } from "../lib/documents";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

interface Entry {
  key: string;
  title: string;
  meta: string;
  kind: "doc" | "temp";
  id: string;
}

/** Ctrl+P：库 + 临时区按标题过滤，全键盘可用。 */
export default function QuickOpen() {
  const closeDialog = useAppStore((s) => s.openDialog);
  const docs = useAppStore((s) => s.docs);
  const categories = useAppStore((s) => s.categories);
  const tabs = useAppStore((s) => s.tabs);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const library = docs.map((doc) => ({
      key: `doc-${doc.id}`,
      title: doc.title,
      meta: categories.find((item) => item.id === doc.categoryId)?.name ?? "未分类",
      kind: "doc" as const,
      id: doc.id,
    }));
    const temp = tabs
      .filter((tab) => tab.kind === "temp")
      .map((tab) => ({
        key: `tab-${tab.id}`,
        title: tab.title,
        meta: "临时文档",
        kind: "temp" as const,
        id: tab.id,
      }));
    return [...library, ...temp];
  }, [docs, categories, tabs]);

  const trimmed = query.trim().toLowerCase();
  const list = trimmed
    ? entries.filter((entry) => entry.title.toLowerCase().includes(trimmed))
    : entries;

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    closeDialog("none");
    if (entry.kind === "doc") {
      void openLibraryDoc(entry.id).catch((err) =>
        console.warn("[quick-open] 打开失败", err),
      );
    } else {
      setActiveTab(entry.id);
    }
  };

  useEffect(() => {
    setActive(0);
  }, [query]);

  return (
    <div className={styles.scrim} onMouseDown={() => closeDialog("none")}>
      <div className={styles.qoModal} onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className={styles.qoInput}
          value={query}
          placeholder="按标题搜索文档库与临时区…"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(list.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(list[active]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeDialog("none");
            }
          }}
        />

        <div className={styles.qoList}>
          {list.length === 0 ? (
            <div className={styles.qoEmpty}>没有匹配「{query}」的文档。</div>
          ) : (
            list.map((entry, index) => (
              <button
                key={entry.key}
                type="button"
                className={clsx(styles.qoItem, index === active && styles.qoActive)}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(entry)}
              >
                <span className={styles.qoTitle}>{entry.title}</span>
                <span className={styles.qoMeta}>{entry.meta}</span>
              </button>
            ))
          )}
        </div>

        <div className={styles.qoFoot}>
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
