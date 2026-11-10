import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  GutterMarker,
  ViewPlugin,
  gutter,
  hoverTooltip,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { diffArrays } from "diff";

import { getActiveEditorView, getActiveViewTabId } from "./activeView";
import { getTabState, putTabState } from "./tabStates";
import { SIZE_LIMITS } from "./tiers";

/**
 * 行级改动追踪：以“上次打开/保存”的内容为基线，
 * 行号后显示标记，悬停展示该行的旧/新内容。
 */

export type ChangeKind = "modified" | "added" | "deleted";

export interface LineChange {
  kind: ChangeKind;
  before: string;
  after: string;
}

interface ChangeState {
  baseline: string;
  changes: Map<number, LineChange>;
}

/** 超过这些上限就不做 diff，避免在超大文件上卡住主线程。
 *  可编辑正文一般不超过 2MiB；行数上限只防极端短行文件。 */
const MAX_DIFF_CHARS = SIZE_LIMITS.full;
const MAX_DIFF_LINES = 50_000;
const DIFF_DELAY_MS = 220;

export const setChangeBaseline = StateEffect.define<string>();
const setChanges = StateEffect.define<Map<number, LineChange>>();

const changeField = StateField.define<ChangeState>({
  create: () => ({ baseline: "", changes: new Map() }),
  update(value, tr) {
    let baseline = value.baseline;
    let changes = value.changes;
    for (const effect of tr.effects) {
      if (effect.is(setChangeBaseline)) {
        baseline = effect.value;
        changes = new Map();
      } else if (effect.is(setChanges)) {
        changes = effect.value;
      }
    }
    return baseline === value.baseline && changes === value.changes
      ? value
      : { baseline, changes };
  },
});

function kindLabel(kind: ChangeKind): string {
  if (kind === "added") return "新增";
  if (kind === "deleted") return "删除";
  return "修改";
}

class ChangeMarker extends GutterMarker {
  elementClass = "cm-change-gutter-element";

  constructor(readonly kind: ChangeKind) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return other instanceof ChangeMarker && other.kind === this.kind;
  }

  toDOM(): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "cm-change-bar";
    bar.title = `已${kindLabel(this.kind)}，悬停查看`;
    return bar;
  }
}

const markersByKind: Record<ChangeKind, ChangeMarker> = {
  modified: new ChangeMarker("modified"),
  added: new ChangeMarker("added"),
  deleted: new ChangeMarker("deleted"),
};

function changeMarkers(state: EditorState): RangeSet<GutterMarker> {
  const changes = state.field(changeField).changes;
  if (changes.size === 0) return RangeSet.empty;

  const ranges = [];
  for (const [lineNo, info] of changes) {
    if (lineNo < 1 || lineNo > state.doc.lines) continue;
    ranges.push(markersByKind[info.kind].range(state.doc.line(lineNo).from));
  }
  return RangeSet.of(ranges, true);
}

const changeGutter = gutter({
  class: "cm-change-gutter",
  markers: (view) => changeMarkers(view.state),
});

function clipText(text: string): string {
  const lines = text.split("\n");
  let clipped = lines.slice(0, 10).join("\n");
  if (clipped.length > 600) clipped = `${clipped.slice(0, 600)}…`;
  return lines.length > 10 || clipped.length < text.length ? `${clipped}\n…` : clipped;
}

function buildTooltip(info: LineChange, lineNumber: number): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-change-tip";

  const head = document.createElement("div");
  head.className = "cm-change-tip-head";
  head.textContent = `第 ${lineNumber} 行 · ${kindLabel(info.kind)}内容`;
  root.appendChild(head);

  const addBlock = (label: string, text: string) => {
    if (!text) return;
    const labelEl = document.createElement("div");
    labelEl.className = "cm-change-tip-label";
    labelEl.textContent = label;
    const pre = document.createElement("pre");
    pre.textContent = clipText(text);
    root.append(labelEl, pre);
  };

  addBlock(info.kind === "added" ? "新增" : "修改前", info.before);
  addBlock(info.kind === "deleted" ? "删除" : "修改后", info.after);
  return root;
}

const changeHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const info = view.state.field(changeField).changes.get(line.number);
  if (!info) return null;
  return {
    pos: line.from,
    end: line.to,
    above: true,
    create: () => ({ dom: buildTooltip(info, line.number) }),
  };
});

function sameChanges(
  a: Map<number, LineChange>,
  b: Map<number, LineChange>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [line, change] of a) {
    const other = b.get(line);
    if (
      !other ||
      other.kind !== change.kind ||
      other.before !== change.before ||
      other.after !== change.after
    ) {
      return false;
    }
  }
  return true;
}

/** 行级 diff：配对连续删除/新增，输出“当前行号 → 改动内容”。 */
export function computeLineChanges(
  baseline: string,
  current: string,
): Map<number, LineChange> {
  const oldLines = baseline === "" ? [] : baseline.split("\n");
  const newLines = current === "" ? [] : current.split("\n");
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return new Map();
  }

  const changes = new Map<number, LineChange>();
  const docLines = Math.max(1, newLines.length);

  const attach = (line: number, info: LineChange) => {
    const prev = changes.get(line);
    if (!prev) {
      changes.set(line, info);
      return;
    }
    changes.set(line, {
      kind: prev.kind === info.kind ? prev.kind : "modified",
      before: [prev.before, info.before].filter(Boolean).join("\n"),
      after: [prev.after, info.after].filter(Boolean).join("\n"),
    });
  };

  let currentLine = 1;
  let pendingRemoved: string[] = [];

  for (const chunk of diffArrays(oldLines, newLines)) {
    if (chunk.removed) {
      pendingRemoved.push(...chunk.value);
      continue;
    }

    if (chunk.added) {
      const before = pendingRemoved.join("\n");
      const info: LineChange = {
        kind: before ? "modified" : "added",
        before,
        after: chunk.value.join("\n"),
      };
      for (let i = 0; i < chunk.value.length; i += 1) {
        attach(Math.min(currentLine + i, docLines), info);
      }
      currentLine += chunk.value.length;
      pendingRemoved = [];
      continue;
    }

    if (pendingRemoved.length > 0) {
      attach(Math.min(currentLine, docLines), {
        kind: "deleted",
        before: pendingRemoved.join("\n"),
        after: "",
      });
      pendingRemoved = [];
    }
    currentLine += chunk.value.length;
  }

  if (pendingRemoved.length > 0) {
    attach(docLines, {
      kind: "deleted",
      before: pendingRemoved.join("\n"),
      after: "",
    });
  }

  return changes;
}

const changeTracker = ViewPlugin.fromClass(
  class {
    private timer = 0;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setChangeBaseline)),
        )
      ) {
        this.schedule();
      }
    }

    destroy() {
      window.clearTimeout(this.timer);
    }

    private schedule() {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.recompute(), DIFF_DELAY_MS);
    }

    private recompute() {
      const state = this.view.state;
      const { baseline, changes } = state.field(changeField);

      if (
        state.doc.length > MAX_DIFF_CHARS ||
        state.doc.lines > MAX_DIFF_LINES ||
        baseline.length > MAX_DIFF_CHARS
      ) {
        if (changes.size > 0) {
          this.view.dispatch({ effects: setChanges.of(new Map()) });
        }
        return;
      }

      const next = computeLineChanges(baseline, state.doc.toString());
      if (sameChanges(changes, next)) return;
      this.view.dispatch({ effects: setChanges.of(next) });
    }
  },
);

export function changeTracking(): Extension {
  return [changeField, changeGutter, changeHover, changeTracker];
}

/** 保存 / 重载后把基线推进到当前正文，清空改动标记。 */
export function resetChangeBaseline(tabId: string, content: string): void {
  const view = getActiveEditorView();
  if (view && getActiveViewTabId() === tabId) {
    view.dispatch({ effects: setChangeBaseline.of(content) });
    return;
  }

  const state = getTabState(tabId);
  if (state) {
    putTabState(
      tabId,
      state.update({ effects: setChangeBaseline.of(content) }).state,
    );
  }
}
