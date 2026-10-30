import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { getActiveEditorView } from "./editor/activeView";
import { createEditorState } from "./editor/createEditor";
import { handleEditorUpdate } from "./editor/handleUpdate";
import { openFind } from "./editor/search";
import { putTabState, tabStateCount } from "./editor/tabStates";
import { useAppStore } from "./store/useAppStore";
import "./styles/global.css";

if (import.meta.env.DEV) {
  const devWindow = window as unknown as Record<string, unknown>;

  // 调试用：控制台执行 __noteTabStates() 看当前缓存了几份 EditorState。
  devWindow.__noteTabStates = tabStateCount;

  /**
   * P1 验证用的样例入口（P2 接上真实文件读取后仍然有用）：
   * 造一个带文件名的标签，用来验证后缀识别与懒加载高亮。
   * 正文直接进 EditorState，不经过 store。
   */
  const openSample = (filename: string, content: string) => {
    const id = useAppStore.getState().addTab({ title: filename, filename });
    putTabState(id, createEditorState(content, handleEditorUpdate));
    return id;
  };
  devWindow.__noteOpenSample = openSample;

  // 手动验收用：访问 http://localhost:1420/?sample=md 或 ?sample=ts
  const params = new URLSearchParams(window.location.search);
  const sample = params.get("sample");
  if (sample === "md") {
    openSample(
      "sample.md",
      [
        "# 编码与换行",
        "",
        "> 用户没主动改，写回就必须和读入完全一致。",
        "",
        "## 探测顺序",
        "",
        "1. 有 BOM 按 BOM 定编码",
        "2. 无 BOM 用 `chardetng` 猜，再校验 U+FFFD",
        "3. 失败回退 GB18030 → UTF-8",
        "",
        "```ts",
        "const doc = await read_text_file(path)",
        "// 原样带回去",
        "await write_text_file(path, doc.content, {",
        "  encoding: doc.encoding,",
        "  lineEnding: doc.lineEnding,",
        "})",
        "```",
        "",
        "- [x] 编码探测",
        "- [ ] 换行符保留",
        "",
        "| 编码 | 场景 |",
        "| --- | --- |",
        "| UTF-8 | 默认 |",
        "| GBK | 旧文件 |",
        "",
        "![示意图](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='72'%3E%3Crect%20width='180'%20height='72'%20rx='8'%20fill='%23e3ecff'/%3E%3Ctext%20x='20'%20y='42'%20font-size='14'%20fill='%232f6ae0'%3Eimage%20preview%3C/text%3E%3C/svg%3E)",
        "",
        "**结论**：编码是文件的属性，不是编辑器的偏好。",
      ].join("\n"),
    );
  } else if (sample === "ts") {
    openSample(
      "sample.ts",
      [
        "type Doc = { id: string; title: string };",
        "",
        "export function pick(docs: Doc[], id: string): Doc | undefined {",
        "  // 注释应显示为斜体",
        "  return docs.find((doc) => doc.id === id);",
        "}",
        "",
        "const total = [1, 2, 3].reduce((sum, n) => sum + n, 0);",
        'console.log("total:", total);',
      ].join("\n"),
    );
  }

  // 验收辅助：?theme=dark / ?panel=find / ?preview=1
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") {
    useAppStore.setState({ themeMode: theme });
  }

  if (params.get("preview") === "1") {
    useAppStore.setState({ livePreview: true });
  }
  if (params.get("source") === "1") {
    useAppStore.setState({ livePreview: false });
  }

  if (params.get("panel") === "find") {
    window.setTimeout(() => {
      const view = getActiveEditorView();
      if (view) openFind(view);
    }, 600);
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
