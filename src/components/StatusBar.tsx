import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { commonLanguages, PLAIN_TEXT } from "../editor/languages";
import { FONT_SIZES, useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

const THEME_LABEL = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
} as const;

const FONT_MENU_WIDTH = 188;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const categories = useAppStore((s) => s.categories);
  const docs = useAppStore((s) => s.docs);
  const cursor = useAppStore((s) => s.cursor);
  const docSize = useAppStore((s) => s.docSize);
  const aiOpen = useAppStore((s) => s.aiOpen);
  const themeMode = useAppStore((s) => s.themeMode);
  const fontSize = useAppStore((s) => s.fontSize);
  const toggleAi = useAppStore((s) => s.toggleAi);
  const livePreview = useAppStore((s) => s.livePreview);
  const toggleLivePreview = useAppStore((s) => s.toggleLivePreview);
  const cycleTheme = useAppStore((s) => s.cycleTheme);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const setLanguageOverride = useAppStore((s) => s.setLanguageOverride);
  const openDialog = useAppStore((s) => s.openDialog);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeDoc = activeTab?.docId ? docs.find((doc) => doc.id === activeTab.docId) : undefined;
  const languageValue = activeTab?.languageOverride ?? "auto";
  const autoLabel = activeTab?.languageLabel ?? "纯文本";
  const categoryName = activeDoc
    ? categories.find((category) => category.id === activeDoc.categoryId)?.name ?? "未分类"
    : "临时";
  const isMarkdown = /\.(md|markdown)$/i.test(activeTab?.filename ?? "");

  const [fontMenu, setFontMenu] = useState<{
    left: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const fontMenuRef = useRef<HTMLDivElement>(null);
  const selectedFontRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!fontMenu) return;
    const close = () => setFontMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (fontMenuRef.current?.contains(target)) return;
      if (fontButtonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onResize = () => close();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [fontMenu]);

  useEffect(() => {
    if (fontMenu) selectedFontRef.current?.scrollIntoView({ block: "nearest" });
  }, [fontMenu]);

  const toggleFontMenu = () => {
    if (fontMenu) {
      setFontMenu(null);
      return;
    }
    const button = fontButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setFontMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - FONT_MENU_WIDTH - 8)),
      bottom: window.innerHeight - rect.top + 6,
      maxHeight: Math.max(160, Math.min(340, rect.top - 16)),
    });
  };

  return (
    <footer className={styles.status}>
      <span className={styles.statusItem} title="所属分类">
        {categoryName}
      </span>
      <span className={styles.sep} />

      <span className={styles.statusItem}>{activeTab?.encoding ?? "UTF-8"}</span>
      <span className={styles.sep} />
      <span className={styles.statusItem}>{activeTab?.lineEnding ?? "LF"}</span>
      <span className={styles.sep} />

      <select
        className={clsx(styles.statusItem, styles.statusSelect)}
        value={languageValue}
        title="语法高亮语言（仅当前标签）"
        onChange={(event) => {
          if (!activeTab) return;
          const value = event.target.value;
          setLanguageOverride(activeTab.id, value === "auto" ? undefined : value);
        }}
      >
        <option value="auto">自动 · {autoLabel}</option>
        <option value={PLAIN_TEXT}>纯文本</option>
        {commonLanguages.map((desc) => (
          <option key={desc.name} value={desc.name}>
            {desc.name}
          </option>
        ))}
      </select>

      <span className={styles.sep} />
      <span className={clsx(styles.statusItem, styles.mono)}>
        行 {cursor.line}, 列 {cursor.col}
      </span>
      <span className={styles.sep} />
      <span className={clsx(styles.statusItem, styles.mono)}>{formatSize(docSize)}</span>

      <span className={styles.spacer} />

      {activeTab?.dirty && (
        <span className={clsx(styles.statusItem, styles.statusDirty)}>
          <span className={styles.mdot} />已修改
        </span>
      )}

      {activeTab?.kind === "library" && (
        <>
          <button
            type="button"
            className={clsx(styles.statusItem, styles.statusClickable)}
            title="版本快照（AI 修改与还原前自动留档）"
            onClick={() => openDialog("versions")}
          >
            版本
          </button>
          <span className={styles.sep} />
        </>
      )}

      <button
        type="button"
        className={clsx(styles.statusItem, styles.statusClickable)}
        title={`主题：${THEME_LABEL[themeMode]}（点击切换）`}
        onClick={cycleTheme}
      >
        {THEME_LABEL[themeMode]}
      </button>
      <span className={styles.sep} />

      <button
        ref={fontButtonRef}
        type="button"
        className={clsx(styles.statusItem, styles.statusClickable, styles.mono)}
        title="字号（8–32px）"
        onClick={toggleFontMenu}
      >
        {fontSize}px
      </button>
      <span className={styles.sep} />

      <button
        type="button"
        className={clsx(
          styles.statusItem,
          styles.statusClickable,
          livePreview && isMarkdown && styles.statusOn,
        )}
        disabled={!isMarkdown}
        title={isMarkdown ? "Ctrl+Shift+V 切换预览 / 源码" : "仅 Markdown 文档支持预览"}
        onClick={toggleLivePreview}
      >
        {livePreview && isMarkdown ? "预览" : "源码"}
      </button>
      <span className={styles.sep} />

      <button
        type="button"
        className={clsx(styles.statusItem, styles.statusClickable, aiOpen && styles.statusOn)}
        title="AI 面板（Ctrl+Shift+/）"
        onClick={toggleAi}
      >
        AI
      </button>
      <span className={styles.sep} />
      <button
        type="button"
        className={clsx(styles.statusItem, styles.statusClickable)}
        title="设置 · 文档库"
        onClick={() => openDialog("settings")}
      >
        ⚙
      </button>

      {fontMenu && (
        <div
          ref={fontMenuRef}
          className={styles.fontMenu}
          style={{
            left: fontMenu.left,
            bottom: fontMenu.bottom,
            maxHeight: fontMenu.maxHeight,
          }}
          role="listbox"
          aria-label="字号"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {FONT_SIZES.map((size) => {
            const selected = size === fontSize;
            return (
              <button
                key={size}
                ref={selected ? selectedFontRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                className={clsx(styles.fontOption, selected && styles.fontOptionActive)}
                onClick={() => {
                  setFontSize(size);
                  setFontMenu(null);
                }}
              >
                <span className={clsx(styles.fontDot, !selected && styles.fontDotHidden)} />
                <span className={styles.fontValue}>{size}px</span>
                {size === 13 && <span className={styles.fontDefault}>默认</span>}
              </button>
            );
          })}
        </div>
      )}
    </footer>
  );
}
