import { useMemo, useState } from "react";

import { flattenCategories } from "../lib/categories";
import { baseName } from "../lib/documents";
import { ipc } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

interface Props {
  paths: string[];
  onClose: () => void;
  onImported: () => void;
}

export default function ImportDialog({ paths, onClose, onImported }: Props) {
  const categories = useAppStore((s) => s.categories);
  const options = useMemo(() => flattenCategories(categories), [categories]);
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(paths.map((path) => [path, "uncategorized"])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const runImport = async () => {
    setBusy(true);
    setError("");
    try {
      const report = await ipc.importFiles(
        paths.map((path) => [path, assignments[path] ?? "uncategorized"]),
      );
      const lines = [`已导入 ${report.imported.length} 个文件`];
      if (report.renamed.length) {
        lines.push(`重名改名：${report.renamed.map(([from, to]) => `${from} → ${to}`).join("，")}`);
      }
      if (report.skipped.length) {
        lines.push(`跳过 ${report.skipped.length} 个：${report.skipped.map(([name, why]) => `${name}（${why}）`).join("，")}`);
      }
      window.alert(lines.join("\n"));
      onImported();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim}>
      <div className={`${styles.modal} ${styles.modalWide}`}>
        <div className={styles.mHd}>
          <b>导入到文档库</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.mBd}>
          <div className={styles.desc}>
            导入是复制入库，原文件保留在原处；同名会自动加序号。
          </div>

          <div className={styles.importList}>
            {paths.map((path) => (
              <div className={styles.importRow} key={path}>
                <span className={styles.importName} title={path}>
                  {baseName(path)}
                </span>
                <select
                  className={styles.importSelect}
                  value={assignments[path] ?? "uncategorized"}
                  onChange={(event) =>
                    setAssignments((prev) => ({ ...prev, [path]: event.target.value }))
                  }
                >
                  {options.map(({ category, depth }) => (
                    <option key={category.id} value={category.id}>
                      {"　".repeat(depth)}
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className={styles.desc}>
            <button
              type="button"
              className={styles.btn}
              style={{ height: 24, marginTop: 8 }}
              onClick={() =>
                setAssignments(Object.fromEntries(paths.map((path) => [path, "uncategorized"])))
              }
            >
              全部导入到未分类
            </button>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.mFt}>
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busy}
            onClick={() => void runImport()}
          >
            {busy ? "导入中…" : `导入 ${paths.length} 个`}
          </button>
        </div>
      </div>
    </div>
  );
}
