import { useEffect, useMemo, useState } from "react";

import { activeTab, saveTempToLibrary, stemName } from "../lib/documents";
import { resolveSaveToLibrary } from "../lib/tabActions";
import type { Category } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

function flatten(categories: Category[]): { category: Category; depth: number }[] {
  const result: { category: Category; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const category of categories.filter((item) => item.parentId === parentId)) {
      result.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

export default function SaveToLibraryDialog() {
  const closeDialog = useAppStore((s) => s.openDialog);
  const categories = useAppStore((s) => s.categories);
  const tab = activeTab();

  const options = useMemo(() => flatten(categories), [categories]);
  const uncategorized = categories.find((c) => c.id === "uncategorized");
  const [title, setTitle] = useState(() =>
    tab?.filename ? stemName(tab.filename) : tab?.title ?? "未命名",
  );
  const [categoryId, setCategoryId] = useState(uncategorized?.id ?? "uncategorized");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // 被关闭 / 取消 / Esc 收起时，通知等待中的关闭/退出流程：没有保存。
  useEffect(() => () => resolveSaveToLibrary(false), []);

  if (!tab) return null;

  const submit = async () => {
    if (!title.trim()) {
      setError("请填写文档名称");
      return;
    }
    setSaving(true);
    try {
      await saveTempToLibrary(tab.id, title.trim(), categoryId);
      resolveSaveToLibrary(true);
      closeDialog("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  };

  return (
    <div className={styles.scrim}>
      <div className={styles.modal}>
        <div className={styles.mHd}>
          <b>保存到文档库</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={() => closeDialog("none")}>
            ×
          </button>
        </div>

        <div className={styles.mBd}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>文档名称</label>
            <input
              className={styles.input}
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
                if (event.key === "Escape") closeDialog("none");
              }}
            />
            <div className={styles.desc}>名称在库内唯一，重名会自动加序号。</div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>分类</label>
            <select
              className={styles.select}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {options.map(({ category, depth }) => (
                <option key={category.id} value={category.id}>
                  {"　".repeat(depth)}
                  {category.name}
                </option>
              ))}
            </select>
            <div className={styles.desc}>保存后可在侧栏按分类找到，不需要记住文件位置。</div>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.mFt}>
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={() => closeDialog("none")}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
