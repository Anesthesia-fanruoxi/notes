import { Compartment, EditorState, type Extension } from "@codemirror/state";
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
import type { EditorTier } from "./tiers";

/** 语言扩展槽：切换语言时只重配这一格，不重建整个 state。 */
export const languageCompartment = new Compartment();

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
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
  ];

  if (tier === "lite") {
    return [...structure, ...commonExtensions()];
  }

  return [
    ...structure,
    rectangularSelection(),
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
): EditorState {
  const extensions = tierExtensions(tier);
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
