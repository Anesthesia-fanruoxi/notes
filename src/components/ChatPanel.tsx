import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EditorView } from "@codemirror/view";

import { getActiveEditorView, getActiveViewTabId } from "../editor/activeView";
import { flushScratchNow } from "../editor/autosave";
import { flushRecoveryNow } from "../editor/recovery";
import { readTabContent } from "../editor/content";
import {
  AI_TEMPLATES,
  MAX_CONTEXT_CHARS,
  QUICK_PROMPTS,
  aiConfigOf,
  buildSystemMessage,
  getTempChat,
  isTempAiBlocked,
  loadAiSettings,
  setTempAiBlocked,
  setTempChat,
  toAiMessages,
  type QuickAction,
} from "../lib/ai";
import { refreshLibrary } from "../lib/documents";
import { ipc } from "../lib/ipc";
import type { AiMessage, ChatMessage } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

const QUICK_ORDER: QuickAction[] = ["polish", "summary", "translate", "continue"];

interface RequestHandle {
  id: string;
  aborted: boolean;
  /** 清空会话时丢弃在途结果，不再写回历史。 */
  discard: boolean;
  text: string;
}

function paragraphAt(view: EditorView | null, tabId: string): string {
  if (!view || getActiveViewTabId() !== tabId) return "";
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  let from = line.from;
  let to = line.to;
  while (from > 0) {
    const prev = view.state.doc.lineAt(from - 1);
    if (!prev.text.trim()) break;
    from = prev.from;
  }
  while (to < view.state.doc.length) {
    const next = view.state.doc.lineAt(to + 1);
    if (!next.text.trim()) break;
    to = next.to;
  }
  return view.state.doc.sliceString(from, to);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

export default function ChatPanel() {
  const aiWidth = useAppStore((s) => s.aiWidth);
  const toggleAi = useAppStore((s) => s.toggleAi);
  const tab = useAppStore((s) => s.tabs.find((item) => item.id === s.activeTabId));
  const docs = useAppStore((s) => s.docs);
  const docSize = useAppStore((s) => s.docSize);
  const selectionChars = useAppStore((s) => s.selectionChars);
  const aiSettingsVersion = useAppStore((s) => s.aiSettingsVersion);
  const setSettingsSection = useAppStore((s) => s.setSettingsSection);
  const openDialog = useAppStore((s) => s.openDialog);

  const doc = tab?.docId ? docs.find((item) => item.id === tab.docId) : undefined;
  const docReadable = doc?.aiReadable ?? true;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [tempBlocked, setTempBlockedState] = useState(false);
  const [keyReady, setKeyReady] = useState<boolean | null>(null);
  const [applied, setApplied] = useState<{ at: number; hasSnapshot: boolean } | null>(null);

  const requestRef = useRef<RequestHandle | null>(null);
  const streamTsRef = useRef(0);
  const sessionRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const settings = useMemo(() => loadAiSettings(), [aiSettingsVersion]);
  const needsKey = settings.template !== "ollama";
  const templateLabel = AI_TEMPLATES[settings.template].label;

  const canRead = tab?.kind === "library" ? docReadable : tab ? !tempBlocked : true;
  const keyOk = !needsKey || keyReady === true;
  const canSend = !!tab && canRead && keyOk && !streaming;

  const readLabel = useMemo(() => {
    if (settings.scope === "document") {
      return `${Math.min(docSize, MAX_CONTEXT_CHARS)} / ${docSize} 字`;
    }
    return selectionChars > 0 ? `已选 ${selectionChars} 字` : "当前段落";
  }, [settings.scope, docSize, selectionChars]);

  function abortActive() {
    const request = requestRef.current;
    if (!request) return;
    request.aborted = true;
    requestRef.current = null;
    void ipc.aiAbort(request.id).catch(() => undefined);
    const ts = streamTsRef.current;
    setMessages((prev) =>
      prev.filter((message) => !(message.role === "assistant" && message.ts === ts && !message.content)),
    );
    setStreaming(false);
    setNotice("已停止");
  }

  // 流式增量。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<{ requestId: string; text: string }>("ai://delta", (event) => {
      const request = requestRef.current;
      if (!request || request.id !== event.payload.requestId) return;
      request.text += event.payload.text;

      setMessages((prev) => {
        const index = prev.findIndex(
          (message) => message.role === "assistant" && message.ts === streamTsRef.current,
        );
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = { ...next[index], content: next[index].content + event.payload.text };
        return next;
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 切标签 / 切文档：中止请求、切会话上下文。
  useEffect(() => {
    abortActive();
    sessionRef.current += 1;
    const session = sessionRef.current;

    setMessages([]);
    setInput("");
    setError("");
    setNotice("");
    setConfirmClear(false);
    setApplied(null);

    if (!tab) return;
    setTempBlockedState(isTempAiBlocked(tab.id));

    let cancelled = false;
    if (tab.kind === "library" && tab.docId) {
      void ipc
        .loadChat(tab.docId)
        .then((list) => {
          if (!cancelled && sessionRef.current === session) setMessages(list);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "读取会话失败");
        });
    } else {
      setMessages(getTempChat(tab.id));
    }

    return () => {
      cancelled = true;
    };
  }, [tab?.id, tab?.kind, tab?.docId]);

  // 面板关闭时中止在途请求。
  useEffect(
    () => () => {
      const request = requestRef.current;
      if (request) {
        request.aborted = true;
        void ipc.aiAbort(request.id).catch(() => undefined);
      }
    },
    [],
  );

  // 密钥状态（模板切换 / 设置里保存后刷新）。
  useEffect(() => {
    void ipc
      .getSecretStatus(loadAiSettings().template)
      .then(setKeyReady)
      .catch(() => setKeyReady(false));
  }, [aiSettingsVersion, tab?.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function contextForSend(tabId: string): { text: string; truncated: boolean } {
    const current = loadAiSettings();
    const view = getActiveEditorView();
    if (current.scope === "document") {
      const full = readTabContent(tabId);
      const truncated = full.length > MAX_CONTEXT_CHARS;
      return { text: truncated ? full.slice(0, MAX_CONTEXT_CHARS) : full, truncated };
    }

    const selection =
      view && getActiveViewTabId() === tabId && !view.state.selection.main.empty
        ? view.state.doc.sliceString(
            view.state.selection.main.from,
            view.state.selection.main.to,
          )
        : "";
    const text =
      selection || paragraphAt(view, tabId) || readTabContent(tabId).slice(0, 4000);
    const truncated = text.length > MAX_CONTEXT_CHARS;
    return { text: truncated ? text.slice(0, MAX_CONTEXT_CHARS) : text, truncated };
  }

  async function runRequest(instruction: string): Promise<void> {
    if (!tab || streaming || !canRead || requestRef.current) return;
    const text = instruction.trim();
    if (!text) return;

    const current = loadAiSettings();
    if (current.template !== "ollama" && keyReady === false) {
      setError("还没配置 API Key，请到设置 → AI 填写。");
      return;
    }

    const context = contextForSend(tab.id);
    if (!context.text.trim()) {
      setError("当前文档没有可发送的内容。");
      return;
    }

    const tabAtStart = tab;
    const session = sessionRef.current;
    const base = messages;
    const userMessage: ChatMessage = { role: "user", content: text, ts: Date.now() };
    // 同一毫秒内连发时也要保证占位消息的时间戳唯一。
    const assistantTs =
      Math.max(Date.now(), userMessage.ts, ...base.map((message) => message.ts)) + 1;
    const placeholder: ChatMessage = { role: "assistant", content: "", ts: assistantTs };
    const payload: AiMessage[] = [
      {
        role: "system",
        content: buildSystemMessage(
          tabAtStart.title,
          current.scope,
          context.text,
          context.truncated,
        ),
      },
      ...toAiMessages(base),
      { role: "user", content: text },
    ];

    setError("");
    setNotice("");
    setApplied(null);
    setStreaming(true);
    setMessages([...base, userMessage, placeholder]);
    streamTsRef.current = assistantTs;

    if (tabAtStart.kind === "library" && tabAtStart.docId) {
      void ipc
        .appendChat(tabAtStart.docId, userMessage)
        .catch((err) => console.warn("[chat] 保存失败", err));
    }

    const request: RequestHandle = {
      id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      aborted: false,
      discard: false,
      text: "",
    };
    requestRef.current = request;

    try {
      await ipc.aiChat({
        requestId: request.id,
        docId: tabAtStart.docId ?? null,
        docTitle: tabAtStart.title,
        config: aiConfigOf(current),
        messages: payload,
      });
    } catch (err) {
      if (!request.aborted && sessionRef.current === session) {
        setError(err instanceof Error ? err.message : "请求失败");
      }
    } finally {
      // 只有仍是当前请求时才动 UI；停止后立刻重发时不能覆盖新请求。
      const isActive = requestRef.current === request;
      if (isActive) requestRef.current = null;
      if (isActive && sessionRef.current === session) setStreaming(false);

      if (!request.discard) {
        const full = request.text;
        if (full.trim()) {
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: full,
            ts: assistantTs,
          };
          if (tabAtStart.kind === "temp") {
            const final = [...base, userMessage, assistantMessage];
            setTempChat(tabAtStart.id, final);
            if (isActive && sessionRef.current === session) setMessages(final);
          } else if (tabAtStart.docId) {
            void ipc
              .appendChat(tabAtStart.docId, assistantMessage)
              .catch((err) => console.warn("[chat] 保存失败", err));
          }
        } else if (isActive && sessionRef.current === session) {
          setMessages((prev) => prev.filter((message) => message.ts !== assistantTs));
        }
      }
    }
  }

  function submitInput(): void {
    if (!canSend) return;
    const text = input.trim();
    if (!text) return;
    setInput("");
    void runRequest(text);
  }

  async function clearSession(): Promise<void> {
    if (!tab) return;
    const request = requestRef.current;
    if (request) {
      request.discard = true;
      request.aborted = true;
      requestRef.current = null;
      void ipc.aiAbort(request.id).catch(() => undefined);
      setStreaming(false);
    }
    try {
      if (tab.kind === "library" && tab.docId) {
        await ipc.clearChat(tab.docId);
      } else {
        setTempChat(tab.id, []);
      }
      setMessages([]);
      setError("");
      setNotice("已清空");
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空失败");
    } finally {
      setConfirmClear(false);
    }
  }

  async function toggleReadable(): Promise<void> {
    if (!tab) return;
    if (tab.kind === "library" && tab.docId) {
      try {
        await ipc.setAiReadable(tab.docId, !docReadable);
        if (docReadable) abortActive();
        await refreshLibrary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "切换失败");
      }
      return;
    }

    const next = !tempBlocked;
    setTempAiBlocked(tab.id, next);
    setTempBlockedState(next);
    if (next) abortActive();
  }

  async function copyMessage(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("已复制");
    } catch {
      setError("复制失败");
    }
  }

  function retry(ts: number): void {
    const index = messages.findIndex((message) => message.ts === ts);
    if (index === -1) return;
    const user = messages
      .slice(0, index)
      .reverse()
      .find((message) => message.role === "user");
    if (user) void runRequest(user.content);
  }

  async function applyMessage(contentToApply: string, mode: "replace" | "insert"): Promise<void> {
    if (!tab) return;
    const view = getActiveEditorView();
    if (!view || getActiveViewTabId() !== tab.id) {
      setError("请先回到要修改的文档。");
      return;
    }
    if (mode === "replace" && view.state.selection.main.empty) {
      setError("先在编辑器里选中要替换的文本。");
      return;
    }

    let snapshotAt = 0;
    if (tab.kind === "library" && tab.docId) {
      try {
        const snapshot = await ipc.createVersion({
          docId: tab.docId,
          content: readTabContent(tab.id),
          encoding: tab.encoding,
          hasBom: tab.hasBom,
          lineEnding: tab.lineEnding,
          source: "before-ai",
        });
        snapshotAt = snapshot.createdAt;
      } catch (err) {
        setError(
          `版本快照失败，已取消应用：${err instanceof Error ? err.message : "未知错误"}`,
        );
        return;
      }
    }

    // 快照是异步的，期间可能切了标签或改了选区，重新取一次。
    const currentView = getActiveEditorView();
    if (!currentView || getActiveViewTabId() !== tab.id) {
      setError("文档已切换，已取消应用。");
      return;
    }
    const selection = currentView.state.selection.main;
    if (mode === "replace" && selection.empty) {
      setError("选区已丢失，已取消应用。");
      return;
    }

    const from = mode === "replace" ? selection.from : selection.head;
    const to = mode === "replace" ? selection.to : selection.head;
    currentView.dispatch({
      changes: { from, to, insert: contentToApply },
      selection: { anchor: from + contentToApply.length },
    });

    // 快照立即落盘：AI 的修改本身也成为新的工作副本。
    if (tab.kind === "library") void flushRecoveryNow(tab.id);
    else void flushScratchNow(tab.id);

    if (snapshotAt) {
      setApplied({ at: snapshotAt, hasSnapshot: true });
      setNotice("已应用，可 Ctrl+Z 一次撤销。");
    } else {
      setApplied({ at: Date.now(), hasSnapshot: false });
      setNotice("已应用到临时文档（不保留版本快照）。");
    }
  }

  const visibleMessages = messages.slice(-100);
  const lastTs = visibleMessages[visibleMessages.length - 1]?.ts;

  let emptyTitle = "只和当前文档对话";
  let emptyDesc = "选中一段文字，或直接在下面提问。请求只会带上当前文档。";
  if (!tab) {
    emptyTitle = "没有打开的文档";
    emptyDesc = "打开一篇文档后即可使用。";
  } else if (!canRead) {
    emptyTitle = "本文档已禁止 AI 读取";
    emptyDesc = tab.kind === "library" ? "在上下文条打开「允许读取」后即可使用。" : "在上下文条恢复本次会话的读取权限。";
  } else if (!keyOk) {
    emptyTitle = "还没配置 AI";
    emptyDesc = "到设置 → AI 填 Base URL、模型和 Key，然后测试连接。";
  } else if (tab.kind === "temp") {
    emptyDesc = "临时文档不保留对话，关闭标签即清空。";
  }

  return (
    <aside className={styles.chatPanel} style={{ width: aiWidth }} aria-label="AI 助理">
      <div className={styles.aiHd}>
        <b>AI</b>
        <span className={styles.mdl}>{templateLabel}</span>
        <span className={styles.aiHdSpacer} />
        <button
          type="button"
          className={styles.aiHdBtn}
          title="清空当前文档的会话"
          disabled={messages.length === 0 && !streaming}
          onClick={() => setConfirmClear(true)}
        >
          清空
        </button>
        <button type="button" className={styles.iconBtn} title="关闭 AI 面板" onClick={toggleAi}>
          ×
        </button>
      </div>

      <div className={styles.aiCtx}>
        <span className={styles.ctxDoc} title={tab?.title}>
          {tab?.title ?? "未打开文档"}
        </span>
        <span>仅本文档</span>
        <span className={styles.ctxNum}>{readLabel}</span>
        <label className={styles.ctxToggle} title="允许 AI 读取本文档">
          <input
            type="checkbox"
            checked={canRead}
            disabled={!tab}
            onChange={() => void toggleReadable()}
          />
          允许读取
        </label>
      </div>

      {confirmClear && (
        <div className={styles.clearBar}>
          <span>清空后不可恢复。</span>
          <button type="button" onClick={() => void clearSession()}>
            清空
          </button>
          <button type="button" onClick={() => setConfirmClear(false)}>
            取消
          </button>
        </div>
      )}

      <div className={styles.chatScroll}>
        {visibleMessages.length === 0 ? (
          <div className={styles.chatEmpty}>
            <div className={styles.chatEmptyTitle}>{emptyTitle}</div>
            <div className={styles.chatEmptyDesc}>{emptyDesc}</div>
            {!keyOk && (
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  setSettingsSection("ai");
                  openDialog("settings");
                }}
              >
                打开设置
              </button>
            )}
          </div>
        ) : (
          visibleMessages.map((message, index) => {
            const last = message.ts === lastTs;
            const isStreaming = streaming && last && message.role === "assistant";
            const actionsDisabled = streaming;
            return (
              <div
                key={`${message.ts}-${index}`}
                className={clsx(
                  styles.msg,
                  message.role === "user" ? styles.msgUser : styles.msgAi,
                )}
              >
                <div className={styles.msgMeta}>
                  {message.role === "user" ? "你" : `AI · ${formatTime(message.ts)}`}
                </div>
                <pre className={styles.msgText}>
                  {message.content || (isStreaming ? "生成中…" : "")}
                </pre>
                {message.role === "assistant" && message.content && (
                  <div className={styles.msgActions}>
                    <button
                      type="button"
                      disabled={actionsDisabled || selectionChars === 0}
                      title={selectionChars === 0 ? "先在编辑器里选中文本" : "用结果替换选区"}
                      onClick={() => void applyMessage(message.content, "replace")}
                    >
                      替换选中
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => void applyMessage(message.content, "insert")}
                    >
                      插入
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => void copyMessage(message.content)}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => retry(message.ts)}
                    >
                      重试
                    </button>
                    {isStreaming && (
                      <button type="button" onClick={abortActive}>
                        停止
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {applied && (
        <div className={styles.snapshotBar}>
          {applied.hasSnapshot
            ? `修改前已存快照 · ${formatTime(applied.at)}`
            : `已应用 · ${formatTime(applied.at)}`}
          {applied.hasSnapshot && (
            <button type="button" onClick={() => openDialog("versions")}>
              查看
            </button>
          )}
        </div>
      )}

      <div className={styles.quickRow}>
        <span className={styles.quickLabel}>
          {settings.scope === "document"
            ? "对整篇文档："
            : selectionChars > 0
              ? "对选中文本："
              : "对当前段落："}
        </span>
        {QUICK_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            disabled={!canSend}
            onClick={() => void runRequest(QUICK_PROMPTS[key].instruction)}
          >
            {QUICK_PROMPTS[key].label}
          </button>
        ))}
        <button type="button" disabled={!canSend} onClick={() => inputRef.current?.focus()}>
          问 AI…
        </button>
      </div>

      <div className={styles.aiInput}>
        {error && <div className={styles.aiError}>{error}</div>}
        {notice && <div className={styles.aiNotice}>{notice}</div>}
        {!canRead && (
          <div className={styles.aiWarn}>本文档已禁止 AI 读取，输入已禁用。</div>
        )}
        {canRead && !keyOk && keyReady === false && (
          <div className={styles.aiWarn}>
            未配置 API Key。{" "}
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                setSettingsSection("ai");
                openDialog("settings");
              }}
            >
              去设置
            </button>
          </div>
        )}

        <div className={styles.aiBox}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            disabled={!canRead || !tab}
            placeholder={canRead ? "输入指令…" : "本文档禁止 AI 读取"}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // 中文输入法选词时的 Enter 不能当发送。
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitInput();
              }
            }}
          />
          {streaming ? (
            <button type="button" className={styles.sendBtn} onClick={abortActive}>
              停止
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendBtn}
              disabled={!canSend || !input.trim()}
              onClick={submitInput}
            >
              发送
            </button>
          )}
        </div>
        <div className={styles.aiHint}>
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span style={{ marginLeft: "auto" }}>
            {tab?.kind === "temp" ? "临时会话 · 关闭即清" : "仅本文档 · Ctrl+Shift+/ 关闭"}
          </span>
        </div>
      </div>
    </aside>
  );
}
