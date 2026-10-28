import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * 主题全部走 CSS 变量：页面切深浅色时编辑器跟着变，
 * 不需要重建 EditorState。字号/行高也来自变量，改设置即时生效。
 */
const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--fg)",
    fontSize: "var(--editor-font-size, 13px)",
  },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "var(--editor-line-height, 1.7)",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "14px 28px 40px 8px",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--fg-3)",
    paddingRight: "10px",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 0",
    minWidth: "32px",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--fg-2)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--accent-soft)",
    outline: "none",
  },
  ".cm-panels": {
    backgroundColor: "var(--side)",
    color: "var(--fg)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-search": {
    padding: "7px 10px",
    fontFamily: "var(--sans)",
    fontSize: "12px",
    color: "var(--fg)",
  },
  ".cm-search .cm-textfield": {
    height: "24px",
    minWidth: "150px",
    marginRight: "6px",
    padding: "0 6px",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    background: "var(--win)",
    color: "var(--fg)",
    fontSize: "12px",
    outline: "none",
  },
  ".cm-search .cm-textfield:focus": {
    borderColor: "var(--accent)",
  },
  ".cm-search .cm-button": {
    height: "24px",
    padding: "0 8px",
    marginRight: "4px",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    background: "var(--win)",
    backgroundImage: "none",
    color: "var(--fg-2)",
    fontSize: "11.5px",
  },
  ".cm-search .cm-button:hover": {
    background: "var(--hover)",
    color: "var(--fg)",
  },
  ".cm-search label": {
    marginRight: "8px",
    fontSize: "11.5px",
    color: "var(--fg-2)",
  },
  ".cm-search [name=close]": {
    color: "var(--fg-3)",
    fontSize: "16px",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(201, 138, 18, 0.22)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(201, 138, 18, 0.4)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--win)",
    border: "1px solid var(--border-2)",
    color: "var(--fg)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--fg)",
  },
});

const syntaxTheme = HighlightStyle.define([
  { tag: t.heading, color: "var(--s-head)", fontWeight: "600" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: "var(--s-kw)" },
  { tag: [t.string, t.special(t.string)], color: "var(--s-str)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--s-com)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--s-num)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--s-fn)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--s-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--s-prop)" },
  { tag: [t.tagName], color: "var(--s-tag)" },
  { tag: [t.link, t.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.meta, t.processingInstruction], color: "var(--s-com)" },
]);

export const editorTheme = [baseTheme, syntaxHighlighting(syntaxTheme)];
