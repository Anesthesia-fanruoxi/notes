import clsx from "clsx";

import {
  extensionColor,
  extensionLabel,
  suffixOfName,
} from "../lib/fileTypes";
import { addTempTab } from "../lib/scratch";
import { requestCloseTab } from "../lib/tabActions";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  // 已修改的标签排前面；同一组里保持原本顺序，避免无谓跳动。
  const orderedTabs = tabs
    .map((tab, index) => ({ tab, index }))
    .sort(
      (a, b) =>
        Number(b.tab.dirty) - Number(a.tab.dirty) || a.index - b.index,
    )
    .map(({ tab }) => tab);

  return (
    <div className={styles.tabbar} role="tablist" aria-label="打开的文档">
      {orderedTabs.map((tab) => {
        const active = tab.id === activeTabId;
        const ext = tab.filename ? suffixOfName(tab.filename) : null;
        const titleHasExt = !!ext && tab.title.toLowerCase().endsWith(`.${ext}`);
        const fullTitle = ext && !titleHasExt ? `${tab.title}.${ext}` : tab.title;
        const color = extensionColor(ext);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={tab.filename ?? tab.title}
            className={clsx(
              styles.tab,
              tab.kind === "temp" ? styles.tabTempKind : styles.tabLibraryKind,
              active && styles.tabActive,
            )}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                requestCloseTab(tab.id);
                return;
              }
              if (event.button === 0) setActiveTab(tab.id);
            }}
          >
            <span className={styles.tabState}>
              {tab.dirty && <span className={styles.dot} title="已修改" />}
            </span>
            <span className={styles.tabName}>{fullTitle}</span>
            {tab.kind === "temp" && <span className={styles.tabTemp}>临时</span>}
            <span
              className={styles.tabExt}
              style={{
                color,
                borderColor: `${color}66`,
                background: `${color}14`,
              }}
              title={ext ? `文件类型：.${ext}` : "无扩展名"}
            >
              {extensionLabel(ext)}
            </span>
            <button
              type="button"
              className={styles.tabClose}
              title="关闭标签"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => requestCloseTab(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className={styles.tabAdd}
        title="新建文档（Ctrl+N）"
        onClick={() => addTempTab()}
      >
        +
      </button>

      <span className={styles.tabSpacer} />
    </div>
  );
}
