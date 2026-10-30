import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { stopRecovery } from "../editor/recovery";
import {
  EDITOR_BACKGROUNDS,
  resolveEditorBackground,
} from "../editor/background";
import { dropTabState } from "../editor/tabStates";
import {
  AI_CUSTOM_TEMPLATE,
  AI_TEMPLATE_KEYS,
  AI_TEMPLATES,
  NO_PRICE,
  aiConfigOf,
  applyTemplate,
  loadAiSettings,
  saveAiSettings,
  type AiPrice,
  type AiSettings,
} from "../lib/ai";
import { copyText } from "../lib/clipboard";
import { pickDirectory, refreshLibrary } from "../lib/documents";
import { ipc } from "../lib/ipc";
import type { AiTemplate } from "../lib/types";
import UsagePanel from "./UsagePanel";
import {
  useAppStore,
  type SettingsSection,
  type ThemeMode,
} from "../store/useAppStore";
import styles from "../styles/app.module.css";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "通用" },
  { id: "ai", label: "AI" },
  { id: "usage", label: "用量" },
  { id: "editor", label: "编辑器" },
  { id: "library", label: "文档库" },
  { id: "shortcuts", label: "快捷键" },
];

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Ctrl+N", label: "新建临时文档" },
  { keys: "Ctrl+O", label: "打开文件" },
  { keys: "Ctrl+S", label: "保存 / 保存到文档库" },
  { keys: "Ctrl+Shift+S", label: "导出副本" },
  { keys: "Ctrl+W", label: "关闭标签" },
  { keys: "Ctrl+Tab", label: "下一个标签" },
  { keys: "Ctrl+F / Ctrl+H", label: "查找 / 替换" },
  { keys: "Ctrl+P", label: "快速打开" },
  { keys: "Ctrl+,", label: "设置" },
  { keys: "Ctrl+/", label: "注释 / 取消注释" },
  { keys: "Ctrl+Shift+V", label: "Markdown 预览 / 源码切换" },
  { keys: "Ctrl+Shift+/", label: "开关 AI 侧栏" },
  { keys: "Esc", label: "关闭浮层 / 面板" },
];

export default function SettingsDialog() {
  const closeDialog = useAppStore((s) => s.openDialog);
  const section = useAppStore((s) => s.settingsSection);
  const setSection = useAppStore((s) => s.setSettingsSection);
  const docs = useAppStore((s) => s.docs);
  const categories = useAppStore((s) => s.categories);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const fontSize = useAppStore((s) => s.fontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const lineHeight = useAppStore((s) => s.lineHeight);
  const setLineHeight = useAppStore((s) => s.setLineHeight);
  const editorBackground = useAppStore((s) => s.editorBackground);
  const setEditorBackground = useAppStore((s) => s.setEditorBackground);
  const closeToTray = useAppStore((s) => s.closeToTray);
  const setCloseToTray = useAppStore((s) => s.setCloseToTray);
  const globalShortcut = useAppStore((s) => s.globalShortcut);
  const setGlobalShortcut = useAppStore((s) => s.setGlobalShortcut);
  const bumpAiSettings = useAppStore((s) => s.bumpAiSettings);

  const [busy, setBusy] = useState("");
  const [libMessage, setLibMessage] = useState("");
  const [libError, setLibError] = useState("");

  const [ai, setAi] = useState<AiSettings>(loadAiSettings);
  const [keyStatus, setKeyStatus] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState("");
  // AI 配置改成显式保存：改动先进草稿，点右下角「保存」才写偏好。
  const [aiDirty, setAiDirty] = useState(false);
  const [saveHint, setSaveHint] = useState("");

  // 服务模板分两个标签页：常用服务商 / 自定义（只走 OpenAI 协议）。
  const [templateTab, setTemplateTab] = useState<"common" | "custom">(
    ai.template === AI_CUSTOM_TEMPLATE ? "custom" : "common",
  );
  const [lastCommon, setLastCommon] = useState<AiTemplate>(
    ai.template === AI_CUSTOM_TEMPLATE ? "deepseek" : ai.template,
  );
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsMessage, setModelsMessage] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  // 下拉用 portal 渲染，位置按输入框实测坐标算，避免被设置页滚动区裁掉。
  const [listPos, setListPos] = useState<{
    left: number;
    width: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  // 最近一次成功拉取时的「模板|地址」，避免反复点输入框重复请求。
  const fetchedForRef = useRef("");
  // 同步锁：focus 与 click 可能连着触发两次。
  const fetchingRef = useRef(false);

  const [shortcutDraft, setShortcutDraft] = useState(globalShortcut);
  const [shortcutMessage, setShortcutMessage] = useState("");

  const totalBytes = docs.reduce((sum, doc) => sum + doc.sizeBytes, 0);
  const customColor = editorBackground.startsWith("custom:")
    ? editorBackground.slice("custom:".length)
    : "#f6efdf";
  const editorBgLabel = resolveEditorBackground(editorBackground).label;

  const refreshKey = useCallback(async () => {
    try {
      setKeyStatus(await ipc.getSecretStatus(ai.template));
    } catch {
      setKeyStatus(false);
    }
  }, [ai.template]);

  useEffect(() => {
    void refreshKey();
  }, [refreshKey]);

  const updateAi = (patch: Partial<AiSettings>) => {
    setAi({ ...ai, ...patch });
    setAiDirty(true);
    setSaveHint("");
  };

  const isCustom = ai.template === AI_CUSTOM_TEMPLATE;
  const price = ai.prices[ai.template] ?? NO_PRICE;
  const updatePrice = (patch: Partial<AiPrice>) => {
    updateAi({ prices: { ...ai.prices, [ai.template]: { ...price, ...patch } } });
  };

  const copyBaseUrl = async () => {
    if (!(await copyText(ai.baseUrl.trim()))) return;
    setUrlCopied(true);
    window.setTimeout(() => setUrlCopied(false), 1200);
  };

  const changeTemplate = (template: AiTemplate) => {
    setAi(applyTemplate(ai, template));
    setAiDirty(true);
    setSaveHint("");
    setTestResult("");
    setModels([]);
    setModelsMessage("");
    fetchedForRef.current = "";
  };

  // 所有 AI 配置改完后点右下角「保存」才落盘；顺手把还没保存的 Key 一起写进凭据管理器。
  const saveAi = async () => {
    let keyError = "";
    if (keyInput.trim()) {
      try {
        await ipc.setSecret(ai.template, keyInput.trim());
        setKeyInput("");
        setKeyStatus(true);
      } catch (err) {
        keyError = err instanceof Error ? err.message : "密钥保存失败";
      }
    }
    saveAiSettings(ai);
    bumpAiSettings();
    setAiDirty(false);
    setSaveHint(keyError ? `配置已保存，但密钥保存失败：${keyError}` : "AI 配置已保存");
  };

  const pickCommonTemplate = (template: AiTemplate) => {
    setLastCommon(template);
    changeTemplate(template);
  };

  const switchTemplateTab = (tab: "common" | "custom") => {
    if (tab === templateTab) return;
    setTemplateTab(tab);
    changeTemplate(tab === "custom" ? AI_CUSTOM_TEMPLATE : lastCommon);
  };

  // 按当前 Base URL + Key 拉取模型列表；没保存的 Key 只在这次请求里用，不落库。
  const fetchModels = async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setModelsBusy(true);
    setModelsMessage("");
    try {
      const list = await ipc.aiListModels(
        ai.template,
        ai.baseUrl.trim(),
        keyInput.trim() || undefined,
      );
      setModels(list);
      fetchedForRef.current = `${ai.template}|${ai.baseUrl.trim()}`;
      setModelsMessage(`已获取 ${list.length} 个模型`);
      // 只在模型为空时补一个默认值，别覆盖用户手动填的。
      if (!ai.model.trim()) updateAi({ model: list[0] });
    } catch (err) {
      setModels([]);
      setModelsMessage(err instanceof Error ? err.message : "获取模型失败");
    } finally {
      fetchingRef.current = false;
      setModelsBusy(false);
    }
  };

  // 点进模型输入框就自动拉取；同一模板 + 地址只拉一次，失败后点一下可重试。
  const autoFetchModels = () => {
    if (fetchingRef.current) return;
    if (fetchedForRef.current === `${ai.template}|${ai.baseUrl.trim()}`) return;
    if (!ai.baseUrl.trim()) {
      setModelsMessage("先填写 Base URL，再点模型框拉取列表");
      return;
    }
    if (!keyStatus && !keyInput.trim()) {
      setModelsMessage("先保存 API Key，再点模型框拉取列表");
      return;
    }
    void fetchModels();
  };

  // 下拉贴着输入框，空间不够就向上翻。
  const positionModelList = () => {
    const input = modelInputRef.current;
    if (!input) return null;
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < 180 && above > below;
    const maxHeight = Math.min(320, Math.max(120, upward ? above : below));
    return {
      left: rect.left,
      width: rect.width,
      top: upward ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
      maxHeight,
    };
  };

  const openModelList = () => {
    setListPos(positionModelList());
    setModelsOpen(true);
    autoFetchModels();
  };

  // 面板滚动 / 窗口缩放时跟着输入框走。
  useEffect(() => {
    if (!modelsOpen) return;
    const sync = () => setListPos(positionModelList());
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [modelsOpen]);

  const testConnection = async () => {
    setTestBusy(true);
    setTestResult("");
    try {
      const ms = await ipc.aiTestConnection(aiConfigOf(ai));
      setTestResult(`连接正常 · ${ms} ms`);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "连接失败");
    } finally {
      setTestBusy(false);
    }
  };

  const applyShortcut = () => {
    const value = shortcutDraft.trim();
    if (!value) {
      setShortcutMessage("快捷键不能为空");
      return;
    }
    setGlobalShortcut(value);
    setShortcutMessage(`已提交 ${value}；被其他程序占用时可能不生效。`);
  };

  const runLibrary = async (label: string, task: () => Promise<string>) => {
    setBusy(label);
    setLibMessage("");
    setLibError("");
    try {
      setLibMessage(await task());
    } catch (err) {
      setLibError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const backup = () =>
    runLibrary("backup", async () => {
      const dir = await pickDirectory("选择备份位置");
      if (!dir) return "已取消";
      const report = await ipc.backupLibrary(dir);
      return `已备份 ${report.docs} 篇文档、${report.categories} 个分类。`;
    });

  const restore = () =>
    runLibrary("restore", async () => {
      const dir = await pickDirectory("选择备份目录");
      if (!dir) return "已取消";
      if (!window.confirm("恢复会覆盖当前文档库，恢复前会自动备份当前库。继续？")) {
        return "已取消";
      }
      await ipc.restoreLibrary(dir);
      const state = useAppStore.getState();
      for (const tab of state.tabs.filter((item) => item.kind === "library")) {
        if (tab.docId) {
          // 库被整库替换，旧标签的恢复快照也一并清掉。
          stopRecovery(tab.id);
          void ipc.dropRecovery(tab.docId).catch(() => undefined);
        }
        dropTabState(tab.id);
        state.closeTab(tab.id);
      }
      await refreshLibrary();
      return "恢复完成，已关闭库内文档标签。";
    });

  const relocate = () =>
    runLibrary("relocate", async () => {
      const dir = await pickDirectory("选择新的库位置");
      if (!dir) return "已取消";
      await ipc.relocateLibrary(dir);
      await refreshLibrary();
      return "迁移完成，库已复制到新位置，旧库保留未删除。";
    });

  return (
    <div className={styles.scrim}>
      <div className={clsx(styles.modal, styles.modalWide, styles.settingsModal)}>
        <div className={styles.mHd}>
          <b>设置</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={() => closeDialog("none")}>
            ×
          </button>
        </div>

        <div className={styles.settingsBody}>
          <nav className={styles.settingsNav} aria-label="设置分区">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={clsx(
                  styles.settingsNavItem,
                  section === item.id && styles.settingsNavActive,
                )}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className={styles.settingsPane}>
            {section === "general" && (
              <>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>主题</label>
                  <select
                    className={styles.select}
                    value={themeMode}
                    onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
                  >
                    {THEME_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={closeToTray}
                    onChange={(event) => setCloseToTray(event.target.checked)}
                  />
                  <span>关闭窗口时收进托盘</span>
                </label>
                <div className={styles.desc}>
                  取消勾选后，关闭按钮会走退出流程（逐个确认未保存的文档）。托盘左键显示/隐藏，右键可新建或退出。
                </div>
              </>
            )}

            {section === "ai" && (
              <>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>服务模板</label>
                  <div className={styles.seg}>
                    <button
                      type="button"
                      className={clsx(styles.segBtn, templateTab === "common" && styles.segActive)}
                      onClick={() => switchTemplateTab("common")}
                    >
                      常用服务商
                    </button>
                    <button
                      type="button"
                      className={clsx(styles.segBtn, templateTab === "custom" && styles.segActive)}
                      onClick={() => switchTemplateTab("custom")}
                    >
                      自定义服务商
                    </button>
                  </div>
                  {templateTab === "common" ? (
                    <select
                      className={styles.select}
                      style={{ marginTop: 8 }}
                      value={ai.template === AI_CUSTOM_TEMPLATE ? lastCommon : ai.template}
                      onChange={(event) =>
                        pickCommonTemplate(event.target.value as AiTemplate)
                      }
                    >
                      {AI_TEMPLATE_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {AI_TEMPLATES[key].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className={styles.desc} style={{ marginTop: 8 }}>
                      自定义服务商只支持 OpenAI 协议：填到 /v1 的 Base URL，再用下方按钮拉取模型。
                    </div>
                  )}
                  <div className={styles.desc}>切换模板会填入该服务的 Base URL 与默认模型。</div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Base URL</label>
                  <div className={styles.actionRow} style={{ marginBottom: 0 }}>
                    <input
                      className={clsx(styles.input, !isCustom && styles.inputLocked)}
                      style={{ flex: 1, width: "auto", minWidth: 0 }}
                      value={ai.baseUrl}
                      spellCheck={false}
                      disabled={!isCustom}
                      onChange={(event) => {
                        // 地址变了，模型列表就作废，下次点模型框重新拉。
                        updateAi({ baseUrl: event.target.value });
                        setModels([]);
                        setModelsMessage("");
                        fetchedForRef.current = "";
                      }}
                    />
                    {!isCustom && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => void copyBaseUrl()}
                      >
                        {urlCopied ? "已复制" : "复制"}
                      </button>
                    )}
                  </div>
                  <div className={styles.desc}>
                    {isCustom
                      ? "只支持 OpenAI 兼容协议，通常填到 /v1 即可。"
                      : "常用服务商的地址固定；要改地址请切到「自定义服务商」。"}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>API Key</label>
                  <input
                    className={styles.input}
                    type="password"
                    value={keyInput}
                    placeholder={keyStatus ? "已配置，输入新 Key 可替换" : "未配置"}
                    onChange={(event) => {
                      setKeyInput(event.target.value);
                      if (event.target.value.trim()) {
                        setAiDirty(true);
                        setSaveHint("");
                      }
                    }}
                  />
                  <div className={styles.desc}>
                    Key 只存 Windows 凭据管理器；界面和日志里只有「是否已配置」。填好后点右下角「保存」写入。
                    {keyStatus ? " 当前：已配置。" : " 当前：未配置。"}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>模型</label>
                  <div className={styles.modelField}>
                    <input
                      ref={modelInputRef}
                      className={styles.input}
                      value={ai.model}
                      spellCheck={false}
                      placeholder={
                        modelsBusy ? "正在获取模型…" : "点这里拉取模型，或直接填写模型名"
                      }
                      onFocus={openModelList}
                      onClick={openModelList}
                      onBlur={() => setModelsOpen(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setModelsOpen(false);
                      }}
                      onChange={(event) => updateAi({ model: event.target.value })}
                    />
                  </div>
                  {modelsMessage && <div className={styles.desc}>{modelsMessage}</div>}
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Temperature · {ai.temperature.toFixed(1)}</label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={ai.temperature}
                    onChange={(event) => updateAi({ temperature: Number(event.target.value) })}
                  />
                  <div className={styles.desc}>
                    回答的随机度，范围 0–2。数值越大越发散、越有变化；越小越稳定、越贴近固定答案。写作用 0.7 左右，要可复现的结果调到 0.2。
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>计费（元 / 百万 tokens）</label>
                  <div className={styles.priceRow}>
                    <label className={styles.priceCell}>
                      <span>输入</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={0}
                        step="0.1"
                        value={price.input}
                        onChange={(event) => updatePrice({ input: Number(event.target.value) || 0 })}
                      />
                    </label>
                    <label className={styles.priceCell}>
                      <span>输出</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={0}
                        step="0.1"
                        value={price.output}
                        onChange={(event) => updatePrice({ output: Number(event.target.value) || 0 })}
                      />
                    </label>
                    <label className={styles.priceCell}>
                      <span>缓存命中</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={0}
                        step="0.1"
                        value={price.cacheInput}
                        onChange={(event) =>
                          updatePrice({ cacheInput: Number(event.target.value) || 0 })
                        }
                      />
                    </label>
                  </div>
                  <div className={styles.desc}>
                    只用于「用量」页估算费用，不影响请求。全填 0 表示不计费用；缓存命中价留空按输入价算。
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>请求范围</label>
                  <select
                    className={styles.select}
                    value={ai.scope}
                    onChange={(event) =>
                      updateAi({ scope: event.target.value as AiSettings["scope"] })
                    }
                  >
                    <option value="selection">仅选中（无选中时用当前段落）</option>
                    <option value="document">整篇文档</option>
                  </select>
                </div>

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={testBusy}
                    onClick={() => void testConnection()}
                  >
                    {testBusy ? "测试中…" : "测试连接"}
                  </button>
                </div>
                {testResult && <div className={styles.desc}>{testResult}</div>}
              </>
            )}

            {section === "usage" && <UsagePanel />}

            {section === "editor" && (
              <>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>字号</label>
                  <div className={styles.sliderRow}>
                    <input
                      className={styles.slider}
                      type="range"
                      min={12}
                      max={22}
                      step={1}
                      value={fontSize}
                      onChange={(event) => setFontSize(Number(event.target.value))}
                    />
                    <span className={styles.sliderValue}>{fontSize}px</span>
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>行高</label>
                  <div className={styles.sliderRow}>
                    <input
                      className={styles.slider}
                      type="range"
                      min={1.2}
                      max={2.2}
                      step={0.05}
                      value={lineHeight}
                      onChange={(event) => setLineHeight(Number(event.target.value))}
                    />
                    <span className={styles.sliderValue}>{lineHeight.toFixed(2)}</span>
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>编辑区背景</label>
                  <div className={styles.bgGrid}>
                    <button
                      type="button"
                      className={clsx(
                        styles.bgOption,
                        editorBackground === "theme" && styles.bgOptionActive,
                      )}
                      title="跟随应用主题"
                      onClick={() => setEditorBackground("theme")}
                    >
                      <span className={clsx(styles.bgSwatch, styles.bgThemeSwatch)} />
                      <span>跟随主题</span>
                    </button>
                    {EDITOR_BACKGROUNDS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={clsx(
                          styles.bgOption,
                          editorBackground === preset.id && styles.bgOptionActive,
                        )}
                        title={`${preset.label} · ${preset.color}`}
                        onClick={() => setEditorBackground(preset.id)}
                      >
                        <span
                          className={styles.bgSwatch}
                          style={{ background: preset.color }}
                        />
                        <span>{preset.label}</span>
                      </button>
                    ))}
                    <label
                      className={clsx(
                        styles.bgOption,
                        styles.bgCustom,
                        editorBackground.startsWith("custom:") && styles.bgOptionActive,
                      )}
                      title="自定义背景色"
                    >
                      <input
                        type="color"
                        className={styles.bgColorInput}
                        value={customColor}
                        onChange={(event) =>
                          setEditorBackground(`custom:${event.target.value}`)
                        }
                      />
                      <span>自定义</span>
                    </label>
                  </div>
                  <div className={styles.desc}>
                    只改编辑区，正文、行号、选区与查找面板会自动匹配明暗。当前：{editorBgLabel}。
                  </div>
                </div>

                <div className={styles.desc}>修改立即生效并持久化，不重建编辑器。</div>
              </>
            )}

            {section === "library" && (
              <>
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
                    备份包含正文、分类索引、AI 会话与版本；恢复前会自动把当前库另存一份。
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
                    先把整库复制到新位置，校验通过后切换指向；旧库默认保留。
                  </div>
                </div>

                {libMessage && <div className={styles.desc}>{libMessage}</div>}
                {libError && <div className={styles.error}>{libError}</div>}
              </>
            )}

            {section === "shortcuts" && (
              <>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>全局唤起</label>
                  <div className={styles.actionRow}>
                    <input
                      className={styles.input}
                      style={{ flex: 1, width: "auto", minWidth: 0 }}
                      value={shortcutDraft}
                      spellCheck={false}
                      onChange={(event) => setShortcutDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => {
                        setShortcutDraft("Ctrl+Alt+N");
                        setShortcutMessage("输入框已恢复默认，点「应用」生效。");
                      }}
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={applyShortcut}
                    >
                      应用
                    </button>
                  </div>
                  <div className={styles.desc}>
                    格式如 Ctrl+Alt+N。被其他程序占用时可能注册失败，换一个组合即可。
                  </div>
                  {shortcutMessage && <div className={styles.desc}>{shortcutMessage}</div>}
                </div>

                <div className={styles.shortcutList}>
                  {SHORTCUTS.map((item) => (
                    <div key={item.keys} className={styles.shortcutRow}>
                      <span>{item.label}</span>
                      <kbd>{item.keys}</kbd>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.mFt}>
          {saveHint && <span className={styles.mFtHint}>{saveHint}</span>}
          {aiDirty && !saveHint && <span className={styles.mFtHint}>AI 配置有改动未保存</span>}
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={() => closeDialog("none")}>
            关闭
          </button>
          {(section === "ai" || aiDirty) && (
            <button
              type="button"
              className={clsx(styles.btn, styles.btnPrimary)}
              disabled={!aiDirty}
              onClick={() => void saveAi()}
            >
              保存
            </button>
          )}
        </div>
      </div>

      {modelsOpen &&
        models.length > 0 &&
        listPos &&
        createPortal(
          <div
            className={styles.modelList}
            role="listbox"
            style={{
              left: listPos.left,
              width: listPos.width,
              top: listPos.top,
              maxHeight: listPos.maxHeight,
            }}
          >
            {models.map((name) => (
              <button
                key={name}
                type="button"
                className={clsx(styles.modelItem, name === ai.model && styles.modelItemActive)}
                // 阻止默认按下行为，避免输入框先失焦导致列表消失。
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  updateAi({ model: name });
                  setModelsOpen(false);
                }}
              >
                {name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
