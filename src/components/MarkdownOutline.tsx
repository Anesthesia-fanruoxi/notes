import clsx from "clsx";
import { useMemo, type CSSProperties } from "react";

import { buildHeadingTree, type Heading, type HeadingNode } from "../editor/outline";
import styles from "../styles/app.module.css";

interface Props {
  headings: Heading[];
  activeLine: number | null;
  collapsed: ReadonlySet<number>;
  onJump: (line: number) => void;
  onToggle: (line: number) => void;
}

interface NodeProps {
  node: HeadingNode;
  depth: number;
  activeLine: number | null;
  collapsed: ReadonlySet<number>;
  onJump: (line: number) => void;
  onToggle: (line: number) => void;
}

function OutlineNode({ node, depth, activeLine, collapsed, onJump, onToggle }: NodeProps) {
  const { heading, children } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(heading.line);

  return (
    <div className={styles.outlineGroup}>
      <button
        type="button"
        className={clsx(
          styles.outlineItem,
          hasChildren && styles.outlineItemParent,
          activeLine === heading.line && styles.outlineItemActive,
        )}
        style={{ "--outline-depth": depth } as CSSProperties}
        title={heading.text}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onJump(heading.line)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (hasChildren) onToggle(heading.line);
        }}
        onKeyDown={(event) => {
          if (!hasChildren) return;
          if (event.key === "ArrowRight" && isCollapsed) {
            event.preventDefault();
            onToggle(heading.line);
          } else if (event.key === "ArrowLeft" && !isCollapsed) {
            event.preventDefault();
            onToggle(heading.line);
          }
        }}
      >
        {Array.from({ length: depth }, (_, index) => (
          <span key={index} className={styles.outlineGuide} aria-hidden="true" />
        ))}
        {hasChildren ? (
          <span
            className={clsx(
              styles.outlineToggler,
              !isCollapsed && styles.outlineTogglerOpen,
            )}
            aria-hidden="true"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(heading.line);
            }}
          >
            {isCollapsed ? "+" : "−"}
          </span>
        ) : (
          <span className={styles.outlineTogglerSpace} aria-hidden="true" />
        )}
        <span className={styles.outlineText}>{heading.text}</span>
      </button>
      {hasChildren && (
        <div
          className={clsx(
            styles.outlineChildren,
            isCollapsed && styles.outlineChildrenCollapsed,
          )}
        >
          <div className={styles.outlineChildrenInner}>
            {children.map((child) => (
              <OutlineNode
                key={child.heading.line}
                node={child}
                depth={depth + 1}
                activeLine={activeLine}
                collapsed={collapsed}
                onJump={onJump}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarkdownOutline({
  headings,
  activeLine,
  collapsed,
  onJump,
  onToggle,
}: Props) {
  const tree = useMemo(() => buildHeadingTree(headings), [headings]);

  return (
    <div className={styles.outlineInner}>
      <div className={styles.outlineTitle}>目录</div>
      <div className={styles.outlineList}>
        {tree.length === 0 && <div className={styles.outlineEmpty}>暂无标题</div>}
        {tree.map((node) => (
          <OutlineNode
            key={node.heading.line}
            node={node}
            depth={0}
            activeLine={activeLine}
            collapsed={collapsed}
            onJump={onJump}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
