import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { commonLanguages, PLAIN_TEXT } from "../editor/languages";
import { isMarkdownTab } from "../lib/format";
import { FONT_SIZES, useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";
import FontFamilySwitcher from "./FontFamilySwitcher";
import ThemeSwitcher from "./ThemeSwitcher";

const FONT_MENU_WIDTH = 112;

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
  const fontSize = useAppStore((s) => s.fontSize);
  const toggleAi = useAppStore((s) => s.toggleAi);
  const livePreview = useAppStore((s) => s.livePreview);
  const toggleLivePreview = useAppStore((s) => s.toggleLivePreview);
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
  const isMarkdown = isMarkdownTab(activeTab);
  const isReadOnly = activeTab?.readOnlyFile === true;

  const [fontMenu, setFontMenu] = useState<{
    left: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const [fontMenuClosing, setFontMenuClosing] = useState(false);
  const [fontPulse, setFontPulse] = useState(false);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const fontMenuRef = useRef<HTMLDivElement>(null);
  const selectedFontRef = useRef<HTMLButtonElement>(null);
  const fontCloseTimer = useRef(0);
  const fontPulseTimer = useRef(0);

  const closeFontMenu = () => {
    if (!fontMenu || fontMenuClosing) return;
    setFontMenuClosing(true);
    window.clearTimeout(fontCloseTimer.current);
    fontCloseTimer.current = window.setTimeout(() => {
      setFontMenu(null);
      setFontMenuClosing(false);
    }, 160);
  };

  const openFontMenu = () => {
    window.clearTimeout(fontCloseTimer.current);
    setFontMenuClosing(false);
    const button = fontButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setFontMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - FONT_MENU_WIDTH - 8)),
      bottom: window.innerHeight - rect.top + 6,
      maxHeight: Math.max(160, Math.min(340, rect.top - 16)),
    });
  };

  const toggleFontMenu = () => {
    if (fontMenu) closeFontMenu();
    else openFontMenu();
  };

  useEffect(() => {
    if (!fontMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (fontMenuRef.current?.contains(target)) return;
      if (fontButtonRef.current?.contains(target)) return;
      closeFontMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeFontMenu();
    };
    const onResize = () => closeFontMenu();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [fontMenu, fontMenuClosing]);

  useEffect(() => {
    if (fontMenu) selectedFontRef.current?.scrollIntoView({ block: "nearest" });
  }, [fontMenu]);

  useEffect(
    () => () => {
      window.clearTimeout(fontCloseTimer.current);
      window.clearTimeout(fontPulseTimer.current);
    },
    [],
  );

  const cycleFontSize = () => {
    if (fontMenu) closeFontMenu();
    const index = FONT_SIZES.indexOf(fontSize);
    const next = FONT_SIZES[(index + 1) % FONT_SIZES.length] ?? FONT_SIZES[0];
    setFontSize(next);
    setFontPulse(true);
    window.clearTimeout(fontPulseTimer.current);
    fontPulseTimer.current = window.setTimeout(() => setFontPulse(false), 220);
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
      {isReadOnly && (
        <>
          <span
            className={clsx(styles.statusItem, styles.statusReadonly)}
            title="大文件以只读方式打开"
          >
            只读
          </span>
          <span className={styles.sep} />
        </>
      )}

      <select
        className={clsx(styles.statusItem, styles.statusSelect)}
        value={languageValue}
        disabled={isReadOnly}
        title={
          isReadOnly
            ? "大文件只读模式不支持切换语言"
            : "语言：影响高亮，保存时同步文件后缀（仅当前标签）"
        }
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

      <ThemeSwitcher />
      <span className={styles.sep} />

      <FontFamilySwitcher />
      <span className={styles.sep} />

      <button
        ref={fontButtonRef}
        type="button"
        className={clsx(
          styles.statusItem,
          styles.statusClickable,
          styles.mono,
          fontPulse && styles.statusPulse,
        )}
        title={`字号：${fontSize}px（左键切换，右键选择）`}
        onClick={cycleFontSize}
        onContextMenu={(event) => {
          event.preventDefault();
          toggleFontMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            toggleFontMenu();
          }
        }}
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
        disabled={!isMarkdown || isReadOnly}
        title={
          isReadOnly
            ? "大文件以只读方式打开，不支持预览"
            : isMarkdown
              ? "Ctrl+Shift+V 切换预览 / 源码"
              : "仅 Markdown 文档或语言支持预览"
        }
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
          className={clsx(styles.fontMenu, fontMenuClosing && styles.menuClosing)}
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
                  closeFontMenu();
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
