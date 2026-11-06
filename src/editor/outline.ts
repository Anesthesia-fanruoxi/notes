import type { Text } from "@codemirror/state";

export interface Heading {
  line: number;
  level: number;
  text: string;
}

export interface HeadingNode {
  heading: Heading;
  children: HeadingNode[];
}

/** 按标题级别把扁平列表收成目录树；跳级的标题挂到最近的上级。 */
export function buildHeadingTree(headings: Heading[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) {
      stack.pop();
    }
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}

/** 扫描 Markdown 标题，跳过围栏代码块；行号与预览文档一致。 */
export function scanHeadings(doc: Text): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;

  for (let number = 1; number <= doc.lines; number += 1) {
    const text = doc.line(number).text;
    const fenceMatch = /^\s*(```|~~~)/.exec(text);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (!match) continue;

    const label = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (label) headings.push({ line: number, level: match[1].length, text: label });
  }

  return headings;
}
