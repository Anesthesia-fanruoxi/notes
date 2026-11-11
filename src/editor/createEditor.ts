import { Compartment, EditorSelection, EditorState, Prec, type Extension, type Text } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type ViewUpdate,
} from "@codemirror/view";
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineUp,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput, type LanguageSupport } from "@codemirror/language";

import { openFind, searchExtension } from "./search";
import { changeTracking, setChangeBaseline } from "./changeTracking";
import { editorTheme } from "./theme";
import { livePreviewExtension, livePreviewGuard } from "./livePreview";
import type { EditorTier } from "./tiers";

/** 语言扩展槽：切换语言时只重配这一格，不重建整个 state。 */
export const languageCompartment = new Compartment();

/** 列选择：Alt/Option 或 Ctrl 按住左键拖动。 */
function columnSelection(): Extension {
  return rectangularSelection({
    eventFilter: (event) => (event.altKey || event.ctrlKey) && event.button === 0,
  });
}

/** Notepad++ 手感：Esc / 普通方向键退出列模式，回到单光标。 */
function exitColumnOnArrow(
  view: EditorView,
  move: (view: EditorView) => boolean,
): boolean {
  const ranges = view.state.selection.ranges;
  if (ranges.length <= 1) return false;
  view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) });
  return move(view);
}

const columnExitKeymap = Prec.high(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        const ranges = view.state.selection.ranges;
        if (ranges.length <= 1) return false;
        view.dispatch({
          selection: EditorSelection.cursor(view.state.selection.main.head),
        });
        return true;
      },
    },
    { key: "ArrowLeft", run: (view) => exitColumnOnArrow(view, cursorCharLeft) },
    { key: "ArrowRight", run: (view) => exitColumnOnArrow(view, cursorCharRight) },
    { key: "ArrowUp", run: (view) => exitColumnOnArrow(view, cursorLineUp) },
    { key: "ArrowDown", run: (view) => exitColumnOnArrow(view, cursorLineDown) },
  ]),
);

function commonExtensions(): Extension[] {
  return [
    // 列选择/多光标的前提：否则 CodeMirror 会把多个 range 合并成一个。
    EditorState.allowMultipleSelections.of(true),
    // 只有拖动才产生多选；普通点击（含 Ctrl/Alt 点击）回到单光标，避免不断累积。
    EditorView.clickAddsSelectionRange.of(() => false),
    drawSelection(),
    // Alt/Option（或 Ctrl）+ 拖动：矩形列选择。
    columnSelection(),
    columnExitKeymap,
    history(),
    keymap.of([
      // 放在 defaultKeymap 之前，确保 Mod-f / Mod-h 走我们的入口。
      { key: "Mod-f", run: (view) => (view.composing ? false : openFind(view)) },
      { key: "Mod-h", run: (view) => (view.composing ? false : openFind(view)) },
    ]),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    searchExtension,
    editorTheme,
  ];
}

/** 预览视图的编辑器标记：渲染时隐藏行号槽。 */
const liveAttributes = EditorView.editorAttributes.of({ class: "cm-md-live" });

/** 预览视图的扩展：只读 + 渲染装饰 + 围栏守卫 + 标记类。 */
function previewConfig(): Extension[] {
  return [
    EditorState.readOnly.of(true),
    // 预览按可视宽度排版：长段落、长 URL 和表格折行，而不是把内容整体撑宽。
    EditorView.lineWrapping,
    livePreviewExtension,
    livePreviewGuard,
    liveAttributes,
  ];
}

/**
 * 三档扩展集合（PROMPT §5.3）：
 * full: 高亮 / 折叠 / 行号 / 括号 / 搜索
 * lite: 去掉高亮与折叠，保留行号与搜索
 * plain: 只留基础编辑与查找
 */
function tierExtensions(tier: EditorTier): Extension[] {
  if (tier === "plain") {
    return commonExtensions();
  }

  const structure: Extension[] = [
    lineNumbers(),
    changeTracking(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
  ];

  if (tier === "lite") {
    return [...structure, ...commonExtensions()];
  }

  return [
    ...structure,
    indentOnInput(),
    bracketMatching(),
    ...commonExtensions(),
    languageCompartment.of([]),
  ];
}

export function createEditorState(
  doc = "",
  onUpdate?: (update: ViewUpdate) => void,
  tier: EditorTier = "full",
  baseline = doc,
): EditorState {
  const extensions = tierExtensions(tier);
  if (onUpdate) {
    extensions.push(EditorView.updateListener.of(onUpdate));
  }
  let state = EditorState.create({ doc, extensions });
  // 基线默认是打开时的正文；恢复草稿时可显式传入磁盘/库内正文。
  state = state.update({ effects: setChangeBaseline.of(baseline) }).state;
  return state;
}

export function createEditorView(
  parent: HTMLElement,
  onUpdate?: (update: ViewUpdate) => void,
  tier: EditorTier = "full",
): EditorView {
  return new EditorView({
    state: createEditorState("", onUpdate, tier),
    parent,
  });
}

/** 语言包是异步加载的，加载完成后单独重配；只有完整档才有这一格。 */
export function applyLanguage(view: EditorView, support: LanguageSupport | null): void {
  view.dispatch({ effects: languageCompartment.reconfigure(support ?? []) });
}

/**
 * Markdown 预览：独立的只读视图，复用源码的渲染装饰。
 * 正文由 EditorPane 从左侧源码视图同步，撤销栈不在这里维护。
 */
export function createPreviewState(doc: string | Text = ""): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      previewConfig(),
      drawSelection(),
      searchExtension,
      editorTheme,
      languageCompartment.of([]),
    ],
  });
}

export function createPreviewView(parent: HTMLElement, doc: string | Text = ""): EditorView {
  return new EditorView({ state: createPreviewState(doc), parent });
}
