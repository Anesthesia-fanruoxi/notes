import { answerClose } from "../lib/tabActions";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

/**
 * 关闭 / 退出前的未保存确认（PROMPT §5.4）。
 * 常驻：保存 / 丢弃 / 取消；临时：保存到库 / 丢弃 / 取消。
 */
export default function CloseConfirmDialog() {
  const prompt = useAppStore((s) => s.closePrompt);
  const tab = useAppStore((s) => s.tabs.find((item) => item.id === prompt?.tabId));

  if (!prompt || !tab) return null;

  const temp = tab.kind === "temp";
  const exiting = prompt.mode === "exit";

  return (
    <div className={styles.scrim}>
      <div className={styles.modal}>
        <div className={styles.mHd}>
          <b>{exiting ? "退出前的未保存修改" : "关闭未保存的文档"}</b>
        </div>

        <div className={styles.mBd}>
          <div className={styles.confirmTitle}>「{tab.title}」有未保存的修改</div>
          <div className={styles.desc}>
            {temp
              ? "临时文档不在文档库中，丢弃后本次内容会被删除；保存后会从临时区转入文档库。"
              : "保存会直接写回文档库；丢弃后本次修改不可恢复。"}
          </div>
        </div>

        <div className={styles.mFt}>
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={() => answerClose("cancel")}>
            取消
          </button>
          <button type="button" className={styles.btn} onClick={() => answerClose("discard")}>
            {exiting ? "丢弃并继续" : "丢弃"}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => answerClose("save")}
          >
            {temp ? "保存到文档库…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
