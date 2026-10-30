import { useEffect } from "react";

import styles from "../styles/app.module.css";

export interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const onPointerDown = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const height = items.length * 30 + 12;
  const left = Math.min(x, window.innerWidth - 196);
  const top = Math.min(y, window.innerHeight - height);

  return (
    <div
      className={styles.menu}
      style={{ left, top }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className={styles.menuSep} />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.danger ? `${styles.menuItem} ${styles.menuDanger}` : styles.menuItem}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
