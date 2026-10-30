# Note

本机优先的轻量文本编辑器 / 笔记应用：Tauri 2 + React 19 + CodeMirror 6，文档库按分类组织，
同时支持「拖进来就改、不保存也不丢」的临时文档与可选的内置 AI 助理。

## 目录

- `src/` 前端（React + CodeMirror）
- `src-tauri/` Rust 端（文档库、编码、AI 转发、用量记录）
- `doc/` **设计文档**：按板块记录每项功能的设计逻辑、数据落点与已知待打磨项
- `PROMPT.md` 需求说明；`EXECUTION-CHECKLIST.md` 分阶段验收清单

## 快速开始

```bash
npm install
npm run tauri dev
```

## 设计文档入口

从 [doc/README.md](doc/README.md) 开始读，重点是「01-文档模型」：副本编辑、快照、版本与外部文件检测。
