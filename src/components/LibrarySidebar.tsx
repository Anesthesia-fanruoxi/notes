import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { dropTabState } from "../editor/tabStates";
import { flattenCategories } from "../lib/categories";
import { openLibraryDoc, refreshLibrary } from "../lib/documents";
import { ipc } from "../lib/ipc";
import { addTempTab, openScratchRecord, purgeScratchRecord } from "../lib/scratch";
import type { Category, DocMeta, ScratchDoc } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { ConfirmDialog, InputDialog } from "./Dialog";
import ImportDialog from "./ImportDialog";

const UNCATEGORIZED = "uncategorized";

type PendingDialog =
  | { kind: "newCategory"; parentId: string | null }
  | { kind: "renameCategory"; id: string; name: string }
  | { kind: "renameDoc"; id: string; title: string }
  | { kind: "deleteDoc"; id: string; title: string }
  | { kind: "deleteCategory"; id: string; name: string; docCount: number }
  | { kind: "deleteScratch"; record: ScratchDoc }
  | null;

export default function LibrarySidebar() {
  const categories = useAppStore((s) => s.categories);
  const docs = useAppStore((s) => s.docs);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const collapsed = useAppStore((s) => s.collapsed);
  const query = useAppStore((s) => s.query);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleCollapsed = useAppStore((s) => s.toggleCollapsed);
  const setQuery = useAppStore((s) => s.setQuery);

  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [importPaths, setImportPaths] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [pending, setPending] = useState<PendingDialog>(null);

  const scratchDocs = useAppStore((s) => s.scratchDocs);
  const trimmed = query.trim().toLowerCase();
  const visibleDocs = trimmed
    ? docs.filter((doc) => doc.title.toLowerCase().includes(trimmed))
    : docs;

  const ensureExpanded = (categoryId: string) => {
    if (useAppStore.getState().collapsed[categoryId]) toggleCollapsed(categoryId);
  };

  const createDocIn = async (categoryId: string) => {
    ensureExpanded(categoryId);
    const meta = await ipc.createDoc({
      title: "未命名",
      categoryId,
      extension: "md",
      content: "",
      encoding: "UTF-8",
      hasBom: false,
      lineEnding: "LF",
    });
    await refreshLibrary();
    await openLibraryDoc(meta.id);
  };

  const createCategory = async (name: string, parentId: string | null) => {
    if (parentId) ensureExpanded(parentId);
    const created = await ipc.createCategory(name, parentId);
    await refreshLibrary();
    ensureExpanded(created.id);
  };

  const removeDoc = async (docId: string) => {
    const outcome = await ipc.deleteDoc(docId);
    const state = useAppStore.getState();
    const tab = state.tabs.find((item) => item.docId === docId);
    if (tab) {
      dropTabState(tab.id);
      state.closeTab(tab.id);
    }
    await refreshLibrary();

    if (!outcome.recycled) {
      window.alert(
        "系统回收站暂时不可用，文件已移到应用回收区（应用数据目录/trash），没有丢失。",
      );
    }
  };

  const pickAndImport = async () => {
    const picked = await open({
      multiple: true,
      title: "导入到文档库",
      filters: [
        {
          name: "文本",
          extensions: [
            "txt",
            "md",
            "log",
            "json",
            "csv",
            "ts",
            "js",
            "py",
            "go",
            "rs",
            "yaml",
            "yml",
            "toml",
          ],
        },
      ],
    });
    if (!picked) return;
    setImportPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const handleDrop = async (categoryId: string) => {
    setDropTarget(null);
    if (!dragDocId) return;
    const doc = docs.find((item) => item.id === dragDocId);
    setDragDocId(null);
    if (!doc || doc.categoryId === categoryId) return;
    try {
      await ipc.moveDoc(doc.id, categoryId);
      await refreshLibrary();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "移动失败");
    }
  };

  const rootMenuItems = (): MenuItem[] => [
    { label: "新建文件", onSelect: () => void createDocIn(UNCATEGORIZED) },
    { label: "新建目录", onSelect: () => setPending({ kind: "newCategory", parentId: null }) },
    { separator: true, label: "sep" },
    { label: "导入文件…", onSelect: () => void pickAndImport() },
  ];

  const categoryMenuItems = (category: Category): MenuItem[] => {
    const isBuiltin = category.id === UNCATEGORIZED;
    return [
      { label: "新建文件", onSelect: () => void createDocIn(category.id) },
      {
        label: "新建子目录",
        onSelect: () => setPending({ kind: "newCategory", parentId: category.id }),
      },
      { separator: true, label: "sep" },
      {
        label: "重命名",
        disabled: isBuiltin,
        onSelect: () =>
          setPending({ kind: "renameCategory", id: category.id, name: category.name }),
      },
      {
        label: "删除",
        danger: true,
        disabled: isBuiltin,
        onSelect: () =>
          setPending({
            kind: "deleteCategory",
            id: category.id,
            name: category.name,
            docCount: countDocsInSubtree(category.id),
          }),
      },
    ];
  };

  const countDocsInSubtree = (categoryId: string): number => {
    const ids = new Set<string>([categoryId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const category of categories) {
        if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
          ids.add(category.id);
          grew = true;
        }
      }
    }
    return docs.filter((doc) => ids.has(doc.categoryId)).length;
  };

  const openCategoryMenu = (category: Category, x: number, y: number) => {
    setMenu({ x, y, items: categoryMenuItems(category) });
  };

  const openDocMenu = (doc: DocMeta, x: number, y: number) => {
    setMenu({
      x,
      y,
      items: [
        {
          label: "重命名",
          onSelect: () => setPending({ kind: "renameDoc", id: doc.id, title: doc.title }),
        },
        {
          label: "删除",
          danger: true,
          onSelect: () => setPending({ kind: "deleteDoc", id: doc.id, title: doc.title }),
        },
      ],
    });
  };

  const renderDoc = (docId: string, depth: number) => {
    const doc = docs.find((item) => item.id === docId);
    if (!doc) return null;
    const tab = tabs.find((item) => item.docId === doc.id);
    return (
      <button
        key={doc.id}
        type="button"
        className={clsx(styles.doc, tab?.id === activeTabId && styles.docActive)}
        style={{ paddingLeft: 24 + depth * 14 }}
        title={doc.title}
        draggable
        onDragStart={() => setDragDocId(doc.id)}
        onDragEnd={() => setDragDocId(null)}
        onClick={() => void openLibraryDoc(doc.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          openDocMenu(doc, event.clientX, event.clientY);
        }}
      >
        <span className={styles.docName}>{doc.title}</span>
        {!doc.aiReadable && (
          <span className={styles.docLock} title="已禁止 AI 读取">
            禁读
          </span>
        )}
        {tab?.dirty && (
          <span className={styles.docFlag}>
            <span className={styles.mdot} title="已修改" />
          </span>
        )}
      </button>
    );
  };

  const renderCategory = (categoryId: string, depth: number): ReactNode => {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return null;

    const isCollapsed = collapsed[category.id] ?? false;
    const children = categories
      .filter((item) => item.parentId === category.id)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const ownDocs = visibleDocs.filter((doc) => doc.categoryId === category.id);

    return (
      <div key={category.id}>
        <div
          role="button"
          tabIndex={0}
          className={clsx(styles.catRow, dropTarget === category.id && styles.catRowDrop)}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggleCollapsed(category.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleCollapsed(category.id);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openCategoryMenu(category, event.clientX, event.clientY);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget(category.id);
          }}
          onDragLeave={() =>
            setDropTarget((current) => (current === category.id ? null : current))
          }
          onDrop={(event) => {
            event.preventDefault();
            void handleDrop(category.id);
          }}
          title={trimmed ? "拖动文档到这里可移动分类" : category.name}
        >
          <span className={styles.catChev}>{isCollapsed ? "▸" : "▾"}</span>
          <span className={styles.catName}>{category.name}</span>
          <span className={styles.catCount}>{ownDocs.length}</span>
          <button
            type="button"
            className={styles.rowPlus}
            title="在此目录新建…"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openCategoryMenu(category, rect.right - 6, rect.bottom + 2);
            }}
          >
            ＋
          </button>
        </div>

        {!isCollapsed && (
          <>
            {ownDocs.map((doc) => renderDoc(doc.id, depth + 1))}
            {children.map((child) => renderCategory(child.id, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const roots = flattenCategories(categories).filter((item) => item.depth === 0);

  return (
    <aside className={styles.sidebar} style={{ width: sidebarWidth }} aria-label="文档库">
      <div className={styles.libHd}>
        <b>文档库</b>
        <span className={styles.libHdSpacer} />
        <button
          type="button"
          className={styles.iconBtn}
          title="收起侧栏"
          aria-label="收起侧栏"
          onClick={toggleSidebar}
        >
          «
        </button>
      </div>

      <div className={styles.search}>
        <input
          className={styles.searchInput}
          placeholder="搜索文档…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>

      <div
        className={styles.lib}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, items: rootMenuItems() });
        }}
      >
        <div
          className={styles.sec}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY, items: rootMenuItems() });
          }}
        >
          常驻文档 <span className={styles.secN}>{docs.length}</span>
          <button
            type="button"
            className={styles.secPlus}
            title="新建文件或目录"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.right - 6, y: rect.bottom + 2, items: rootMenuItems() });
            }}
          >
            ＋
          </button>
        </div>

        {trimmed ? (
          visibleDocs.length ? (
            visibleDocs.map((doc) => {
              const category = categories.find((item) => item.id === doc.categoryId);
              return (
                <div key={doc.id}>
                  <div className={styles.libHint} style={{ padding: "2px 12px" }}>
                    {category?.name ?? "未分类"}
                  </div>
                  {renderDoc(doc.id, 0)}
                </div>
              );
            })
          ) : (
            <div className={styles.emptyBlock}>没有匹配「{query}」的文档。</div>
          )
        ) : roots.length ? (
          roots.map(({ category }) => renderCategory(category.id, 0))
        ) : null}

        {!trimmed && docs.length === 0 && categories.every((c) => c.id === UNCATEGORIZED) && (
          <div className={styles.emptyBlock}>文档库为空。右键或点 ＋ 新建第一个文档。</div>
        )}

        <div className={styles.sec} style={{ marginTop: 12 }}>
          临时文档 <span className={styles.secN}>{scratchDocs.length}</span>
          <button
            type="button"
            className={styles.secPlus}
            title="新建临时文件"
            onClick={() => addTempTab()}
          >
            ＋
          </button>
        </div>

        {scratchDocs.map((item) => {
          const openTab = tabs.find((tab) => tab.id === item.tabId);
          return (
            <div
              key={item.tabId}
              className={clsx(styles.tempRow, item.tabId === activeTabId && styles.tempRowActive)}
            >
              <button
                type="button"
                className={styles.tempMain}
                onClick={() => void openScratchRecord(item)}
                title={item.path ?? item.title}
              >
                <span className={styles.docName}>{item.title}</span>
                {item.source === "file" && <span className={styles.tempBadge}>文件</span>}
                {openTab?.dirty && <span className={styles.mdot} title="已修改" />}
              </button>
              <button
                type="button"
                className={styles.tempX}
                title={item.source === "file" ? "从列表移除（不删文件）" : "删除临时文件"}
                onClick={() => {
                  // 从磁盘拖入/打开的文件：删记录不伤文件，直接移除，不弹确认。
                  if (item.source === "file") {
                    void purgeScratchRecord(item).catch((err) =>
                      window.alert(err instanceof Error ? err.message : "移除记录失败"),
                    );
                  } else {
                    setPending({ kind: "deleteScratch", record: item });
                  }
                }}
              >
                ×
              </button>
            </div>
          );
        })}

        <div className={styles.libHint}>
          标签页关掉只是不展示，临时文件仍留在这里；× 才会删记录（从磁盘打开的文件只删记录）。
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {importPaths && (
        <ImportDialog
          paths={importPaths}
          onClose={() => setImportPaths(null)}
          onImported={() => void refreshLibrary()}
        />
      )}

      {pending?.kind === "newCategory" && (
        <InputDialog
          title={pending.parentId ? "新建子目录" : "新建目录"}
          label="目录名称"
          confirmText="创建"
          onClose={() => setPending(null)}
          onConfirm={(name) => createCategory(name, pending.parentId)}
        />
      )}

      {pending?.kind === "renameCategory" && (
        <InputDialog
          title="重命名目录"
          label="目录名称"
          initialValue={pending.name}
          onClose={() => setPending(null)}
          onConfirm={async (name) => {
            await ipc.renameCategory(pending.id, name);
            await refreshLibrary();
          }}
        />
      )}

      {pending?.kind === "renameDoc" && (
        <InputDialog
          title="重命名文档"
          label="文档名称"
          initialValue={pending.title}
          onClose={() => setPending(null)}
          onConfirm={async (title) => {
            const updated = await ipc.renameDoc(pending.id, title);
            const state = useAppStore.getState();
            const tab = state.tabs.find((item) => item.docId === pending.id);
            if (tab) state.updateTab(tab.id, { title: updated.title });
            await refreshLibrary();
          }}
        />
      )}

      {pending?.kind === "deleteScratch" && (
        <ConfirmDialog
          title="删除临时文件"
          message={`「${pending.record.title}」会被永久删除，无法恢复。`}
          confirmText="删除"
          danger
          onClose={() => setPending(null)}
          onConfirm={() => purgeScratchRecord(pending.record)}
        />
      )}

      {pending?.kind === "deleteDoc" && (
        <ConfirmDialog
          title="删除文档"
          message={`「${pending.title}」会被移到回收站，可从回收站还原。`}
          confirmText="删除"
          danger
          onClose={() => setPending(null)}
          onConfirm={() => removeDoc(pending.id)}
        />
      )}

      {pending?.kind === "deleteCategory" && (
        <ConfirmDialog
          title="删除目录"
          message={`删除「${pending.name}」及其所有子目录？\n其中 ${pending.docCount} 篇文档会移到「未分类」，不会被删除。`}
          confirmText="删除"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await ipc.deleteCategory(pending.id);
            await refreshLibrary();
          }}
        />
      )}
    </aside>
  );
}
