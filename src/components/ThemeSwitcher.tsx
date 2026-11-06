import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { THEME_OPTIONS, themeLabel } from "../lib/themes";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

const THEME_MENU_WIDTH = 144;

export default function ThemeSwitcher() {
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const [menu, setMenu] = useState<{
    left: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);
  const [pulse, setPulse] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef(0);
  const pulseTimer = useRef(0);

  const closeMenu = () => {
    if (!menu || menuClosing) return;
    setMenuClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setMenu(null);
      setMenuClosing(false);
    }, 160);
  };

  const openMenu = () => {
    window.clearTimeout(closeTimer.current);
    setMenuClosing(false);
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - THEME_MENU_WIDTH - 8)),
      bottom: window.innerHeight - rect.top + 6,
      maxHeight: Math.max(160, Math.min(340, rect.top - 16)),
    });
  };

  const toggleMenu = () => {
    if (menu) closeMenu();
    else openMenu();
  };

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    };
    const onResize = () => closeMenu();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, menuClosing]);

  useEffect(() => {
    if (menu) selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(pulseTimer.current);
    },
    [],
  );

  const label = themeLabel(themeMode);

  const cycleTheme = () => {
    if (menu) closeMenu();
    const index = THEME_OPTIONS.findIndex((option) => option.value === themeMode);
    const next = THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length];
    setThemeMode(next.value);
    setPulse(true);
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse(false), 220);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={clsx(
          styles.statusItem,
          styles.statusClickable,
          menu && styles.statusOn,
          pulse && styles.statusPulse,
        )}
        title={`主题：${label}（左键切换，右键选择）`}
        onClick={cycleTheme}
        onContextMenu={(event) => {
          event.preventDefault();
          toggleMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            toggleMenu();
          }
        }}
      >
        {label}
      </button>

      {menu && (
        <div
          ref={menuRef}
          className={clsx(styles.themeMenu, menuClosing && styles.menuClosing)}
          style={{ left: menu.left, bottom: menu.bottom, maxHeight: menu.maxHeight }}
          role="listbox"
          aria-label="主题"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {THEME_OPTIONS.map((option) => {
            const selected = option.value === themeMode;
            return (
              <button
                key={option.value}
                ref={selected ? selectedRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                className={clsx(styles.themeOption, selected && styles.themeOptionActive)}
                onClick={() => {
                  setThemeMode(option.value);
                  closeMenu();
                }}
              >
                <span
                  className={styles.themeSwatch}
                  style={{ background: option.swatch }}
                />
                <span className={styles.themeLabel}>{option.label}</span>
                <span
                  className={clsx(
                    styles.themeCheck,
                    !selected && styles.themeCheckHidden,
                  )}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
