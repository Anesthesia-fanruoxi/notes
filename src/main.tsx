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
        "# 语法高亮自测",
        "",
        "普通段落，包含 `inline code` 与 **加粗**。",
        "",
        "```ts",
        "const value: number = 42;",
        "// 嵌套高亮应该生效",
        "function greet(name: string) {",
        '  return `hello ${name}`;',
        "}",
        "```",
        "",
        "- 列表项一",
        "- 列表项二",
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

  // 验收辅助：?theme=dark / ?panel=find
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") {
    useAppStore.setState({ themeMode: theme });
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
