import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

/**
 * AI 侧栏骨架。P4 接入流式请求、单文档会话与清空上下文。
 */
export default function ChatPanel() {
  const aiWidth = useAppStore((s) => s.aiWidth);
  const toggleAi = useAppStore((s) => s.toggleAi);

  return (
    <aside className={styles.chatPanel} style={{ width: aiWidth }} aria-label="AI 助理">
      <div className={styles.aiHd}>
        <b>AI</b>
        <span className={styles.mdl}>未配置</span>
        <span className={styles.aiHdSpacer} />
        <span className={styles.hk}>Ctrl+/</span>
        <button type="button" className={styles.iconBtn} title="关闭 AI 面板" onClick={toggleAi}>
          ×
        </button>
      </div>

      <div className={styles.aiCtx}>尚未选择文档 · 仅本文档</div>

      <div className={styles.chatBody}>
        <div className={styles.chatEmptyTitle}>AI 还没接上</div>
        <div className={styles.chatEmptyDesc}>
          P4 会在这里接入模型服务。
          <br />
          会话只属于当前文档，清空后不可恢复。
        </div>
      </div>

      <div className={styles.aiInput}>
        <div className={styles.aiBox}>
          <textarea disabled rows={1} placeholder="P4 接入后可在此输入指令" />
          <button type="button" className={styles.sendBtn} disabled>
            发送
          </button>
        </div>
        <div className={styles.aiHint}>
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span style={{ marginLeft: "auto" }}>对话只属于本文档</span>
        </div>
      </div>
    </aside>
  );
}
