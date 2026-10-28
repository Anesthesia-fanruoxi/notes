import { create } from "zustand";

import { readPref } from "../lib/prefs";
import type { Category, DocMeta, LineEnding } from "../lib/types";

/**
 * 只放元数据。文档正文永远不进这里（PROMPT §3.1）。
 */
export type ThemeMode = "system" | "light" | "dark";
export type TabKind = "temp" | "library";
export type DialogName = "none" | "save" | "import" | "settings";

export interface TabMeta {
  id: string;
  kind: TabKind;
  title: string;
  dirty: boolean;
  /** 临时文档的来源文件名（含扩展名），用于语言识别与保存预填。 */
  filename?: string;
  /** 入库后的文档 id。 */
  docId?: string;
  encoding: string;
  hasBom: boolean;
  lineEnding: LineEnding;
  sizeBytes: number;
  /** 命中读取上限，只能按纯文本档打开。 */
  truncated: boolean;
  /** "__plain" 或语言名；空表示自动识别。 */
  languageOverride?: string;
  languageLabel?: string;
}

export const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 22];

export interface TabInit {
  title: string;
  kind?: TabKind;
  filename?: string;
  docId?: string;
  encoding?: string;
  hasBom?: boolean;
  lineEnding?: LineEnding;
  sizeBytes?: number;
  truncated?: boolean;
  dirty?: boolean;
}

let tabSeq = 0;

export function newTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabSeq}`;
}

interface AppState {
  tabs: TabMeta[];
  activeTabId: string | null;

  categories: Category[];
  docs: DocMeta[];
  collapsed: Record<string, boolean>;
  query: string;

  dialog: DialogName;

  sidebarWidth: number;
  aiWidth: number;
  aiOpen: boolean;

  themeMode: ThemeMode;
  fontSize: number;
  lineHeight: number;

  cursor: { line: number; col: number };
  docSize: number;

  addTab: (init: TabInit, activate?: boolean) => string;
  addRestoredTab: (id: string, init: TabInit) => void;
  updateTab: (id: string, patch: Partial<TabMeta>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  cycleTab: (delta: number) => void;
  markDirty: (id: string, dirty?: boolean) => void;
  setLanguageOverride: (id: string, override: string | undefined) => void;
  setLanguageLabel: (id: string, label: string) => void;

  setLibrary: (categories: Category[], docs: DocMeta[]) => void;
  toggleCollapsed: (categoryId: string) => void;
  setQuery: (query: string) => void;
  openDialog: (dialog: DialogName) => void;

  setCursor: (line: number, col: number) => void;
  setDocSize: (size: number) => void;

  setSidebarWidth: (width: number) => void;
  setAiWidth: (width: number) => void;
  toggleAi: () => void;

  cycleTheme: () => void;
  cycleFontSize: () => void;
}

const firstTabId = newTabId();

function makeTab(init: TabInit, id: string): TabMeta {
  return {
    id,
    kind: init.kind ?? "temp",
    title: init.title,
    dirty: init.dirty ?? false,
    filename: init.filename,
    docId: init.docId,
    encoding: init.encoding ?? "UTF-8",
    hasBom: init.hasBom ?? false,
    lineEnding: init.lineEnding ?? "LF",
    sizeBytes: init.sizeBytes ?? 0,
    truncated: init.truncated ?? false,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [makeTab({ title: "未命名-1" }, firstTabId)],
  activeTabId: firstTabId,

  categories: [],
  docs: [],
  collapsed: {},
  query: "",

  dialog: "none",

  sidebarWidth: clamp(readPref("sidebarWidth", 240), 190, 420),
  aiWidth: clamp(readPref("aiWidth", 356), 300, 560),
  aiOpen: false,

  themeMode: readPref<ThemeMode>("themeMode", "system"),
  fontSize: clamp(readPref("fontSize", 13), 12, 22),
  lineHeight: readPref("lineHeight", 1.7),

  cursor: { line: 1, col: 1 },
  docSize: 0,

  addTab: (init, activate = true) => {
    const id = newTabId();
    const tab = makeTab(init, id);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: activate ? id : s.activeTabId }));
    return id;
  },

  addRestoredTab: (id, init) => {
    set((s) => {
      if (s.tabs.some((tab) => tab.id === id)) return s;
      return { tabs: [...s.tabs, makeTab(init, id)] };
    });
  },

  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) })),

  closeTab: (id) => {
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index === -1) return s;

      const tabs = s.tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) {
        const freshId = newTabId();
        return {
          tabs: [makeTab({ title: "未命名-1" }, freshId)],
          activeTabId: freshId,
          docSize: 0,
        };
      }

      const activeTabId =
        s.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)].id : s.activeTabId;
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  cycleTab: (delta) => {
    const { tabs, activeTabId } = get();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    if (index === -1) return;
    const next = (index + delta + tabs.length) % tabs.length;
    set({ activeTabId: tabs[next].id });
  },

  markDirty: (id, dirty = true) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab || tab.dirty === dirty) return s;
      return { tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) };
    });
  },

  setLanguageOverride: (id, override) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, languageOverride: override } : tab)),
    })),

  setLanguageLabel: (id, label) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab || tab.languageLabel === label) return s;
      return { tabs: s.tabs.map((t) => (t.id === id ? { ...t, languageLabel: label } : t)) };
    });
  },

  setLibrary: (categories, docs) => set({ categories, docs }),
  toggleCollapsed: (categoryId) =>
    set((s) => ({ collapsed: { ...s.collapsed, [categoryId]: !s.collapsed[categoryId] } })),
  setQuery: (query) => set({ query }),
  openDialog: (dialog) => set({ dialog }),

  setCursor: (line, col) => set({ cursor: { line, col } }),
  setDocSize: (docSize) => set({ docSize }),

  setSidebarWidth: (width) => set({ sidebarWidth: clamp(width, 190, 420) }),
  setAiWidth: (width) => set({ aiWidth: clamp(width, 300, 560) }),

  toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen })),

  cycleTheme: () => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const current = order.indexOf(get().themeMode);
    set({ themeMode: order[(current + 1) % order.length] });
  },

  cycleFontSize: () => {
    const current = get().fontSize;
    const index = FONT_SIZES.findIndex((size) => size >= current);
    const next = index === -1 ? FONT_SIZES[0] : FONT_SIZES[(index + 1) % FONT_SIZES.length];
    set({ fontSize: next });
  },
}));

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
