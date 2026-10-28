import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { openSearchPanel, search } from "@codemirror/search";

/**
 * CM6 自带的查找/替换面板（PROMPT §5.4 明确不要自己造）。
 * 只做三件事：换成中文、贴顶显示、提供打开入口。
 */

const phrases: Record<string, string> = {
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  "by word": "全词匹配",
  regexp: "正则",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
};

export const searchExtension = [search({ top: true }), EditorState.phrases.of(phrases)];

/** Ctrl+F / Ctrl+H 都打开同一个面板（面板内含替换行）。 */
export function openFind(view: EditorView): boolean {
  return openSearchPanel(view);
}
