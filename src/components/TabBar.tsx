import clsx from "clsx";

import { addTempTab } from "../lib/scratch";
import { requestCloseTab } from "../lib/tabActions";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className={styles.tabbar} role="tablist" aria-label="打开的文档">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
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
            <span className={styles.tabName}>{tab.title}</span>
            {tab.kind === "temp" && <span className={styles.tabTemp}>临时</span>}
            {tab.dirty && <span className={styles.dot} title="已修改" />}
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
