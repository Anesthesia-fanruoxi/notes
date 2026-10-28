import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";

import { readTabContent, replaceTabContent } from "../editor/content";
import { stopRecovery } from "../editor/recovery";
import { refreshLibrary } from "../lib/documents";
import { ipc } from "../lib/ipc";
import type { VersionMeta, VersionSnap } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

const SOURCE_LABEL: Record<string, string> = {
  "before-ai": "AI 修改前",
  "before-restore": "还原前",
  manual: "手动快照",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * 版本快照列表 + 预览 + 还原（PROMPT §5.5）。
 * 还原前由 Rust 侧自动写一份 before-restore，可逐级退回。
 */
export default function VersionDialog() {
  const closeDialog = useAppStore((s) => s.openDialog);
  const tab = useAppStore((s) => s.tabs.find((item) => item.id === s.activeTabId));
  const docId = tab?.docId;

  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<VersionSnap | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!docId) return;
    setVersions(await ipc.listVersions(docId));
  }, [docId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "读取版本失败"),
    );
  }, [load]);

  if (!tab || !docId) return null;

  const openVersion = async (id: string) => {
    setSelected(id);
    setPreview(null);
    setConfirming(false);
    setError("");
    try {
      setPreview(await ipc.readVersion(docId, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取版本失败");
    }
  };

  const snapshotNow = async () => {
    setBusy("snapshot");
    setError("");
    setMessage("");
    try {
      await ipc.createVersion({
        docId,
        content: readTabContent(tab.id),
        encoding: tab.encoding,
        hasBom: tab.hasBom,
        lineEnding: tab.lineEnding,
        source: "manual",
      });
      await load();
      setMessage("已把当前正文存为快照。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "存快照失败");
    } finally {
      setBusy("");
    }
  };

  const restore = async () => {
    if (!selected) return;
    setBusy("restore");
    setError("");
    setMessage("");
    try {
      const result = await ipc.restoreVersion({
        docId,
        versionId: selected,
        content: readTabContent(tab.id),
        encoding: tab.encoding,
        hasBom: tab.hasBom,
        lineEnding: tab.lineEnding,
      });

      replaceTabContent(tab.id, result.content);
      // 正文已按该版本写回磁盘，编辑器同步后不再算脏。
      stopRecovery(tab.id);
      useAppStore.getState().updateTab(tab.id, {
        dirty: false,
        sizeBytes: result.meta.sizeBytes,
        encoding: result.encoding,
        hasBom: result.hasBom,
        lineEnding: result.lineEnding,
      });
      await refreshLibrary();
      await load();
      setPreview(null);
      setSelected(null);
      setConfirming(false);
      setMessage(
        `已还原。还原前的内容已存为快照（${formatTime(result.snapshot.createdAt)}），可在左侧找回。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "还原失败");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={styles.scrim}>
      <div className={`${styles.modal} ${styles.modalWide}`}>
        <div className={styles.mHd}>
          <b>版本快照 · {tab.title}</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={() => closeDialog("none")}>
            ×
          </button>
        </div>

        <div className={styles.mBd}>
          <div className={styles.desc} style={{ marginTop: 0, marginBottom: 8 }}>
            每篇文档保留最近 20 份；AI 修改与还原前会自动留档。
          </div>

          <div className={styles.versionBody}>
            <div className={styles.versionList}>
              {versions.length === 0 && (
                <div className={styles.versionEmpty}>还没有快照。</div>
              )}
              {versions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={clsx(
                    styles.versionRow,
                    selected === item.id && styles.versionRowActive,
                  )}
                  onClick={() => void openVersion(item.id)}
                >
                  <span className={styles.versionTime}>{formatTime(item.createdAt)}</span>
                  <span className={styles.versionSource}>
                    {SOURCE_LABEL[item.source] ?? item.source} · {formatSize(item.sizeBytes)}
                  </span>
                </button>
              ))}
            </div>

            <pre className={styles.versionPreview}>
              {preview ? preview.content : "选择左侧快照预览内容。"}
            </pre>
          </div>

          {message && <div className={styles.desc}>{message}</div>}
          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.mFt}>
          <button
            type="button"
            className={styles.btn}
            disabled={busy !== ""}
            onClick={() => void snapshotNow()}
          >
            {busy === "snapshot" ? "保存中…" : "现在存快照"}
          </button>
          <span className={styles.mFtSpacer} />

          {confirming ? (
            <>
              <span className={styles.desc} style={{ marginTop: 0 }}>
                当前内容会先存为「还原前」快照。
              </span>
              <button type="button" className={styles.btn} onClick={() => setConfirming(false)}>
                取消
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={busy !== ""}
                onClick={() => void restore()}
              >
                {busy === "restore" ? "还原中…" : "确认还原"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.btn} onClick={() => closeDialog("none")}>
                关闭
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!selected || busy !== ""}
                onClick={() => setConfirming(true)}
              >
                还原此版本…
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
