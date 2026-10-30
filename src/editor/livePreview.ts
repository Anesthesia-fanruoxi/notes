import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

import { copyText } from "../lib/clipboard";

/**
 * Markdown 预览：不是独立面板，而是在编辑区里把 Markdown 标记隐藏掉，
 * 渲染成只读视图；编辑统一走源码模式。
 *
 * 代码块围栏渲染成头部/底部，表格渲染成 HTML 表格，只保留复制等阅读操作。
 *
 * 只做轻量装饰，不改变文档内容，也不影响撤销栈。
 */

interface Item {
  from: number;
  to: number;
  deco: Decoration;
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.disabled = true;
    input.checked = this.checked;
    input.className = "cm-md-task";
    return input;
  }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-md-hr";
    return div;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-image";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    wrap.appendChild(img);
    return wrap;
  }
}

/** 语言别名的完整名称，用作悬浮提示。 */
const LANG_LABELS: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  shell: "Shell",
  console: "Shell 会话",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  rs: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  yml: "YAML",
  yaml: "YAML",
  json: "JSON",
  jsonc: "JSON with Comments",
  toml: "TOML",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  md: "Markdown",
  markdown: "Markdown",
  sql: "SQL",
  diff: "Diff",
  text: "纯文本",
  txt: "纯文本",
  plaintext: "纯文本",
  bat: "Batch",
  batch: "Batch",
  basic: "BASIC",
  ps1: "PowerShell",
  powershell: "PowerShell",
  dockerfile: "Dockerfile",
  docker: "Docker",
  graphql: "GraphQL",
  kotlin: "Kotlin",
  swift: "Swift",
  php: "PHP",
  lua: "Lua",
  r: "R",
  dart: "Dart",
  vue: "Vue",
  svelte: "Svelte",
  ini: "INI",
  makefile: "Makefile",
  nginx: "Nginx",
};

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.6" y="5.6" width="7.9" height="8.9" rx="1.4"/><path d="M10.4 5.6V3.4A1.4 1.4 0 0 0 9 2H3.4A1.4 1.4 0 0 0 2 3.4V9a1.4 1.4 0 0 0 1.4 1.4h2.2"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.4 8.6 3 3 6.2-6.8"/></svg>';

/** 代码块头部：语言标识 + 复制按钮（预览态只读）。 */
class CodeHeaderWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.lang === this.lang && other.code === this.code;
  }

  toDOM(): HTMLElement {
    const head = document.createElement("div");
    head.className = "cm-md-code-head";

    const lang = document.createElement("span");
    lang.className = "cm-md-lang";
    lang.textContent = this.lang || "text";
    lang.title = LANG_LABELS[this.lang.toLowerCase()] ?? (this.lang || "纯文本");
    head.appendChild(lang);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-md-copy";
    button.innerHTML = `${COPY_ICON}<span>复制</span>`;
    button.title = "复制代码";
    button.setAttribute("aria-label", "复制代码");
    // 不抢焦点、不移动光标。
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyText(this.code).then((ok) => {
        button.innerHTML = ok ? `${CHECK_ICON}<span>已复制</span>` : "<span>复制失败</span>";
        button.title = ok ? "已复制" : "复制失败";
        window.setTimeout(() => {
          button.innerHTML = `${COPY_ICON}<span>复制</span>`;
          button.title = "复制代码";
        }, 1200);
      });
    });
    head.appendChild(button);

    return head;
  }
}

/** 代码块底部收口：纯展示，不响应点击。 */
class CodeFooterWidget extends WidgetType {
  eq(_other: CodeFooterWidget): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const foot = document.createElement("div");
    foot.className = "cm-md-code-foot";
    return foot;
  }
}

interface TableBlock {
  start: number;
  end: number;
  header: string[];
  rows: string[][];
  aligns: ("left" | "center" | "right")[];
}

function isEscapedPipe(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

function pushTableCell(cells: string[], lineText: string, start: number, end: number): void {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(lineText[from])) from += 1;
  while (to > from && /\s/.test(lineText[to - 1])) to -= 1;
  cells.push(lineText.slice(from, to).replace(/\\\|/g, "|"));
}

/** 与 splitCells 语义一致，额外支持表内转义竖线。 */
function parseTableRow(lineText: string): string[] {
  let from = 0;
  let to = lineText.length;
  while (from < to && /\s/.test(lineText[from])) from += 1;
  while (to > from && /\s/.test(lineText[to - 1])) to -= 1;
  if (from >= to) return [];

  if (lineText[from] === "|") from += 1;
  if (to > from && lineText[to - 1] === "|" && !isEscapedPipe(lineText, to - 1)) to -= 1;

  const cells: string[] = [];
  let cellStart = from;
  for (let i = from; i < to; i += 1) {
    if (lineText[i] === "|" && !isEscapedPipe(lineText, i)) {
      pushTableCell(cells, lineText, cellStart, i);
      cellStart = i + 1;
    }
  }
  pushTableCell(cells, lineText, cellStart, to);
  return cells;
}

/** 表格单元格的行内 Markdown：只建文本节点和元素，不拼 HTML。 */
function renderInlineMarkdown(text: string, parent: HTMLElement): void {
  const pattern =
    /(\*\*([^\n]+?)\*\*)|(~~([^~\n]+)~~)|(`([^`\n]+)`)|(\[([^\]\n]+)\]\(([^)\n]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      parent.append(document.createTextNode(text.slice(last, match.index)));
    }
    if (match[2] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[2];
      parent.append(strong);
    } else if (match[4] !== undefined) {
      const del = document.createElement("del");
      del.textContent = match[4];
      parent.append(del);
    } else if (match[6] !== undefined) {
      const code = document.createElement("code");
      code.className = "cm-md-code";
      code.textContent = match[6];
      parent.append(code);
    } else if (match[8] !== undefined) {
      const link = document.createElement("span");
      link.className = "cm-md-link";
      link.textContent = match[8];
      parent.append(link);
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

class TableWidget extends WidgetType {
  constructor(readonly table: TableBlock) {
    super();
  }

  eq(other: TableWidget): boolean {
    return (
      other.table.start === this.table.start &&
      other.table.end === this.table.end &&
      JSON.stringify(other.table.header) === JSON.stringify(this.table.header) &&
      JSON.stringify(other.table.rows) === JSON.stringify(this.table.rows) &&
      JSON.stringify(other.table.aligns) === JSON.stringify(this.table.aligns)
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    this.table.header.forEach((cell, index) => {
      const th = document.createElement("th");
      renderInlineMarkdown(cell, th);
      th.style.textAlign = this.table.aligns[index] ?? "left";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of this.table.rows) {
      const tr = document.createElement("tr");
      this.table.header.forEach((_headCell, index) => {
        const td = document.createElement("td");
        const cell = row[index];
        if (cell) renderInlineMarkdown(cell, td);
        td.style.textAlign = this.table.aligns[index] ?? "left";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }
}

function hide(from: number, to: number): Item {
  return { from, to, deco: Decoration.replace({}) };
}

function inlineItems(items: Item[], text: string, base: number, startOffset: number): void {
  let lastEnd = startOffset;

  // 图片：只放行 http(s) 与 data:image，避免本地路径和脚本注入。
  const image = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
  let imageMatch: RegExpExecArray | null;
  while ((imageMatch = image.exec(text))) {
    const start = imageMatch.index;
    const end = start + imageMatch[0].length;
    if (start < startOffset || start < lastEnd) continue;
    const src = imageMatch[2];
    if (!/^(https?:\/\/|data:image\/)/i.test(src)) continue;

    items.push({
      from: base + start,
      to: base + end,
      deco: Decoration.replace({ widget: new ImageWidget(src, imageMatch[1]) }),
    });
    lastEnd = end;
  }

  const rules: { re: RegExp; cls: string; open: number; close: number }[] = [
    { re: /\*\*([^\n]+?)\*\*/g, cls: "cm-md-strong", open: 2, close: 2 },
    { re: /~~([^~\n]+)~~/g, cls: "cm-md-del", open: 2, close: 2 },
    { re: /`([^`\n]+)`/g, cls: "cm-md-code", open: 1, close: 1 },
  ];

  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.re.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (start < startOffset || start < lastEnd) continue;

      items.push(hide(base + start, base + start + rule.open));
      items.push({
        from: base + start + rule.open,
        to: base + end - rule.close,
        deco: Decoration.mark({ class: rule.cls }),
      });
      items.push(hide(base + end - rule.close, base + end));
      lastEnd = end;
    }
  }

  // 链接：[文字](url) → 只留文字，加下划线样式。
  const link = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = link.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    if (start < startOffset || start < lastEnd) continue;

    const labelStart = start + 1;
    const labelEnd = labelStart + match[1].length;
    items.push(hide(base + start, base + labelStart));
    items.push({
      from: base + labelStart,
      to: base + labelEnd,
      deco: Decoration.mark({ class: "cm-md-link" }),
    });
    items.push(hide(base + labelEnd, base + end));
    lastEnd = end;
  }
}

function lineItems(text: string, base: number): Item[] {

  const items: Item[] = [];

  const heading = /^(#{1,6})\s+/.exec(text);
  if (heading) {
    items.push({
      from: base,
      to: base,
      deco: Decoration.line({ class: `cm-md-h${heading[1].length}` }),
    });
    items.push(hide(base, base + heading[0].length));
    inlineItems(items, text, base, heading[0].length);
    return items;
  }

  const quote = /^>\s?/.exec(text);
  if (quote) {
    items.push({ from: base, to: base, deco: Decoration.line({ class: "cm-md-quote" }) });
    items.push(hide(base, base + quote[0].length));
    inlineItems(items, text, base, quote[0].length);
    return items;
  }

  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
    items.push({
      from: base,
      to: base + text.length,
      deco: Decoration.replace({ widget: new HrWidget() }),
    });
    return items;
  }

  const task = /^(\s*)[-*+]\s+\[( |x|X)\]\s+/.exec(text);
  if (task) {
    items.push({
      from: base + task[1].length,
      to: base + task[0].length,
      deco: Decoration.replace({ widget: new TaskWidget(task[2].toLowerCase() === "x") }),
    });
    return items;
  }

  const bullet = /^(\s*)[-*+]\s+/.exec(text);
  if (bullet) {
    items.push({
      from: base + bullet[1].length,
      to: base + bullet[0].length,
      deco: Decoration.replace({ widget: new BulletWidget() }),
    });
    inlineItems(items, text, base, bullet[0].length);
    return items;
  }

  inlineItems(items, text, base, 0);
  return items;
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function scanTables(doc: Text, fences: Map<number, "marker" | "body">): Map<number, TableBlock> {
  const tables = new Map<number, TableBlock>();

  for (let n = 1; n < doc.lines; n += 1) {
    if (fences.has(n) || fences.has(n + 1)) continue;

    const text = doc.line(n).text;
    if (!text.includes("|")) continue;
    if (!isSeparatorRow(doc.line(n + 1).text)) continue;

    const headerLine = doc.line(n);
    const header = parseTableRow(headerLine.text);
    const aligns = splitCells(doc.line(n + 1).text).map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      return left && right ? "center" : right ? "right" : "left";
    });

    const rows: string[][] = [];
    let end = n + 1;
    let cursor = n + 2;
    while (cursor <= doc.lines) {
      const rowLine = doc.line(cursor);
      if (!rowLine.text.includes("|") || !rowLine.text.trim()) break;
      rows.push(parseTableRow(rowLine.text));
      end = cursor;
      cursor += 1;
    }

    tables.set(n, { start: n, end, header, rows, aligns });
    n = end;
  }

  return tables;
}

interface CodeBlockInfo {
  open: number;
  close: number | null;
  bodyFrom: number;
  bodyTo: number;
  hasBody: boolean;
  lang: string;
  code: string;
}

interface LivePreviewValue {
  decorations: DecorationSet;
  blocks: readonly CodeBlockInfo[];
}

/** 代码块扫描：块信息给渲染和选区守卫共用，围栏行仍用于表格避让。 */
function scanCodeBlocks(doc: Text): {
  fences: Map<number, "marker" | "body">;
  blocks: CodeBlockInfo[];
} {
  const fences = new Map<number, "marker" | "body">();
  const blocks: CodeBlockInfo[] = [];
  let open: { line: number; lang: string } | null = null;

  const collect = (start: { line: number; lang: string }, close: number | null): void => {
    const bodyFrom = start.line + 1;
    const bodyTo = close === null ? doc.lines : close - 1;
    const lines: string[] = [];
    for (let n = bodyFrom; n <= bodyTo; n += 1) lines.push(doc.line(n).text);
    blocks.push({
      open: start.line,
      close,
      bodyFrom,
      bodyTo,
      hasBody: bodyTo >= bodyFrom,
      lang: start.lang,
      code: lines.join("\n"),
    });
  };

  for (let n = 1; n <= doc.lines; n += 1) {
    const match = /^\s*(```|~~~)\s*([^\s`~]*)/.exec(doc.line(n).text);
    if (!match) {
      if (open) fences.set(n, "body");
      continue;
    }

    fences.set(n, "marker");
    if (open) {
      collect(open, n);
      open = null;
    } else {
      open = { line: n, lang: match[2] };
    }
  }

  // 未闭合的围栏也按代码块显示，避免点击时整行凭空消失。
  if (open) collect(open, null);

  return { fences, blocks };
}

function build(state: EditorState): LivePreviewValue {
  const doc = state.doc;

  // 大文档关闭装饰，避免每次输入全量扫描。
  if (doc.lines > 3000) {
    return { decorations: Decoration.none, blocks: [] };
  }

  const { fences, blocks } = scanCodeBlocks(doc);
  const blockByOpen = new Map<number, CodeBlockInfo>();
  const blockByClose = new Map<number, CodeBlockInfo>();
  for (const block of blocks) {
    blockByOpen.set(block.open, block);
    if (block.close !== null) blockByClose.set(block.close, block);
  }

  const tables = scanTables(doc, fences);

  const builder = new RangeSetBuilder<Decoration>();
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber);

    // 表格：整块替换成 HTML 表格；预览态只读，始终渲染。
    const table = tables.get(lineNumber);
    if (table) {
      builder.add(
        doc.line(table.start).from,
        doc.line(table.end).to,
        Decoration.replace({ widget: new TableWidget(table), block: true }),
      );
      lineNumber = table.end + 1;
      continue;
    }

    const fence = fences.get(lineNumber) ?? "none";

    if (fence === "marker") {
      const openBlock = blockByOpen.get(lineNumber);
      const closeBlock = blockByClose.get(lineNumber);

      if (openBlock) {
        builder.add(
          line.from,
          line.to,
          Decoration.replace({
            block: true,
            widget: new CodeHeaderWidget(openBlock.lang, openBlock.code),
          }),
        );
      } else if (closeBlock) {
        builder.add(
          line.from,
          line.to,
          Decoration.replace({ block: true, widget: new CodeFooterWidget() }),
        );
      }
    } else if (fence === "body") {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
    } else {
      const items = lineItems(line.text, line.from);
      items.sort((a, b) => a.from - b.from || a.to - b.to);
      for (const item of items) {
        builder.add(item.from, item.to, item.deco);
      }
    }

    lineNumber += 1;
  }

  return { decorations: builder.finish(), blocks };
}

/** 从源码态切回渲染态时，把落在围栏行上的光标挪进正文。 */
export function placeCursorOutsideFence(view: EditorView): void {
  const live = view.state.field(livePreviewExtension, false);
  if (!live || live.blocks.length === 0) return;
  const { doc, selection } = view.state;
  if (!selection.main.empty) return;

  const line = doc.lineAt(selection.main.head);
  for (const block of live.blocks) {
    if (!block.hasBody) continue;
    if (block.open === line.number) {
      view.dispatch({ selection: EditorSelection.cursor(doc.line(block.bodyFrom).from) });
      return;
    }
    if (block.close === line.number) {
      view.dispatch({ selection: EditorSelection.cursor(doc.line(block.bodyTo).to) });
      return;
    }
  }
}

/**
 * 围栏行不允许被点击或方向键直接落进去：
 * 否则光标会钻进被隐藏的 ``` 行，代码块就会被拆开。
 */
export const livePreviewGuard = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection) return tr;
  // 只拦光标落点；Ctrl+A、Shift+方向键这类整段选区保持原样。
  if (!tr.selection.main.empty) return tr;
  if (tr.selection.ranges.length > 1) return tr;

  const live = tr.startState.field(livePreviewExtension, false);
  if (!live || live.blocks.length === 0) return tr;

  const doc = tr.newDoc;
  const newHead = tr.selection.main.head;
  const newLine = doc.lineAt(newHead).number;
  const startHead = tr.startState.selection.main.head;
  const startLine = tr.startState.doc.lineAt(startHead).number;

  for (const block of live.blocks) {
    if (!block.hasBody) continue;

    if (block.open === newLine) {
      const fromBody = startLine >= block.bodyFrom && startLine <= block.bodyTo;
      // 从正文第一行按上键时，直接跳到代码块上一行，而不是卡在围栏里。
      const target =
        fromBody && newHead < startHead && block.open > 1
          ? doc.line(block.open - 1).to
          : doc.line(block.bodyFrom).from;
      return [tr, { selection: EditorSelection.cursor(target) }];
    }

    if (block.close === newLine && startLine !== block.close) {
      const fromBody = startLine >= block.bodyFrom && startLine <= block.bodyTo;
      // 从正文最后一行按下键时，直接跨到代码块下一行。
      const target =
        fromBody && newHead > startHead && block.close < doc.lines
          ? doc.line(block.close + 1).from
          : doc.line(block.bodyTo).to;
      return [tr, { selection: EditorSelection.cursor(target) }];
    }
  }

  return tr;
});

/**
 * 块级装饰只能由 StateField 提供（CM6 限制），所以整个预览装饰走 state field。
 */
export const livePreviewExtension = StateField.define<LivePreviewValue>({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
