import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, type LanguageSupport } from "@codemirror/language";

import { openFind, searchExtension } from "./search";
import { editorTheme } from "./theme";
import {
  closeLivePreviewPopovers,
  placeCursorOutsideFence,
  livePreviewExtension,
  livePreviewGuard,
  selectCodeBlockContent,
} from "./livePreview";
import type { EditorTier } from "./tiers";

/** 语言扩展槽：切换语言时只重配这一格，不重建整个 state。 */
export const languageCompartment = new Compartment();
/** 实时渲染开关：源码 ↔ Typora 式隐藏标记。 */
export const livePreviewCompartment = new Compartment();

function commonExtensions(): Extension[] {
  return [
    drawSelection(),
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

/** 实时渲染态的编辑器标记：渲染时隐藏行号槽。 */
const liveAttributes = EditorView.editorAttributes.of({ class: "cm-md-live" });

/** 实时渲染格的内容：装饰 + 围栏守卫 + 块内全选 + 标记类，开关时整格重配。 */
function livePreviewConfig(enabled: boolean): Extension[] {
  return enabled
    ? [
        // 块内 Ctrl+A 只选代码正文；整篇全选请切源码模式。
        Prec.high(keymap.of([{ key: "Mod-a", run: selectCodeBlockContent }])),
        livePreviewExtension,
        livePreviewGuard,
        liveAttributes,
      ]
    : [];
}

/**
 * 三档扩展集合（PROMPT §5.3）：
 * full: 高亮 / 折叠 / 行号 / 括号 / 搜索
 * lite: 去掉高亮与折叠，保留行号与搜索
 * plain: 只留基础编辑与查找
 */
function tierExtensions(tier: EditorTier, livePreview: boolean): Extension[] {
  if (tier === "plain") {
    return [...commonExtensions(), livePreviewCompartment.of([])];
  }

  const structure: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
  ];

  if (tier === "lite") {
    return [...structure, ...commonExtensions(), livePreviewCompartment.of([])];
  }

  return [
    ...structure,
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    ...commonExtensions(),
    languageCompartment.of([]),
    livePreviewCompartment.of(livePreviewConfig(livePreview)),
  ];
}

export function createEditorState(
  doc = "",
  onUpdate?: (update: ViewUpdate) => void,
  tier: EditorTier = "full",
  livePreview = false,
): EditorState {
  const extensions = tierExtensions(tier, livePreview);
  if (onUpdate) {
    extensions.push(EditorView.updateListener.of(onUpdate));
  }
  return EditorState.create({ doc, extensions });
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

/** 源码 ↔ 实时渲染，不重建 state，保留撤销栈。 */
export function setLivePreview(view: EditorView, enabled: boolean): void {
  const wasLive = view.state.field(livePreviewExtension, false) !== undefined;
  closeLivePreviewPopovers();
  view.dispatch({
    effects: livePreviewCompartment.reconfigure(livePreviewConfig(enabled)),
  });
  if (enabled && !wasLive) placeCursorOutsideFence(view);
}
