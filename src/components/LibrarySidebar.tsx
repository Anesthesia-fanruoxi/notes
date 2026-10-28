import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { flattenCategories } from "../lib/categories";
import { openLibraryDoc, refreshLibrary } from "../lib/documents";
import { ipc } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";
import ImportDialog from "./ImportDialog";

export default function LibrarySidebar() {
  const categories = useAppStore((s) => s.categories);
  const docs = useAppStore((s) => s.docs);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const collapsed = useAppStore((s) => s.collapsed);
  const query = useAppStore((s) => s.query);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const addTab = useAppStore((s) => s.addTab);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleCollapsed = useAppStore((s) => s.toggleCollapsed);
  const setQuery = useAppStore((s) => s.setQuery);

  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [importPaths, setImportPaths] = useState<string[] | null>(null);

  const tempTabs = tabs.filter((tab) => tab.kind === "temp");
  const trimmed = query.trim().toLowerCase();
  const visibleDocs = trimmed ? docs.filter((doc) => doc.title.toLowerCase().includes(trimmed)) : docs;

  const scoreDoc = (docId: string) => docs.find((doc) => doc.id === docId);

  const createCategory = async () => {
    const name = window.prompt("新建分类名称");
    if (!name?.trim()) return;
    try {
      await ipc.createCategory(name.trim(), null);
      await refreshLibrary();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "创建分类失败");
    }
  };

  const pickAndImport = async () => {
    const picked = await open({
      multiple: true,
      title: "导入到文档库",
      filters: [
        {
          name: "文本",
          extensions: ["txt", "md", "log", "json", "csv", "ts", "js", "py", "go", "rs", "yaml", "yml", "toml"],
        },
      ],
    });
    if (!picked) return;
    setImportPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const handleDrop = async (categoryId: string) => {
    setDropTarget(null);
    if (!dragDocId) return;
    const doc = scoreDoc(dragDocId);
    setDragDocId(null);
    if (!doc || doc.categoryId === categoryId) return;
    try {
      await ipc.moveDoc(doc.id, categoryId);
      await refreshLibrary();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "移动失败");
    }
  };

  const renderDoc = (docId: string, depth: number) => {
    const doc = scoreDoc(docId);
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
        <button
          type="button"
          className={clsx(styles.catRow, dropTarget === category.id && styles.catRowDrop)}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggleCollapsed(category.id)}
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget(category.id);
          }}
          onDragLeave={() => setDropTarget((current) => (current === category.id ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            void handleDrop(category.id);
          }}
          title={trimmed ? "拖动文档到这里可移动分类" : category.name}
        >
          <span className={styles.catChev}>{isCollapsed ? "▸" : "▾"}</span>
          <span className={styles.catName}>{category.name}</span>
          <span className={styles.catCount}>{ownDocs.length}</span>
        </button>

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
        <button type="button" className={styles.iconBtn} title="新建分类" onClick={() => void createCategory()}>
          ＋
        </button>
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

      <div className={styles.libActs}>
        <button type="button" className={styles.libBtn} onClick={() => addTab({ title: "未命名" })}>
          ＋ 新建
        </button>
        <button type="button" className={styles.libBtn} onClick={() => void pickAndImport()}>
          ⬆ 导入
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

      <div className={styles.lib}>
        <div className={styles.sec}>
          常驻文档 <span className={styles.secN}>{docs.length}</span>
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
        ) : (
          <button type="button" className={styles.doc} onClick={() => void createCategory()}>
            新建第一个分类…
          </button>
        )}

        {!trimmed && docs.length === 0 && (
          <div className={styles.emptyBlock}>文档库为空。保存或导入后会按分类出现在这里。</div>
        )}

        <div className={styles.sec} style={{ marginTop: 12 }}>
          临时文档 <span className={styles.secN}>{tempTabs.length}</span>
        </div>

        {tempTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={clsx(styles.doc, tab.id === activeTabId && styles.docActive)}
            onClick={() => setActiveTab(tab.id)}
            title={`${tab.title}（临时）`}
          >
            <span className={styles.docName}>{tab.title}</span>
            {tab.dirty && (
              <span className={styles.docFlag}>
                <span className={styles.mdot} title="已修改" />
              </span>
            )}
          </button>
        ))}

        <div className={styles.libHint}>
          临时文档自动保存在本机临时区，不进文档库，也不保留 AI 会话。
        </div>
      </div>

      {importPaths && (
        <ImportDialog
          paths={importPaths}
          onClose={() => setImportPaths(null)}
          onImported={() => void refreshLibrary()}
        />
      )}
    </aside>
  );
}
