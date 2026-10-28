import { getActiveEditorView, getActiveViewTabId } from "./activeView";
import { getTabState, putTabState } from "./tabStates";

/**
 * 当前标签的正文：优先从唯一 view 取，避免读到旧 state。
 * 用 view 实际加载的标签判断，而不是 store —— 刚切标签时两者可能还没同步。
 * 正文只在这个模块与 EditorState 之间流动，不进 React（PROMPT §3.1）。
 */
export function readTabContent(tabId: string): string {
  const view = getActiveEditorView();
  if (view && getActiveViewTabId() === tabId) {
    return view.state.doc.toString();
  }
  return getTabState(tabId)?.doc.toString() ?? "";
}

/**
 * 整篇替换（恢复快照 / 版本还原用），单次 dispatch。
 * 活动标签走唯一的 view，其余标签改缓存里的 EditorState。
 */
export function replaceTabContent(tabId: string, content: string): void {
  const view = getActiveEditorView();
  if (view && getActiveViewTabId() === tabId) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    return;
  }

  const state = getTabState(tabId);
  if (!state) return;
  putTabState(
    tabId,
    state.update({
      changes: { from: 0, to: state.doc.length, insert: content },
    }).state,
  );
}
