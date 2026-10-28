import { useState } from "react";

import { pickDirectory, refreshLibrary } from "../lib/documents";
import { ipc } from "../lib/ipc";
import { dropTabState } from "../editor/tabStates";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

export default function SettingsDialog() {
  const closeDialog = useAppStore((s) => s.openDialog);
  const docs = useAppStore((s) => s.docs);
  const categories = useAppStore((s) => s.categories);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalBytes = docs.reduce((sum, doc) => sum + doc.sizeBytes, 0);

  const run = async (label: string, task: () => Promise<string>) => {
    setBusy(label);
    setMessage("");
    setError("");
    try {
      setMessage(await task());
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const backup = () =>
    run("backup", async () => {
      const dir = await pickDirectory("选择备份位置");
      if (!dir) return "已取消";
      const report = await ipc.backupLibrary(dir);
      return `已备份 ${report.docs} 篇文档、${report.categories} 个分类到：${report.path}`;
    });

  const restore = () =>
    run("restore", async () => {
      const dir = await pickDirectory("选择备份目录");
      if (!dir) return "已取消";
      if (!window.confirm("恢复会覆盖当前文档库，恢复前会自动备份当前库。继续？")) {
        return "已取消";
      }
      await ipc.restoreLibrary(dir);
      const state = useAppStore.getState();
      for (const tab of state.tabs.filter((item) => item.kind === "library")) {
        dropTabState(tab.id);
        state.closeTab(tab.id);
      }
      await refreshLibrary();
      return "恢复完成，已关闭库内文档标签。";
    });

  const relocate = () =>
    run("relocate", async () => {
      const dir = await pickDirectory("选择新的库位置");
      if (!dir) return "已取消";
      await ipc.relocateLibrary(dir);
      await refreshLibrary();
      return `迁移完成，库已复制到新位置，旧库保留未删除。`;
    });

  return (
    <div className={styles.scrim}>
      <div className={`${styles.modal} ${styles.modalWide}`}>
        <div className={styles.mHd}>
          <b>设置 · 文档库</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={() => closeDialog("none")}>
            ×
          </button>
        </div>

        <div className={styles.mBd}>
          <div className={styles.statRow}>
            <div className={styles.statBox}>
              <b>{docs.length}</b>
              <span>篇文档</span>
            </div>
            <div className={styles.statBox}>
              <b>{categories.length}</b>
              <span>个分类</span>
            </div>
            <div className={styles.statBox}>
              <b>{(totalBytes / 1024).toFixed(1)} KB</b>
              <span>正文占用</span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>备份</label>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={busy !== ""}
                onClick={() => void backup()}
              >
                {busy === "backup" ? "备份中…" : "备份到文件夹…"}
              </button>
              <button
                type="button"
                className={styles.btn}
                disabled={busy !== ""}
                onClick={() => void restore()}
              >
                {busy === "restore" ? "恢复中…" : "从备份恢复…"}
              </button>
            </div>
            <div className={styles.desc}>
              备份包含正文、分类索引与 AI 会话；恢复前会自动把当前库另存一份。
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>迁移</label>
            <button
              type="button"
              className={styles.btn}
              disabled={busy !== ""}
              onClick={() => void relocate()}
            >
              {busy === "relocate" ? "迁移中…" : "更改库位置…"}
            </button>
            <div className={styles.desc}>
              先把整库复制到新位置，校验通过后切换指向；旧库默认保留，确认无误后自行删除。
            </div>
          </div>

          {message && <div className={styles.desc} style={{ color: "var(--fg-2)" }}>{message}</div>}
          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.mFt}>
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={() => closeDialog("none")}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
