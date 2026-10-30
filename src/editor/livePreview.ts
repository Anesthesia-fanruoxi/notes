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
 * Typora 式「实时渲染」：不是预览面板，而是在编辑区里把 Markdown 标记隐藏掉，
 * 光标所在行保持源码形态，方便继续输入。
 *
 * 代码块是例外：围栏行默认冻结成头部/底部，点击正文不会把块拆开；
 * 改语言走头部的语言选择器，整体改结构请切源码模式。
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

interface LangOption {
  code: string;
  label: string;
}

/** 语言选择器的候选项：代码围栏里直接写 code。 */
const LANG_OPTIONS: LangOption[] = Object.entries(LANG_LABELS)
  .map(([code, label]) => ({ code, label }))
  .sort((a, b) => a.code.localeCompare(b.code));

function filterLanguages(query: string): LangOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const prefix: LangOption[] = [];
  const rest: LangOption[] = [];
  for (const option of LANG_OPTIONS) {
    const code = option.code.toLowerCase();
    const label = option.label.toLowerCase();
    if (code === q) prefix.unshift(option);
    else if (code.startsWith(q) || label.startsWith(q)) prefix.push(option);
    else if (code.includes(q) || label.includes(q)) rest.push(option);
  }
  return [...prefix, ...rest];
}

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.6" y="5.6" width="7.9" height="8.9" rx="1.4"/><path d="M10.4 5.6V3.4A1.4 1.4 0 0 0 9 2H3.4A1.4 1.4 0 0 0 2 3.4V9a1.4 1.4 0 0 0 1.4 1.4h2.2"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.4 8.6 3 3 6.2-6.8"/></svg>';

/** 语言选择器的清理函数：widget 被销毁时同步收掉输入盒。 */
const languagePickers = new WeakMap<HTMLElement, () => void>();

/** 把新的语言写回围栏行，只替换语言标记本身。 */
function applyFenceLanguage(view: EditorView, lineFrom: number, value: string): void {
  const doc = view.state.doc;
  if (lineFrom < 0 || lineFrom > doc.length) return;
  const line = doc.lineAt(lineFrom);
  if (line.from !== lineFrom) return;

  const match = /^(\s*)(```|~~~)[ \t]*([^\s`~]*)/.exec(line.text);
  if (!match) return;

  const next = value.replace(/[\r\n`~]/g, " ").trim().split(/\s+/)[0] ?? "";
  if (match[3] === next) return;

  const to = line.from + match[0].length;
  view.dispatch({
    changes: { from: to - match[3].length, to, insert: next },
    userEvent: "input",
  });
}

/** 点击语言标识：在头部弹一个小输入框，带语言联想。 */
function openLanguagePicker(
  view: EditorView,
  head: HTMLElement,
  label: HTMLElement,
  lineFrom: number,
): void {
  if (languagePickers.has(head)) return;

  const doc = view.state.doc;
  if (lineFrom < 0 || lineFrom > doc.length) return;
  const line = doc.lineAt(lineFrom);
  if (line.from !== lineFrom) return;
  const match = /^(\s*)(```|~~~)[ \t]*([^\s`~]*)/.exec(line.text);
  if (!match) return;
  const current = match[3];

  const wrap = document.createElement("span");
  wrap.className = "cm-md-lang-edit";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cm-md-lang-input";
  input.value = current;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "代码块语言");
  wrap.appendChild(input);

  const menu = document.createElement("div");
  menu.className = "cm-md-lang-menu";
  menu.setAttribute("role", "listbox");
  wrap.appendChild(menu);

  label.hidden = true;
  head.insertBefore(wrap, label.nextSibling);

  let options: LangOption[] = [];
  let active = -1;
  let typed = false;
  let closed = false;

  const revealActive = (): void => {
    const row = menu.children[active] as HTMLElement | undefined;
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = bottom - menu.clientHeight;
    }
  };

  const paintActive = (): void => {
    const rows = menu.querySelectorAll<HTMLElement>(".cm-md-lang-option");
    rows.forEach((row, index) => {
      row.classList.toggle("is-active", index === active);
      row.setAttribute("aria-selected", String(index === active));
    });
    revealActive();
  };

  const render = (mode: "open" | "type"): void => {
    const query = input.value.trim();
    options = typed ? filterLanguages(query) : [...LANG_OPTIONS];
    active = mode === "open" ? options.findIndex((option) => option.code === current) : options.length ? 0 : -1;

    menu.replaceChildren();
    options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = `cm-md-lang-option${index === active ? " is-active" : ""}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === active));
      const code = document.createElement("span");
      code.className = "cm-md-lang-code";
      code.textContent = option.code;
      const name = document.createElement("span");
      name.className = "cm-md-lang-name";
      name.textContent = option.label;
      row.append(code, name);
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        commit(option.code);
      });
      menu.appendChild(row);
    });

    if (!options.length) {
      const hint = document.createElement("div");
      hint.className = "cm-md-lang-empty";
      hint.textContent = typed && query ? `回车使用“${query}”` : "回车移除语言";
      menu.appendChild(hint);
    } else if (active >= 0) {
      revealActive();
    }
  };

  const choice = (): string => {
    if (typed && !input.value.trim()) return "";
    if (active >= 0 && options[active]) return options[active].code;
    return input.value.trim();
  };

  const cleanup = (): void => {
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onResize);
    wrap.remove();
    label.hidden = false;
    languagePickers.delete(head);
    if (activeLanguagePicker === closePicker) activeLanguagePicker = null;
  };

  const close = (focusEditor: boolean): void => {
    if (closed) return;
    closed = true;
    cleanup();
    if (focusEditor) view.focus();
  };

  const closePicker = (): void => close(false);
  activeLanguagePicker = closePicker;

  const commit = (value: string): void => {
    if (closed) return;
    closed = true;
    cleanup();
    applyFenceLanguage(view, lineFrom, value);
    view.focus();
  };

  const onResize = (): void => close(false);
  const onOutside = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && (wrap.contains(target) || label.contains(target))) return;
    close(false);
  };

  // 点菜单空白处不要把输入框的焦点带走。
  menu.addEventListener("mousedown", (event) => event.preventDefault());

  input.addEventListener("input", () => {
    typed = true;
    render("type");
  });

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing) return;

    if (event.key === "Enter") {
      event.preventDefault();
      commit(choice());
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      commit(choice());
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      active =
        active < 0
          ? delta > 0
            ? 0
            : options.length - 1
          : (active + delta + options.length) % options.length;
      paintActive();
    }
  });

  languagePickers.set(head, closePicker);
  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("resize", onResize);

  render("open");
  const rect = input.getBoundingClientRect();
  menu.classList.toggle(
    "is-up",
    window.innerHeight - rect.bottom < 210 && rect.top > 210,
  );
  input.focus();
  input.select();
}

/** 代码块头部：左边语言标识（点击弹出语言输入框），右边复制图标按钮。 */
class CodeHeaderWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
    readonly lineFrom: number,
    readonly focusPos: number | null,
  ) {
    super();
  }

  eq(other: CodeHeaderWidget): boolean {
    return (
      other.lang === this.lang &&
      other.code === this.code &&
      other.lineFrom === this.lineFrom &&
      other.focusPos === this.focusPos
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const head = document.createElement("div");
    head.className = "cm-md-code-head";

    const lang = document.createElement("span");
    lang.className = "cm-md-lang";
    lang.textContent = this.lang || "text";
    const label = LANG_LABELS[this.lang.toLowerCase()] ?? (this.lang || "纯文本");
    lang.title = `${label} · 点击选择语言`;
    lang.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    lang.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLanguagePicker(view, head, lang, this.lineFrom);
    });
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

    // 点击头部空白处聚焦代码正文，而不是让光标落进被隐藏的围栏行。
    head.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".cm-md-lang, .cm-md-copy, .cm-md-lang-edit")) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.focusPos === null) {
        // 空代码块没有正文可放光标，点击头部只聚焦编辑器。
        view.focus();
        return;
      }
      view.dispatch({
        selection: EditorSelection.cursor(this.focusPos),
        scrollIntoView: true,
      });
      view.focus();
    });

    return head;
  }

  destroy(dom: HTMLElement): void {
    languagePickers.get(dom)?.();
  }
}

/** 代码块底部收口：盖住结束围栏行，点击时聚焦代码末尾。 */
class CodeFooterWidget extends WidgetType {
  constructor(readonly focusPos: number | null) {
    super();
  }

  eq(other: CodeFooterWidget): boolean {
    return other.focusPos === this.focusPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const foot = document.createElement("div");
    foot.className = "cm-md-code-foot";
    foot.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      if (this.focusPos !== null) {
        view.dispatch({
          selection: EditorSelection.cursor(this.focusPos),
          scrollIntoView: true,
        });
      }
    });
    return foot;
  }
}

interface TableCellInfo {
  /** 显示文本（\| 已还原为 |）。 */
  text: string;
  /** 单元格内容在源码里的范围（不含两侧空白与分隔竖线）。 */
  from: number;
  to: number;
}

interface TableBlock {
  start: number;
  end: number;
  header: TableCellInfo[];
  rows: TableCellInfo[][];
  aligns: ("left" | "center" | "right")[];
}

interface ActiveTableCell {
  input: HTMLInputElement;
  commit: (focusEditor: boolean) => void;
  cancel: (focusEditor?: boolean) => void;
}

/** 单元格 DOM → 打开编辑的入口；表格重绘后由新的 widget 重新登记。 */
const tableCellOpeners = new WeakMap<HTMLElement, () => void>();
let activeTableCell: ActiveTableCell | null = null;
let activeLanguagePicker: (() => void) | null = null;

/** 切换标签/切源码/销毁编辑器前，把浮层输入和单元格编辑收掉，避免串标签。 */
export function closeLivePreviewPopovers(): void {
  activeLanguagePicker?.();
  activeTableCell?.cancel(false);
}

function isEscapedPipe(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

function pushTableCell(
  cells: TableCellInfo[],
  lineText: string,
  lineFrom: number,
  start: number,
  end: number,
): void {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(lineText[from])) from += 1;
  while (to > from && /\s/.test(lineText[to - 1])) to -= 1;
  cells.push({
    text: lineText.slice(from, to).replace(/\\\|/g, "|"),
    from: lineFrom + from,
    to: lineFrom + to,
  });
}

/** 与 splitCells 语义一致，但保留每个单元格在源码里的准确范围。 */
function parseTableRow(lineText: string, lineFrom: number): TableCellInfo[] {
  let from = 0;
  let to = lineText.length;
  while (from < to && /\s/.test(lineText[from])) from += 1;
  while (to > from && /\s/.test(lineText[to - 1])) to -= 1;
  if (from >= to) return [];

  if (lineText[from] === "|") from += 1;
  if (to > from && lineText[to - 1] === "|" && !isEscapedPipe(lineText, to - 1)) to -= 1;

  const cells: TableCellInfo[] = [];
  let cellStart = from;
  for (let i = from; i < to; i += 1) {
    if (lineText[i] === "|" && !isEscapedPipe(lineText, i)) {
      pushTableCell(cells, lineText, lineFrom, cellStart, i);
      cellStart = i + 1;
    }
  }
  pushTableCell(cells, lineText, lineFrom, cellStart, to);
  return cells;
}

function findTableCell(
  view: EditorView,
  tableLine: number,
  key: string | null,
  delta: number,
): HTMLElement | null {
  const table = view.contentDOM.querySelector<HTMLElement>(
    `.cm-md-table[data-table-line="${tableLine}"]`,
  );
  if (!table) return null;
  const cells = Array.from(table.querySelectorAll<HTMLElement>("[data-cell]"));
  if (!cells.length) return null;
  const index = key === null ? -1 : cells.findIndex((cell) => cell.dataset.cell === key);
  const target =
    index >= 0
      ? cells[index + delta]
      : delta === 0
        ? null
        : cells[delta > 0 ? 0 : cells.length - 1];
  return target ?? null;
}

function focusTableCellAfterRender(
  view: EditorView,
  tableLine: number,
  key: string,
): void {
  const state = view.state;
  requestAnimationFrame(() => {
    if (view.state !== state) return;
    const cell = findTableCell(view, tableLine, key, 0);
    const open = cell ? tableCellOpeners.get(cell) : null;
    if (open) open();
    else view.focus();
  });
}

function moveTableCellFocus(
  view: EditorView,
  tableLine: number,
  key: string,
  delta: number,
): void {
  const state = view.state;
  requestAnimationFrame(() => {
    if (view.state !== state) return;
    const cell = findTableCell(view, tableLine, key, delta);
    const open = cell ? tableCellOpeners.get(cell) : null;
    if (open) open();
    else view.focus();
  });
}

/** 单击单元格：在单元格上覆盖一个小输入框，只回写这一格。 */
function openTableCellEditor(
  view: EditorView,
  cellEl: HTMLElement,
  cell: TableCellInfo,
  align: string,
  move: (delta: number) => void,
): void {
  if (!cellEl.isConnected) return;
  if (cellEl.querySelector(".cm-md-table-edit")) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cm-md-table-edit";
  input.value = cell.text;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.style.textAlign = align;
  input.setAttribute("aria-label", "表格单元格");

  let closed = false;
  const cleanup = (): void => {
    input.remove();
    if (activeTableCell?.input === input) activeTableCell = null;
  };

  const cancel = (focusEditor = false): void => {
    if (closed) return;
    closed = true;
    cleanup();
    if (focusEditor) view.focus();
  };

  const commit = (focusEditor: boolean): void => {
    if (closed) return;
    closed = true;
    const value = input.value;
    cleanup();

    const doc = view.state.doc;
    if (cell.from >= 0 && cell.from <= cell.to && cell.to <= doc.length) {
      const line = doc.lineAt(cell.from);
      if (cell.to <= line.to) {
        const next = value
          .replace(/[\r\n]/g, " ")
          .trim()
          .replace(/(^|[^\\])\|/g, "$1\\|");
        if (doc.sliceString(cell.from, cell.to) !== next) {
          view.dispatch({
            changes: { from: cell.from, to: cell.to, insert: next },
            userEvent: "input",
          });
        }
      }
    }
    if (focusEditor) view.focus();
  };

  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("blur", () => commit(false));
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing) return;

    if (event.key === "Enter") {
      event.preventDefault();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      commit(false);
      move(delta);
    }
  });

  cellEl.appendChild(input);
  activeTableCell = { input, commit, cancel };
  input.focus();
  input.select();
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

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    wrap.dataset.tableLine = String(this.table.start);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    this.table.header.forEach((cell, index) => {
      const th = document.createElement("th");
      th.textContent = cell.text;
      const align = this.table.aligns[index] ?? "left";
      th.style.textAlign = align;
      this.attachCell(th, view, cell, 0, index, align);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      this.table.header.forEach((_headCell, index) => {
        const td = document.createElement("td");
        const cell = row[index];
        td.textContent = cell?.text ?? "";
        const align = this.table.aligns[index] ?? "left";
        td.style.textAlign = align;
        if (cell) this.attachCell(td, view, cell, rowIndex + 1, index, align);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }

  private attachCell(
    el: HTMLElement,
    view: EditorView,
    cell: TableCellInfo,
    row: number,
    col: number,
    align: string,
  ): void {
    const key = `${row}:${col}`;
    el.dataset.cell = key;

    const open = (): void => {
      if (el.querySelector(".cm-md-table-edit")) return;
      if (activeTableCell) {
        // 先把正在编辑的格子提交，重绘后再打开当前格子。
        activeTableCell.commit(false);
        focusTableCellAfterRender(view, this.table.start, key);
        return;
      }
      openTableCellEditor(view, el, cell, align, (delta) => {
        moveTableCellFocus(view, this.table.start, key, delta);
      });
    };

    tableCellOpeners.set(el, open);
    el.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement | null)?.closest(".cm-md-table-edit")) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    });
  }

  destroy(dom: HTMLElement): void {
    if (activeTableCell && dom.contains(activeTableCell.input)) {
      activeTableCell.cancel(false);
    }
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
    { re: /\*\*([^*\n]+)\*\*/g, cls: "cm-md-strong", open: 2, close: 2 },
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
    const header = parseTableRow(headerLine.text, headerLine.from);
    const aligns = splitCells(doc.line(n + 1).text).map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      return left && right ? "center" : right ? "right" : "left";
    });

    const rows: TableCellInfo[][] = [];
    let end = n + 1;
    let cursor = n + 2;
    while (cursor <= doc.lines) {
      const rowLine = doc.line(cursor);
      if (!rowLine.text.includes("|") || !rowLine.text.trim()) break;
      rows.push(parseTableRow(rowLine.text, rowLine.from));
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

  // 选区涉及的行保持源码，否则无法编辑。
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) activeLines.add(n);
  }

  // 围栏行只看光标本身，避免跨块选区把代码块整段打回源码。
  const headLine = doc.lineAt(state.selection.main.head).number;

  const tables = scanTables(doc, fences);

  const builder = new RangeSetBuilder<Decoration>();
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber);

    // 表格：整块替换成 HTML 表格；光标在表格内时退化为源码。
    const table = tables.get(lineNumber);
    if (table) {
      let active = false;
      for (let n = table.start; n <= table.end; n += 1) {
        if (activeLines.has(n)) {
          active = true;
          break;
        }
      }
      if (!active) {
        builder.add(
          doc.line(table.start).from,
          doc.line(table.end).to,
          Decoration.replace({ widget: new TableWidget(table), block: true }),
        );
        lineNumber = table.end + 1;
        continue;
      }
    }

    const fence = fences.get(lineNumber) ?? "none";

    if (fence === "marker") {
      const openBlock = blockByOpen.get(lineNumber);
      const closeBlock = blockByClose.get(lineNumber);

      if (openBlock) {
        if (!openBlock.hasBody && headLine === lineNumber) {
          // 正在输入 ``` 本身：先保留源码，回车后再收成头部条。
          builder.add(line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
        } else {
          builder.add(
            line.from,
            line.to,
            Decoration.replace({
              block: true,
              widget: new CodeHeaderWidget(
                openBlock.lang,
                openBlock.code,
                line.from,
                openBlock.hasBody ? doc.line(openBlock.bodyFrom).from : null,
              ),
            }),
          );
        }
      } else if (closeBlock) {
        if (headLine === lineNumber) {
          // 正在补写结束围栏，暂时保留源码。
          builder.add(line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
        } else {
          builder.add(
            line.from,
            line.to,
            Decoration.replace({
              block: true,
              widget: new CodeFooterWidget(
                closeBlock.hasBody ? doc.line(closeBlock.bodyTo).to : null,
              ),
            }),
          );
        }
      }
    } else if (fence === "body") {
      // 正文行始终保留代码块底色：点击、选中都不会把块拆开。
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

/** 渲染态代码块内 Ctrl+A：只选中块内正文；整篇全选请切源码模式。 */
export function selectCodeBlockContent(view: EditorView): boolean {
  const live = view.state.field(livePreviewExtension, false);
  if (!live || live.blocks.length === 0) return false;

  const { doc, selection } = view.state;
  const line = doc.lineAt(selection.main.head);
  for (const block of live.blocks) {
    if (!block.hasBody) continue;
    const inside =
      line.number === block.open ||
      line.number === block.close ||
      (line.number >= block.bodyFrom && line.number <= block.bodyTo);
    if (inside) {
      view.dispatch({
        selection: EditorSelection.range(
          doc.line(block.bodyFrom).from,
          doc.line(block.bodyTo).to,
        ),
        scrollIntoView: true,
      });
      return true;
    }
  }
  return false;
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
 * 块级装饰只能由 StateField 提供（CM6 限制），所以整个实时渲染走 state field。
 */
export const livePreviewExtension = StateField.define<LivePreviewValue>({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged || tr.selection !== null ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
