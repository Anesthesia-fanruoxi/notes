import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "../styles/app.module.css";

const TOOLTIP_ID = "app-custom-tooltip";
const SHOW_DELAY_MS = 140;
const MARGIN = 10;

interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface Tip {
  text: string;
  rect: AnchorRect;
}

interface SavedTipState {
  title: string | null;
  described: boolean;
}

/**
 * 全局悬浮提示：接管所有 title / data-tooltip，
 * 在拿掉 title 的同时用自定义卡片显示，避免浏览器默认提示和重复提示。
 */
export default function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const savedRef = useRef(new WeakMap<HTMLElement, SavedTipState>());
  const timerRef = useRef(0);
  const suppressedRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
    };

    const restore = () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      suppressedRef.current = false;

      const element = activeRef.current;
      if (element) {
        const saved = savedRef.current.get(element);
        if (saved) {
          if (saved.title !== null && !element.hasAttribute("title")) {
            element.setAttribute("title", saved.title);
          }
          if (saved.described) {
            element.removeAttribute("aria-describedby");
          }
          savedRef.current.delete(element);
        }
      }
      activeRef.current = null;
      setTip(null);
    };

    const deactivate = () => {
      clearTimer();
      restore();
    };

    /** 滚动/失焦时只收起提示，title 继续压住，避免鼠标不动时原生框冒出来。 */
    const hideOnly = () => {
      clearTimer();
      suppressedRef.current = true;
      setTip(null);
    };

    const showTip = (element: HTMLElement) => {
      const saved = savedRef.current.get(element);
      const text = (
        element.getAttribute("data-tooltip") ??
        saved?.title ??
        ""
      ).trim();
      if (!text) return;

      const rect = element.getBoundingClientRect();
      setTip({
        text,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      });
    };

    const activate = (element: HTMLElement, delay: number) => {
      const text = (
        element.getAttribute("data-tooltip") ??
        element.getAttribute("title") ??
        ""
      ).trim();
      if (!text) return;

      clearTimer();
      if (activeRef.current === element) return;
      if (activeRef.current) restore();

      const title = element.getAttribute("title");
      const described = !element.hasAttribute("aria-describedby");
      if (title !== null) element.removeAttribute("title");
      if (described) element.setAttribute("aria-describedby", TOOLTIP_ID);
      savedRef.current.set(element, { title, described });
      activeRef.current = element;
      suppressedRef.current = false;

      // React 重新渲染会把 title 写回来；盯着活动元素，写回就继续拿掉。
      observerRef.current?.disconnect();
      const observer = new MutationObserver(() => {
        const current = activeRef.current;
        if (!current) return;
        const nextTitle = current.getAttribute("title");
        if (nextTitle === null) return;
        const saved = savedRef.current.get(current);
        if (saved) saved.title = nextTitle;
        current.removeAttribute("title");
        if (suppressedRef.current) return;
        const nextText = nextTitle.trim();
        if (nextText) {
          setTip((prev) => (prev ? { ...prev, text: nextText } : prev));
        }
      });
      observer.observe(element, { attributes: true, attributeFilter: ["title"] });
      observerRef.current = observer;

      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        if (activeRef.current !== element || !element.isConnected) return;
        showTip(element);
      }, delay);
    };

    const titledElement = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      return target.closest<HTMLElement>("[title], [data-tooltip]");
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = titledElement(event.target);
      if (element) activate(element, SHOW_DELAY_MS);
    };

    const onPointerOut = (event: PointerEvent) => {
      const element = activeRef.current;
      if (!element) return;
      const related = event.relatedTarget;
      if (related instanceof Node && element.contains(related)) return;
      deactivate();
    };

    const onPointerMove = () => {
      const element = activeRef.current;
      if (!element) return;
      if (!element.isConnected) {
        deactivate();
        return;
      }
      // React 重渲染可能重新写回 title；继续拦截并同步最新的提示文字。
      const title = element.getAttribute("title");
      if (title !== null) {
        element.removeAttribute("title");
        const saved = savedRef.current.get(element);
        if (saved) saved.title = title;
        const text = title.trim();
        if (!suppressedRef.current && text) {
          setTip((prev) => (prev ? { ...prev, text } : prev));
        }
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const element = titledElement(event.target);
      if (element) activate(element, 0);
    };

    const onFocusOut = (event: FocusEvent) => {
      const element = activeRef.current;
      if (!element) return;
      const related = event.relatedTarget;
      if (related instanceof Node && element.contains(related)) return;
      deactivate();
    };

    /**
     * 左键点击后先收起提示，但 title 继续压住；
     * 指针仍停在元素上时 1 秒后重新显示自定义提示。
     */
    const onPointerDown = (event: PointerEvent) => {
      const element = activeRef.current;
      if (!element) return;

      clearTimer();
      suppressedRef.current = true;
      setTip(null);

      if (event.button !== 0) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        if (activeRef.current !== element || !element.isConnected) return;
        suppressedRef.current = false;
        showTip(element);
      }, 1000);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideOnly();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", hideOnly, true);
    window.addEventListener("resize", hideOnly);
    window.addEventListener("blur", hideOnly);

    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", hideOnly, true);
      window.removeEventListener("resize", hideOnly);
      window.removeEventListener("blur", hideOnly);
      deactivate();
    };
  }, []);

  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!element || !tip) return;

    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const anchor = tip.rect;
    const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
    const left = Math.min(
      Math.max(anchor.left + anchor.width / 2 - width / 2, MARGIN),
      maxLeft,
    );

    let top = anchor.top - height - 9;
    let side: "top" | "bottom" = "top";
    if (top < MARGIN) {
      top = anchor.bottom + 9;
      side = "bottom";
    }
    top = Math.min(
      Math.max(top, MARGIN),
      Math.max(MARGIN, window.innerHeight - height - MARGIN),
    );

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.dataset.side = side;
    element.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      className={styles.tooltip}
      style={{ visibility: "hidden" }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
