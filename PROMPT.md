# 桌面笔记 / 本地文档库 —— 开发提示词

## 0. 你的角色

你是一名资深桌面应用工程师，精通 Tauri 2 / Rust / React 19 / TypeScript / CodeMirror 6。
我们协作从零构建一个 Windows 优先的轻量文本编辑器 + 本地文档库。请严格按本文档执行：

- **不要更换技术栈**，不要提议 Electron / Flutter / 原生 / Web 在线版。
- **不要引入未列出的重型依赖**（尤其不要引 Ant Design / MUI / 任何全量 UI 框架）。
- 文档没覆盖到的小决策，选最简方案，在代码注释里标 `// DECISION:` 说明，然后继续，不要停下来问我。
- 每完成一个阶段（见 §9）**停下来汇报**：做了什么、怎么手动验证、有哪些偏差。等我确认再进入下一阶段。

---

## 1. 产品定位

一个**轻量、秒开、本地优先**的 Windows 桌面文本 / 笔记编辑器，外加一个**不暴露路径的本地文档库**。用来替代 Notepad++ / Sublime Text / 记事本重叠的那部分日常场景：随手记笔记、看代码、写 Markdown、翻日志。

和普通编辑器的差别在于：文档不再以"文件在哪"组织，而是"文档是什么、属于哪一类"。打开桌面文件默认是**临时文档**，想留下就保存进库并选分类；库里的文档只按分类找，界面上任何地方都不出现磁盘路径。

**体验红线（任何设计决策都不能破坏）**：

1. 冷启动 < 1s（WebView2 已预热的常规情况）
2. 打开 1MB 文件 < 300ms；切换标签页不卡顿
3. 界面克制——没有引导页、没有登录、没有云同步提示、没有一堆用不上的工具栏
4. 临时文档不打扰：自动保存，但不弹"已保存"、不进库、不推分类

产品气质参考：Sublime 的快捷键习惯 + Typora 的安静 + Notepad 的"点开就能写"。

---

## 2. 技术栈（固定）

| 层 | 选型 |
|---|---|
| 应用壳 | Tauri 2（最新稳定版） |
| 前端 | React 19 + TypeScript 5 + Vite |
| 编辑器 | CodeMirror 6 |
| 状态 | Zustand（只放元数据，见 §3） |
| 样式 | 原生 CSS Modules + CSS 变量，不引组件库，不用 Tailwind |
| 后端 | Rust（文件 IO / 编码 / 搜索 / 文档库 / 系统集成 / 密钥） |
| 打包 | NSIS（Windows），预留 macOS dmg 配置 |

依赖白名单：

- 前端：`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-opener`、`@tauri-apps/plugin-global-shortcut`、`@tauri-apps/plugin-store`、`@tauri-apps/plugin-http`、`zustand`、`clsx`
- 编辑器：`codemirror`、`@codemirror/state`、`@codemirror/view`、`@codemirror/commands`、`@codemirror/language`、`@codemirror/language-data`、`@codemirror/search`、`@codemirror/autocomplete`、`@codemirror/lang-markdown`、`@lezer/highlight`
- Rust：`tauri-plugin-*` 官方插件、`encoding_rs`、`chardetng`、`walkdir`、`regex`、`notify`、`keyring`、`trash`、`serde`

> 备份 / 迁移**不引 zip 依赖**：直接复制库目录并校验，用户得到的是一个可直接打开的文件夹。

---

## 3. 架构约定（必须遵守，违反会导致后期重构）

1. **编辑器非受控**。文档正文**绝不**放进 React state / Zustand。
   - 每个打开的文件持有一份独立的 `EditorState`，存在模块级 `Map<tabId, { state, view }>` 里。
   - React 组件只通过 `ref` 拿 `EditorView`，只订阅元数据（标题、脏标记、光标行列、滚动位置）。
   - 单一 `EditorView` 实例复用：切换标签 = `view.setState(stateMap.get(tabId).state)`，销毁前把当前 state 存回 Map。
2. **所有文件读写走 Rust 命令**，前端不用 `fs` 插件直连磁盘——因为需要编码探测、BOM、换行符保留、大文件判断，这些只能在 Rust 侧干净地做。
3. **IPC 必须类型化**。`src/lib/ipc.ts` 统一封装所有 `invoke`，每个命令的入参/返回值都有 TS 类型，前端任何地方不得直接 `invoke("xxx")`。
4. **AI 请求走 `@tauri-apps/plugin-http`**（绕开 WebView CORS）。若该插件的流式响应不可用，退化为 "Rust 侧 reqwest + emit 事件推送 chunk"，不要退回普通 window.fetch。
5. **文档分两层，不是两种格式**：
   - **临时文档**：没有 `docId`，只有 `tabId`；自动保存到本机 scratch 目录，**不进文档库**；AI 会话仅存内存。
   - **常驻文档**：入库时生成 `docId`，正文在库内，有分类、有 AI 对话历史、有版本快照。
6. **库内路径不可见**：UI 不显示、不复制、不提示文档的磁盘位置。唯一例外是设置页的"库位置"，因为迁移必须让用户选目录。

---

## 4. 功能范围

### MVP（必须做）

**编辑器**
- 新建 / 打开 / 保存 / 另存为、多标签页（脏标记、中键关闭、Ctrl+Tab）
- 按扩展名自动识别语言并语法高亮
- 编码探测与保留（UTF-8 / UTF-8 BOM / GBK / GB18030 / UTF-16LE），换行符 CRLF/LF 保留
- 大文件自动降级
- 查找替换（当前文件，支持正则）
- Markdown 实时渲染：编辑区内隐藏标记、光标行保持源码，`Ctrl+Shift+V` 切换源码态
- 浅色/深色主题，跟随系统

**文档库**
- 临时文档：新建 / 拖入 / 双击关联文件 / 命令行打开，自动保存（防抖），关闭标签不删文件（侧栏记录仍在）
- 保存到文档库：填名称 + 选分类，生成 `docId`
- 分类树：**支持嵌套**，可新建 / 重命名 / 移动 / 删除，内置「未分类」
- 侧栏：分类树 + 临时区 + 搜索 + 修改标记 + 拖拽移动 + 宽度可调
- 导入：多选文件，逐条选分类，复制入库
- 导出：复制副本到桌面或指定目录，不暴露库路径
- 备份 / 恢复 / 迁移：整库复制、校验、切换指向

**AI**
- 右侧固定栏，单文档会话（不跨文档、不建全局记忆）
- 选中文本 → 快捷工具条（润色 / 摘要 / 翻译 / 续写 / 自定义）
- 流式返回，可插入或替换
- 一键清空当前会话
- 每篇文档可标记「不允许 AI 读取」
- 应用 AI 修改前自动存版本快照，可还原
- 独立设置页：Base URL / Key / Model / Temperature / 请求范围

**系统**
- 全局快捷键唤起、托盘常驻、单实例、文件关联、拖拽入窗
- 崩溃恢复（常驻文档恢复未保存改动；临时文档恢复自动保存内容）

### 二期（先不做，但结构要留口子）

库内全文搜索、多窗口、导出 PDF/HTML、自定义主题、插件机制、分类多选/标签、导入整个文件夹、AI 会话导出。

### 明确不做

云同步、账号体系、协作、所见即所得块编辑器、附件/图片管理、移动端、AI 跨文档检索。

---

## 5. 关键实现要求

### 5.1 多格式识别与语法高亮

用 `@codemirror/language-data` 的 `languages` 数组做后缀映射，不要手写 if-else：

```ts
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";

const desc = LanguageDescription.matchFilename(languages, filename); // 同步、按扩展名/文件名匹配
const support = desc ? await desc.load() : null;                     // 按需懒加载语言包
```

要求：

- 覆盖 `.md .txt .json .js .ts .tsx .jsx .py .go .rs .java .c .cpp .h .css .scss .html .xml .yaml .yml .toml .ini .sql .sh .ps1 .bat .log .csv` 等常见后缀；未知后缀降级为纯文本但**保留编辑能力**。
- `.md` 用 `@codemirror/lang-markdown`，并配置 `codeLanguages: languages`，让 Markdown 内的 ```lang 代码块**嵌套高亮**。
- 语言包必须**懒加载**（`desc.load()` 是异步的），首次打开某类文件时可以短暂无高亮，但**不能阻塞编辑器挂载**。
- 状态栏显示当前识别到的语言名，点击可手动切换（覆盖自动识别结果，仅当前标签生效）。
- 不要把语言模式写进文档元数据——每次打开重新按后缀识别。

### 5.2 编码与换行符

Rust 侧 `read_text_file` 的职责：

1. 按 BOM 判断（UTF-8 BOM / UTF-16LE BOM / UTF-16BE BOM）。
2. 无 BOM 时用 `chardetng` 猜编码，拿到候选后**必须实际解码验证**（`encoding_rs` 解码后检查有无替换字符 U+FFFD），失败则回退 `GB18030` → `UTF-8` 顺序试探。
3. 探测换行符：出现 `\r\n` 记为 CRLF，否则 LF（混合时取多数并记录）。
4. 返回：`{ content, encoding, hasBom, lineEnding, sizeBytes, truncated }`。

保存时**按原编码 / 原 BOM / 原换行符写回**，用户没主动改就不许变。入库时沿用当前编码；导出时同样沿用。

前端状态栏必须显示：`GBK | CRLF`，并允许点击临时改成 UTF-8 / LF（改动只影响本次保存）。

### 5.3 大文件降级

分三档，在 `createEditor` 里用不同的扩展集合实现，切换文件时按档位重建：

| 档位 | 条件 | 扩展 |
|---|---|---|
| 完整 | < 2MB | 全部：高亮、折叠、行号、括号匹配、自动补全、搜索 |
| 精简 | 2MB ~ 20MB | 去掉语法高亮、折叠、自动补全；保留行号、搜索、行折叠 |
| 纯文本 | > 20MB 或 `truncated` | 只保留基础编辑 + 查找；顶部显示黄色提示条"大文件模式，已关闭语法高亮" |

阈值写在 `src/editor/config.ts`，便于调整。

### 5.4 标签页与快捷键

快捷键（Windows 语义，`Mod` = Ctrl）：

| 快捷键 | 行为 |
|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | 新建（临时）/ 打开（临时）/ 保存 / 另存为/导出副本 |
| `Ctrl+W` / `Ctrl+Shift+T` | 关闭标签 / 恢复刚关闭的标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换（`@codemirror/search` 自带面板，不要自己造） |
| `Ctrl+P` | 快速打开（在文档库 + 临时区按标题模糊搜索） |
| `Ctrl+,` | 设置 |
| `Ctrl+/` | 注释 / 取消注释 |
| `Ctrl+Shift+V` | Markdown 实时渲染 / 源码切换（Typora 式，仅 md 生效） |
| `Ctrl+Shift+/` | 开关 AI 侧栏 |
| `Esc` | 关闭当前浮层/面板 |

规则：

- **所有文档都是「副本编辑」**：打开即生成一份草稿快照，正文文件只在保存那一刻被覆盖。
- 关闭标签不弹确认、不丢内容：临时文档落 scratch，常驻文档落 recovery 快照，下次打开直接接着改。
- `Ctrl+S`：常驻文档 = 覆盖库内正文；从磁盘拖入/打开的临时文档 = 覆盖原文件；`+` 新建且没有源文件的临时文档 = 弹「保存到文档库」。
- 快捷键注册在 CodeMirror 的 keymap **和** 全局 keydown 两处，注意避免编辑器内输入被误触发（用 `Mod-` 且排除 `when` 条件；`view.composing` 为 true 时一律放行）。

### 5.5 自动保存、恢复与版本

**临时文档（scratch）**

- 输入停止 800ms 后自动写入 `scratch/<tabId>.md`（原子写：临时文件 + rename），**不弹提示、不打断输入**。
- 临时文件分两种：`+`/`Ctrl+N` 新建（source=new，文件就在 scratch 目录），以及拖入/双击/命令行打开（source=file，记录原路径）。
- **关闭标签不删除临时文件**，也不弹确认；内容在关闭前立刻落盘，侧栏「临时文档」按记录展示，点击可重新打开。
- 删除入口在侧栏每行的 `×`：source=new 确认后删除临时文件；source=file 只删记录，磁盘上的文件不动。
- 应用退出时保留 scratch；下次启动恢复最多 10 个临时文档到临时区（按修改时间倒序）。
- scratch 目录不参与备份、不迁移、不进文档库。

**常驻文档**

- **不自动覆盖库内正文**（除显式 `Ctrl+S`）。这一点不能妥协。
- 有未保存改动时每 5s 写 `recovery/<docId>.snap`（含原编码、换行符、时间戳）；关闭标签前立刻补写一次。
- 打开文档时若存在快照且内容不同 → 直接用快照内容打开并标脏（不再弹"是否恢复"）。
- 只有显式保存才删除对应恢复快照；未保存的改动会一直留着，直到保存。
- 恢复目录总量超 100MB 时按最旧优先清理。

**从磁盘打开的临时文件**

- 打开时记下 `path` 与文件 mtime；编辑只改副本，磁盘文件不变。
- 窗口重新聚焦 / 切换标签时比对 mtime：文件被外部改过就显示提示条「已被外部修改，当前编辑的是副本」，可「重新加载」（读取磁盘内容、丢弃当前修改、删掉旧快照并按磁盘内容重建）或「保留当前」（只把基线 mtime 推到最新）。
- `Ctrl+S` 把副本写回原文件，并同步快照、清掉脏标记。

**标签页**：常驻与临时用顶部色条区分（常驻蓝、临时琥珀）。

**版本快照（AI 修改前置）**

- 每次应用 AI 生成的修改前，先把当前正文完整存到 `versions/<docId>/<ts>.snap`，记录 `source: "before-ai"`；临时文档不产生版本，只保留那一份草稿快照。
- 手动还原也算一次修改，还原前同样存快照（`source: "before-restore"`）。
- 每篇文档保留最近 20 份，超出删最旧；版本目录总占用超 200MB 时按最旧清理。

### 5.6 搜索

- 单文件查找替换用 `@codemirror/search`，开启 `regexp` 与 `wholeWord` 选项。
- 侧栏搜索与 `Ctrl+P` 只按**标题**过滤，输入即筛、Esc 清空、上下键选择、Enter 打开。
- 库内全文搜索放二期：Rust 遍历 `library/docs` + `regex`，通过 event 分批回传（每 200 条 flush 一次），跳过二进制文件。

### 5.7 AI 助理

**右侧固定侧栏，单文档会话。不做跨文档记忆，不做全局助手。**

结构与交互：

1. 面板可拖宽（小 300、默认 356、大 560），`Ctrl+Shift+/` 或状态栏 `AI` 项开关；打开时状态栏该项高亮。
2. 上下文条：当前文档标题 + `仅本文档` + 已读大小 / 已选字数 + 「允许读取」开关。
3. 对话流：用户消息与 AI 结果按时间线性排列，AI 结果为等宽纯文本（不引 Markdown 渲染器）。
4. 每条结果下挂操作：`替换选中` `插入到光标后` `复制` `重试` `停止`；应用后提示「修改前已存快照 · 时间 · 查看」。
5. 顶部提供**清空会话**：二次确认后删除 `chats/<docId>.json`，上下文归零，历史不可恢复。
6. 选中文本时编辑器浮出快捷工具条（润色 / 摘要 / 翻译 / 续写 / 问 AI…），点击把指令带入侧栏执行。
7. 无选中时，指令作用于当前段落。

会话存储：

- 常驻文档：`chats/<docId>.json`，`[{ role, content, ts }]`，仅当前文档可读；面板默认展示最近 50 轮。
- 临时文档：仅内存，关闭即清，面板里明确写"临时文档不保留对话"。
- 切换标签时切上下文，只有当前 `docId` 的历史可见。**任何请求载荷不得包含其他文档内容。**

禁止 AI 读取：

- `DocMeta.aiReadable`（默认 true）。关闭后侧栏该文档显示锁标记、AI 输入框禁用并说明理由。
- **Rust 侧二次校验**：请求命令收到 `docId` 时检查该标记，为 false 直接返回错误，不发出网络请求。
- 临时文档可在面板内临时关闭本次会话，不写入任何元数据。

修改应用：

- 必须走单次 transaction dispatch，保证 `Ctrl+Z` 一次回到原文。
- 只替换选中的范围，不整篇重写；替换前存版本快照。
- 长文档里 AI 返回内容与原选区长度差异大时，不做自动扩散。

配置（设置页）：

- Base URL、API Key、Model、Temperature、请求范围（仅选中 / 整篇），兼容 OpenAI Chat Completions 格式。AI 分区所有改动先进草稿，点对话框右下角「保存」统一落盘（含未保存的 Key）。
- 拉取模型时未保存的 Key 只在本次请求里传给 Rust，不落库。
- 常用服务商的 Base URL 只读（可一键复制），切到「自定义服务商」才能改。
- **用量统计**：每次调用追加一行 JSONL（`appdata/usage/usage-YYYY-MM.jsonl`，保留 12 个月），记录输入/输出/缓存命中 tokens、耗时与提示词摘要；设置页「用量」按日/周/月聚合展示，费用按 AI 页配置的单价（元/百万 tokens）估算。
- 预置常用服务商：DeepSeek、通义千问、GLM Token Plan CN、Kimi Token Plan CN、MiMo Token Plan CN、Agnes、本地 Ollama（`http://localhost:11434/v1`）；服务模板用「常用服务商 / 自定义服务商」两个标签页切换，自定义只支持 OpenAI 协议。
- 模型列表点输入框自动拉取：`GET {Base URL}/models`（带已存 Key），下拉可选也可手填。
- **API Key 存 Windows 凭据管理器**（Rust `keyring` crate，service 名 = 应用 id），前端只持有"是否已配置"的布尔值，**Key 永不进入 localStorage / Zustand / 日志**。
- 所有 AI 请求必须可中断（AbortController），关闭面板、切标签、Esc 都中止。
- 失败时显示可读错误（401 → "密钥无效"，超时 → "网络超时"，429 → "请求过于频繁"，其余显示状态码），不要吞异常。
- 提示词模板放 `src/lib/prompts.ts`，每条指令一段 system prompt，要求"只输出结果，不要解释，不要加引号包裹"。

### 5.8 系统集成

- **单实例**：`tauri-plugin-single-instance`，第二次启动时把命令行参数（文件路径）转发给已存在窗口并聚焦。
- **文件关联**：`tauri.conf.json` 的 `bundle.fileAssociations` 注册 `.txt .md .log`（可选 `.json`），role = `Editor`。
- **启动参数**：`std::env::args()` → 跳过 exe 自身，第一个存在的文件路径**以临时文档打开**，不入库。
- **拖拽入窗**：文件拖到窗口任意位置 → 临时文档；多个文件 → 多个标签；不做"拖入即入库"。
- **托盘**：左键显示/隐藏窗口，右键菜单（显示主窗口 / 新建文档 / 退出）。
- **全局快捷键**：默认 `Ctrl+Alt+N` 唤起并聚焦，可在设置里修改（`@tauri-apps/plugin-global-shortcut`）。
- **窗口**：记住大小与位置（`tauri-plugin-window-state`），关闭按钮默认最小化到托盘（设置里可改为退出）。

### 5.9 主题与 UI

- 两套主题（浅/深），CSS 变量驱动，`prefers-color-scheme` 跟随系统 + 手动三态（跟随/浅/深）。
- CodeMirror 主题要与页面主题一致，用 `EditorView.theme()` + `HighlightStyle`，不要用第三方主题包。
- 等宽字体栈：`"JetBrains Mono", "Cascadia Code", "Sarasa Mono SC", Consolas, monospace`，中文字体回退 `"Microsoft YaHei UI"`。
- 字号、行高在设置里可调（12–22px），立即生效并持久化。
- 布局：

```
┌────────────────────────────────────────────────────────────────┐
│ [编码与换行 ●] [会议记录.txt 临时 ×] [+]                        │
├──────────────┬──────────────────────────┬──────────────────────┤
│ 文档库    ⋯  │  编辑器（CodeMirror 6）   │ AI · 仅本文档   清空  │
│ [＋新建][导入]│                          │ 上下文条             │
│ 搜索…        │                          │ 对话流              │
│ ▾ 技术笔记   │                          │ 结果 + 操作          │
│   ▾ 前端     │                          │ ─────────────────── │
│      CSS…    │                          │ 输入框              │
│ ▸ 项目       │                          │                     │
│ 临时文档 2   │                          │                     │
├──────────────┴──────────────────────────┴──────────────────────┤
│ 技术笔记 UTF-8 CRLF Markdown 行12列8 2.1KB ●已修改 AI ⚙        │
└────────────────────────────────────────────────────────────────┘
```

- 状态栏可点击项：分类、编码、换行符、语言、设置、AI。
- 侧栏行上必须能看出：选中、已修改（琥珀点）、临时（虚线标签）、分类层级（缩进）。
- 所有动画 ≤ 120ms，不做花哨过渡。

### 5.10 中文输入法

WebView2 + CodeMirror 6 对 composition 事件支持良好，但仍需专项验证：

- 拼音输入过程中**不得出现丢字、重复上屏、光标跳位**。
- 输入法候选框位置要跟随光标（CM6 默认处理，不要自己拦截 `keydown` 吞掉 IME 按键）。
- 任何自定义 keymap 都要 `preventDefault` 前判断 `view.composing`，为 true 时直接放行。

### 5.11 文档库

**存储布局**（`%APPDATA%/<app>/`）：

```
library/
  index.json                 # { version, categories[], docs[] }
  docs/<docId>.md            # 正文，文件名与标题解耦
  chats/<docId>.json         # AI 对话（仅常驻文档）
  versions/<docId>/*.snap    # 版本快照；含 meta.json 记录 source
recovery/<docId>.snap        # 常驻文档未保存改动的恢复快照
scratch/<tabId>.md           # 临时文档自动保存（不备份、不迁移）
```

- 选 JSON 索引而非 SQLite：不引白名单外依赖、可被其他工具直接读、损坏可重建；几千篇量级足够。
- 索引写入必须原子（临时文件 + rename）；启动时校验，记录存在但正文缺失标记 `missing`，不静默删除。

**分类**

- 单棵树，`Category { id, name, parentId, order }`，**任意层级**，UI 按层级缩进。
- 内置「未分类」`id = "uncategorized"`，不可删、不可改名、不可嵌套子分类。
- 删除分类时，其文档与子分类一并回落到「未分类」，并在确认框里写明数量；不允许静默丢文档。
- 拖拽文档到分类 = 移动；拖拽分类到分类 = 移动子树，禁止拖进自己的子孙。
- 分类名同级唯一，重名自动拒绝（不是自动加序号）。

**文档**

- `DocMeta { id, title, categoryId, createdAt, updatedAt, aiReadable, sizeBytes }`。
- 标题全局唯一，重名自动追加 `(2)`；标题与磁盘文件名解耦，改名不动正文文件。
- 删除走回收站（`trash` crate），**禁止直接 unlink**。
- 库里不存"原始路径"字段，导入后与源文件再无关联。

**临时文档**

- 新建 / 拖入 / 双击关联 / 命令行 → 临时，永不自动入库。
- 自动保存到 `scratch/`（800ms 防抖），面板上提示"自动保存 · 不进文档库"。
- 关闭即删 scratch；崩溃或强制退出后下次启动恢复。
- 临时文档的 AI 会话不落盘。

**保存到文档库**

- 对话框：名称（预填原文件名去扩展名）+ 分类（树形下拉，含「＋ 新建分类」）。
- 保存后生成 `docId`、正文写入库、scratch 删除、标签上的「临时」标记消失。
- 编码 / BOM / 换行符沿用临时文档读入时的值。

**导入 / 导出 / 备份 / 迁移**

| 操作 | 行为 |
|---|---|
| 导入 | 多选文件 → 逐条选分类（含子分类）→ **复制**入库；支持「全部导入到未分类」；重名自动加序号；不支持的扩展名跳过并汇总提示 |
| 导出 | 复制副本到桌面或指定目录，文件名 = 标题 + 原扩展名；不展示库路径 |
| 备份 | 整库复制到用户选定文件夹，校验文件数量与索引可解析；不打包压缩 |
| 恢复 | 先自动备份当前库为 `library.bak-<ts>`，再覆盖；失败要能退回 |
| 迁移 | 复制到新位置 → 校验 → 切换配置指向 → 旧库保留；切换前不得删除任何文件 |

### 5.12 数据一致性

- 所有写操作先写临时文件再 rename，避免半截文件。
- 任何跨文件的批量操作（导入、恢复、迁移）失败时必须回滚或明确告知已完成/未完成的范围。
- 启动自检顺序：读索引 → 校验分类引用 → 校验正文存在 → 清理超限快照；任一步失败降级而不是崩溃。

---

## 6. 目录结构（按此创建）

```
src/
  main.tsx
  App.tsx
  components/
    TabBar.tsx
    EditorPane.tsx          # 唯一的 CodeMirror 挂载点
    LibrarySidebar.tsx      # 分类树 + 临时区 + 搜索
    ChatPanel.tsx           # AI 侧栏（单文档会话）
    StatusBar.tsx
    FindPanel.tsx
    SaveToLibraryDialog.tsx
    ImportDialog.tsx
    SettingsDialog.tsx
    QuickOpen.tsx
  editor/
    createEditor.ts         # EditorView 工厂 + 按档位组装扩展
    languages.ts            # 后缀识别 / 手动切换
    theme.ts
    keymap.ts
    tabStates.ts            # Map<tabId, EditorState>，非 React state
    config.ts               # 大文件阈值等常量
  store/
    useAppStore.ts          # 仅元数据：tabs、library、settings、panel 状态
  lib/
    ipc.ts                  # 所有 invoke 的类型化封装
    ai.ts
    prompts.ts
    paths.ts
  styles/
src-tauri/
  src/
    main.rs
    lib.rs
    commands/
      fs.rs                 # read/write 单文件（含编码）
      library.rs            # 分类 / 文档 / 导入导出 / 备份迁移
      chat.rs               # 会话读写与清空
      secret.rs
    encoding.rs
    library.rs              # 索引、scratch、版本快照
    watcher.rs              # 预留（二期库内监听）
```

---

## 7. Rust 命令接口清单

| 命令 | 入参 | 返回 |
|---|---|---|
| `read_text_file` | `path: String, maxBytes?: u64` | `FileDoc { content, encoding, hasBom, lineEnding, sizeBytes, truncated }` |
| `write_text_file` | `path, content, encoding, hasBom, lineEnding` | `()` |
| `list_library` | — | `LibrarySnapshot { categories, docs }` |
| `create_doc` | `title, categoryId, content, encoding, ...` | `DocMeta` |
| `read_doc` / `write_doc` | `docId` / `docId, content, ...` | `FileDoc` / `()` |
| `rename_doc` / `move_doc` / `delete_doc` | `docId, title` / `docId, categoryId` / `docId` | `()`（删除走回收站） |
| `create_category` / `rename_category` / `delete_category` / `move_category` | `name, parentId` 等 | `Category` / `()` |
| `import_files` | `paths: Vec<String>, assignments: Vec<(path, categoryId)>` | `ImportReport { imported, renamed, skipped }` |
| `export_doc` | `docId, targetDir` | `String`（导出后的文件名） |
| `backup_library` / `restore_library` / `move_library` | `targetDir` / `backupDir` / `newDir` | `BackupReport` |
| `save_scratch` / `list_scratch` / `drop_scratch` | `tabId, content` / — / `tabId` | `()` / `Vec<ScratchDoc>` / `()` |
| `load_chat` / `append_chat` / `clear_chat` | `docId` / `docId, message` / `docId` | `Vec<ChatMessage>` / `()` / `()` |
| `list_versions` / `read_version` / `restore_version` | `docId`（+ `versionId`） | `Vec<VersionMeta>` / `String` / `()` |
| `set_secret` / `get_secret_status` / `clear_secret` | `key, value` | 不返回明文 |
| `take_cli_args` | — | `Vec<String>` |
| `search_in_library` | `pattern`（二期） | event `search://batch` |

错误统一用 `Result<T, String>`，前端 `ipc.ts` 里把错误转成可读中文提示。

---

## 8. 验收标准（每一阶段结束都要手动跑一遍）

1. `npm run tauri dev` 启动，窗口 1s 内出现，无控制台报错。
2. 打开 `.ts / .md / .py / .json`，高亮正确；`.md` 的 ```js 代码块有嵌套高亮。
3. 打开 GBK 中文 txt：正文不乱码，状态栏显示 `GBK`；保存后编码不变（hexdump 确认）。
4. 打开 30MB 日志：不卡死，进纯文本模式并出现提示条，滚动流畅。
5. 拼音连续输入 30 字：无丢字、无光标跳位。
6. 新建 / 拖入 / 双击 `.md` / 命令行打开：四种入口都进临时区，库里不新增文档。
7. 临时文档改完 1s 内自动落盘；强杀进程后重启，内容恢复且标记为临时。
8. 临时文档点「保存到文档库」：填名称、选分类（含嵌套子分类）→ 侧栏对应位置出现，`临时` 标记消失。
9. 修改任一文档，侧栏该行与状态栏立即出现「已修改」，保存后消失。
10. 导入 3 个文件到不同分类，库内按分类落位，原文件仍在原处；导出副本内容与库内一致。
11. 建三层分类，把文档拖到第三层再拖回「未分类」，索引与侧栏同步更新。
12. 备份 → 手动改名库目录 → 恢复：文档、分类、对话、版本全部回来。
13. 迁移到新目录后功能正常，旧库文件仍在。
14. 打开两篇文档分别对话，切换标签时历史不串；重开文档历史还在。
15. 点「清空会话」二次确认后，上下文归零，再提问不带前文。
16. 把文档标记为「不允许 AI 读取」，发请求时抓包确认**没有任何网络请求**。
17. AI 替换选中后 `Ctrl+Z` 一次回到原文；版本列表有 `before-ai` 快照且能还原。
18. 断网状态下点 AI，2s 内出现明确错误提示，界面不卡死。
19. 资源管理器右键 `.md`「用本应用打开」→ 启动并作为临时文档；已运行时复用窗口。
20. `Ctrl+Alt+N` 任意应用前台时唤起窗口；`Ctrl+Shift+V` 在 Markdown 实时渲染/源码间切换；`Ctrl+Shift+/` 开关 AI 侧栏。
21. `npm run tauri build` 产出安装包 < 15MB。

---

## 9. 执行顺序

**P0 骨架**：脚手架 → 目录结构 → 数据模型定型 → 三栏布局 + 空 CodeMirror → IPC 封装骨架 → 能 `dev` 跑起来。
**P1 编辑器核心**：多格式识别与懒加载高亮 → 主题/字体/行号 → keymap → 查找替换 → 中文输入验证。
**P2 文档库**：编码层 → 文档/分类 CRUD → scratch 自动保存 → 保存到库 → 导入导出 → 侧栏交互 → 备份迁移。
**P3 韧性**：大文件分档 → 常驻文档恢复 → 版本快照 → 未保存确认。
**P4 AI**：密钥与设置页 → 单文档会话 → 禁止读取 → 流式与中断 → 应用修改与快照 → 清空会话。
**P5 系统集成与打包**：单实例 + 命令行参数 → 文件关联 → 拖拽 → 托盘 → 全局快捷键 → 窗口状态 → NSIS 打包。

**每个阶段结束：先 `npm run build` 和 `cargo check` 双通过，再汇报。**

---

## 10. 禁止事项

1. 不要把文档正文放进 React state 或 Zustand。
2. 不要引入 UI 组件库（Ant Design / MUI / Element 等）。
3. 不要用 `window.fetch` 直连 AI 接口（CORS）。
4. 不要在前端做编码转换或 Base64 塞文件内容——文件 IO 一律走 Rust 命令。
5. 不要自动覆盖保存用户文件（除了用户显式 `Ctrl+S`）。
6. 不要用 `std::fs::remove_file` 删用户文档，只能进回收站。
7. 不要在 UI 任何位置显示文档的磁盘路径（设置页的库位置除外）。
8. 不要把临时文档自动写入文档库，也不要给临时文档保留 AI 会话。
9. 不要让 AI 请求携带当前文档以外的内容，也不要为「不允许读取」的文档发出请求。
10. 不要为"看起来更完整"而实现二期功能；先把 MVP 的 21 条验收过掉。
11. 不要改本机的全局环境（PATH、注册表项除文件关联外、已安装的运行时）。
