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
    borderRight: "1px solid var(--border)",
    color: "var(--fg-3)",
    paddingLeft: "8px",
    paddingRight: "10px",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 0",
    minWidth: "32px",
  },
  // 渲染态不显示行号，只留正文。
  "&.cm-md-live .cm-gutters": {
    display: "none",
  },
  "&.cm-md-live .cm-content": {
    paddingLeft: "20px",
  },
  // 代码块行有自己的底色，默认选区层（z-index:-1）会被底色盖住。
  // 渲染态把选区层提到文字之上，并裁到正文内容区，避免选区盖住
  // .cm-content 的左右内边距（表现为高亮越出代码块/末端留下小色块）。
  // 注意：CM 的选区层默认是 0×0 的绝对定位容器，必须先撑满，
  // clip-path 才有可裁剪的区域，否则选区会整个消失。
  "&.cm-md-live .cm-selectionLayer": {
    zIndex: "1 !important",
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    clipPath: "inset(0 28px 0 20px)",
  },
  "&.cm-md-live.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--selection-bg) !important",
  },
  "&.cm-md-live > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--selection-bg) !important",
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

  /* Markdown 预览装饰 */
  ".cm-md-h1": { fontSize: "1.7em", fontWeight: "600", lineHeight: "1.5" },
  ".cm-md-h2": { fontSize: "1.42em", fontWeight: "600", lineHeight: "1.55" },
  ".cm-md-h3": { fontSize: "1.2em", fontWeight: "600" },
  ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontWeight: "600" },
  ".cm-md-quote": {
    borderLeft: "3px solid var(--border-2)",
    paddingLeft: "10px",
    color: "var(--fg-2)",
  },
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-del": { color: "var(--fg-3)", textDecoration: "line-through" },
  ".cm-md-code": {
    padding: "1px 4px",
    borderRadius: "3px",
    backgroundColor: "var(--side)",
    color: "var(--s-str)",
    fontSize: "0.92em",
  },
  ".cm-md-link": { color: "var(--accent)", textDecoration: "underline" },
  ".cm-md-bullet": { color: "var(--fg-3)", paddingRight: "6px" },
  ".cm-md-task": { marginRight: "6px", verticalAlign: "middle" },
  ".cm-md-hr": {
    display: "block",
    margin: "10px 0",
    borderTop: "1px solid var(--border)",
  },
  ".cm-md-code-line": {
    backgroundColor: "var(--code-bg)",
    borderLeft: "1px solid var(--code-border)",
    borderRight: "1px solid var(--code-border)",
    padding: "0 10px",
  },
  ".cm-md-code-foot": {
    height: "6px",
    backgroundColor: "var(--code-bg)",
    border: "1px solid var(--code-border)",
    borderTop: "none",
    borderRadius: "0 0 6px 6px",
  },
  ".cm-md-code-head": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minHeight: "26px",
    padding: "0 8px 0 10px",
    backgroundColor: "var(--code-bg)",
    border: "1px solid var(--code-border)",
    borderBottom: "none",
    borderRadius: "6px 6px 0 0",
    userSelect: "none",
  },
  ".cm-md-lang": {
    fontFamily: "var(--mono)",
    fontSize: "11px",
    color: "var(--fg-2)",
    letterSpacing: "0.02em",
  },
  ".cm-md-copy": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    height: "20px",
    padding: "0 7px",
    border: "1px solid var(--code-border)",
    borderRadius: "4px",
    background: "var(--win)",
    color: "var(--fg-2)",
    fontFamily: "var(--sans)",
    fontSize: "11px",
    lineHeight: "1",
    cursor: "pointer",
    transition: "color 0.12s ease, background 0.12s ease, border-color 0.12s ease",
  },
  ".cm-md-copy:hover": {
    color: "var(--fg)",
    background: "var(--hover)",
    borderColor: "var(--fg-3)",
  },
  ".cm-md-table": {
    padding: "6px 0",
  },
  ".cm-md-table table": {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.92em",
  },
  ".cm-md-table th, .cm-md-table td": {
    padding: "5px 9px",
    border: "1px solid var(--border)",
    textAlign: "left",
  },
  ".cm-md-table th": {
    backgroundColor: "var(--side)",
    fontWeight: "600",
  },
  ".cm-md-image": {
    display: "inline-block",
    maxWidth: "100%",
    padding: "2px 0",
  },
  ".cm-md-image img": {
    maxWidth: "100%",
    maxHeight: "420px",
    borderRadius: "4px",
    verticalAlign: "middle",
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
