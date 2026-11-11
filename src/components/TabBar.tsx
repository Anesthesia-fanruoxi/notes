import clsx from "clsx";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  extensionColor,
  extensionLabel,
  suffixOfName,
} from "../lib/fileTypes";
import { addTempTab } from "../lib/scratch";
import { closeTabs, requestCloseTab } from "../lib/tabActions";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";
import ContextMenu, { type MenuItem } from "./ContextMenu";

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const moveTab = useAppStore((s) => s.moveTab);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
  } | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 标签超宽时，滚轮在标签栏上横向滚动；Ctrl/⌘+滚轮仍留给字号缩放。
  const wheelTabs = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) return;
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    el.scrollLeft += delta;
  };

  // 切换标签时把激活标签滚进可视区。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const tabEl = container.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`,
    );
    if (!tabEl) return;
    const cont = container.getBoundingClientRect();
    const rect = tabEl.getBoundingClientRect();
    if (rect.left < cont.left) {
      container.scrollBy({ left: rect.left - cont.left - 4, behavior: "smooth" });
    } else if (rect.right > cont.right) {
      container.scrollBy({ left: rect.right - cont.right + 4, behavior: "smooth" });
    }
  }, [activeTabId, tabs]);

  const menuTabIndex = menu
    ? tabs.findIndex((tab) => tab.id === menu.tabId)
    : -1;

  const menuItems: MenuItem[] =
    menu && menuTabIndex >= 0
      ? (() => {
          const targetId = menu.tabId;
          const left = tabs.slice(0, menuTabIndex).map((tab) => tab.id);
          const right = tabs.slice(menuTabIndex + 1).map((tab) => tab.id);
          const others = tabs
            .filter((tab) => tab.id !== targetId)
            .map((tab) => tab.id);
          const clean = tabs.filter((tab) => !tab.dirty).map((tab) => tab.id);
          return [
            {
              label: "关闭所有未修改",
              disabled: clean.length === 0,
              onSelect: () => void closeTabs(clean),
            },
            {
              label: "关闭左侧标签",
              disabled: left.length === 0,
              onSelect: () => void closeTabs(left, targetId),
            },
            {
              label: "关闭右侧标签",
              disabled: right.length === 0,
              onSelect: () => void closeTabs(right, targetId),
            },
            {
              label: "关闭其他",
              disabled: others.length === 0,
              onSelect: () => void closeTabs(others, targetId),
            },
            {
              label: "关闭全部标签页",
              onSelect: () => void closeTabs(tabs.map((tab) => tab.id)),
            },
          ];
        })()
      : [];

  const removeGhost = () => {
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
  };

  const cleanupDrag = (element: HTMLElement, pointerId: number) => {
    dragRef.current = null;
    removeGhost();
    setDragId(null);
    setDropTarget(null);
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-tab-id]");
    const targetId = element?.dataset.tabId;
    let snapRect = event.currentTarget.getBoundingClientRect();

    if (state?.active && element && targetId && targetId !== state.id) {
      const rect = element.getBoundingClientRect();
      snapRect = rect;
      const side =
        event.clientX < rect.left + rect.width / 2 ? "before" : "after";
      moveTab(state.id, targetId, side);
    }

    const ghost = dragGhostRef.current;
    dragGhostRef.current = null;
    if (ghost && state?.active) {
      ghost.style.transition =
        "left 170ms cubic-bezier(0.22,1,0.36,1), top 170ms cubic-bezier(0.22,1,0.36,1), width 170ms cubic-bezier(0.22,1,0.36,1), height 170ms cubic-bezier(0.22,1,0.36,1), transform 170ms cubic-bezier(0.22,1,0.36,1), opacity 170ms ease";
      window.requestAnimationFrame(() => {
        ghost.style.left = `${snapRect.left}px`;
        ghost.style.top = `${snapRect.top}px`;
        ghost.style.width = `${snapRect.width}px`;
        ghost.style.height = `${snapRect.height}px`;
        ghost.style.transform = "scale(1) rotate(0deg)";
        ghost.style.opacity = "0";
      });
      window.setTimeout(() => ghost.remove(), 210);
    }

    cleanupDrag(event.currentTarget, event.pointerId);
  };

  return (
    <div
      className={styles.tabbar}
      role="tablist"
      aria-label="打开的文档"
      onWheel={wheelTabs}
    >
      <div className={styles.tabScroll} ref={scrollRef}>
        {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const ext = tab.filename ? suffixOfName(tab.filename) : null;
        const titleHasExt = !!ext && tab.title.toLowerCase().endsWith(`.${ext}`);
        const fullTitle = ext && !titleHasExt ? `${tab.title}.${ext}` : tab.title;
        const color = extensionColor(ext);
        const dragging = dragId === tab.id;
        const dropSide = dropTarget?.id === tab.id ? dropTarget.side : null;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={tab.filename ?? tab.title}
            data-tab-id={tab.id}
            className={clsx(
              styles.tab,
              tab.kind === "temp" ? styles.tabTempKind : styles.tabLibraryKind,
              active && styles.tabActive,
              dragging && styles.tabDragging,
              dropSide === "before" && styles.tabDropBefore,
              dropSide === "after" && styles.tabDropAfter,
            )}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if ((event.target as HTMLElement).closest("button")) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                id: tab.id,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: 0,
                offsetY: 0,
                active: false,
              };
              setActiveTab(tab.id);
            }}
            onPointerMove={(event) => {
              const state = dragRef.current;
              if (!state) return;
              if (!state.active) {
                if (
                  Math.hypot(
                    event.clientX - state.startX,
                    event.clientY - state.startY,
                  ) < 4
                ) {
                  return;
                }
                state.active = true;
                const rect = event.currentTarget.getBoundingClientRect();
                state.offsetX = event.clientX - rect.left;
                state.offsetY = event.clientY - rect.top;
                const ghost = event.currentTarget.cloneNode(true) as HTMLElement;
                ghost.removeAttribute("data-tab-id");
                ghost.removeAttribute("role");
                ghost.setAttribute("aria-hidden", "true");
                ghost.classList.add(styles.tabDragGhost);
                ghost.style.left = `${rect.left}px`;
                ghost.style.top = `${rect.top}px`;
                ghost.style.width = `${rect.width}px`;
                ghost.style.height = `${rect.height}px`;
                document.body.appendChild(ghost);
                dragGhostRef.current = ghost;
                setDragId(state.id);
              }
              event.preventDefault();
              const ghost = dragGhostRef.current;
              if (ghost) {
                ghost.style.left = `${event.clientX - state.offsetX}px`;
                ghost.style.top = `${event.clientY - state.offsetY}px`;
              }
              const element = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest<HTMLElement>("[data-tab-id]");
              const targetId = element?.dataset.tabId;
              if (element && targetId && targetId !== state.id) {
                const rect = element.getBoundingClientRect();
                const side =
                  event.clientX < rect.left + rect.width / 2
                    ? "before"
                    : "after";
                setDropTarget((current) =>
                  current?.id === targetId && current.side === side
                    ? current
                    : { id: targetId, side },
                );
              } else {
                setDropTarget(null);
              }
            }}
            onPointerUp={finishDrag}
            onPointerCancel={(event) =>
              cleanupDrag(event.currentTarget, event.pointerId)
            }
            onLostPointerCapture={() => {
              dragRef.current = null;
              removeGhost();
              setDragId(null);
              setDropTarget(null);
            }}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                requestCloseTab(tab.id);
              }
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
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => requestCloseTab(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
      </div>

      <button
        type="button"
        className={styles.tabAdd}
        title="新建文本（默认 .txt）"
        onClick={() => addTempTab()}
      >
        +
      </button>

      <span className={styles.tabSpacer} />

      {menu && menuItems.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
