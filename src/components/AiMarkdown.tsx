import { Fragment, createElement, useMemo, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import styles from "../styles/app.module.css";

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; range: string; code: string }
  | { type: "list"; items: { text: string; depth: number; marker: string }[] }
  | { type: "quote"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

const LIST_RE = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/;
const INLINE_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function shouldBreakParagraph(line: string): boolean {
  return (
    !line.trim() ||
    /^\s*(```|#{1,6}\s|>\s?|\|)/.test(line) ||
    LIST_RE.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", range: fence[1] ?? "", code: code.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    if (LIST_RE.test(line)) {
      const items: { text: string; depth: number; marker: string }[] = [];
      while (i < lines.length) {
        const match = LIST_RE.exec(lines[i]);
        if (!match) break;
        items.push({
          text: match[3],
          depth: Math.min(3, Math.floor(match[1].length / 2)),
          marker: match[2] ? `${match[2]}.` : "•",
        });
        i += 1;
        // 列表项之间的空行不打断同一个列表。
        let next = i;
        while (next < lines.length && !lines[next].trim()) next += 1;
        if (next < lines.length && LIST_RE.test(lines[next])) i = next;
        else break;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && !shouldBreakParagraph(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(href).catch(() => window.open(href, "_blank", "noopener"));
      }}
    >
      {children}
    </a>
  );
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const push = (node: ReactNode) => {
    nodes.push(<Fragment key={key++}>{node}</Fragment>);
  };
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) push(text.slice(last, index));
    if (match[2] !== undefined) {
      push(<Link href={match[2]}>{match[1]}</Link>);
    } else if (match[3] !== undefined) {
      push(<strong>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      push(<del>{match[4]}</del>);
    } else if (match[5] !== undefined) {
      push(<em>{match[5]}</em>);
    } else {
      push(<em>{match[6]}</em>);
    }
    last = index + match[0].length;
  }
  if (last < text.length) push(text.slice(last));
  return nodes;
}

function renderText(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).map((part, index) => {
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{renderInline(part)}</Fragment>;
  });
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const tag = `h${Math.min(4, Math.max(1, block.level))}`;
      return createElement(tag, { key: index }, renderText(block.text));
    }
    case "paragraph":
      return <p key={index}>{renderText(block.text)}</p>;
    case "code":
      return (
        <pre key={index}>
          <code>{block.code}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={index}>{renderText(block.text)}</blockquote>;
    case "list":
      return (
        <ul key={index} className={styles.msgList}>
          {block.items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              className={styles.msgListItem}
              style={{ paddingLeft: item.depth * 14 }}
            >
              <span className={styles.msgListMark}>{item.marker}</span>
              <span>{renderText(item.text)}</span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <table key={index}>
          <thead>
            <tr>
              {block.header.map((cell, cellIndex) => (
                <th key={cellIndex}>{renderText(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.header.map((_head, cellIndex) => (
                  <td key={cellIndex}>{renderText(row[cellIndex] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "hr":
      return <hr key={index} />;
    default:
      return null;
  }
}

export default function AiMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => parse(content), [content]);
  return (
    <div className={styles.msgMarkdown}>{blocks.map((block, index) => renderBlock(block, index))}</div>
  );
}
