import { useEffect, useRef, useState } from "react";

import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

interface HudState {
  size: number;
  seq: number;
}

/**
 * Ctrl + 滚轮缩放字号：滚轮方向决定增减，中央 HUD 显示 1 秒。
 * 拦截默认 webview 缩放，保证字号只由应用控制。
 */
export default function FontZoomHud() {
  const [hud, setHud] = useState<HudState | null>(null);
  const timerRef = useRef(0);
  const seqRef = useRef(0);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();

      const state = useAppStore.getState();
      const step = event.deltaY < 0 ? 1 : -1;
      const next = Math.max(8, Math.min(32, state.fontSize + step));
      state.setFontSize(next);

      seqRef.current += 1;
      setHud({ size: next, seq: seqRef.current });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setHud(null), 1000);
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, true);
      window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!hud) return null;

  return (
    <div
      key={hud.seq}
      className={styles.fontHud}
      role="status"
      aria-live="polite"
    >
      <span className={styles.fontHudLabel}>字号</span>
      <span className={styles.fontHudValue}>{hud.size}px</span>
    </div>
  );
}
