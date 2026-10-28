/**
 * 全局唤起键。串行注册，避免 StrictMode / HMR 重复注册同一组合。
 */
let current: string | null = null;
let queue: Promise<void> = Promise.resolve();

export function applyGlobalShortcut(shortcut: string): void {
  const target = shortcut.trim();
  if (!target) return;

  queue = queue
    .then(async () => {
      if (current === target) return;

      const { register, unregister, isRegistered } = await import(
        "@tauri-apps/plugin-global-shortcut"
      );
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();

      // HMR 后模块状态会丢，先看插件里是否已有这个键。
      if (await isRegistered(target).catch(() => false)) {
        await unregister(target).catch(() => undefined);
      }

      // 先注册新键，成功后再注销旧键；新键非法时旧键仍可用。
      await register(target, (event) => {
        if (event.state !== "Pressed") return;
        void (async () => {
          await win.show();
          await win.unminimize();
          await win.setFocus();
        })();
      });
      if (current && current !== target) {
        await unregister(current).catch(() => undefined);
      }
      current = target;
    })
    .catch((err) => {
      console.warn("[shortcut] 注册失败", err);
    });
}
