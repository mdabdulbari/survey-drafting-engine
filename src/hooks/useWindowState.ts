import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}

export function useWindowState(): WindowState {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refresh state on window resize (covers both maximize and OS-driven changes).
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function refresh() {
      try {
        const [max, full] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
        if (cancelled) return;
        setIsMaximized(max);
        setIsFullscreen(full);
      } catch (err) {
        console.warn("window state read failed:", err);
      }
    }

    refresh();
    win.onResized(() => refresh()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const minimize = useCallback(() => getCurrentWindow().minimize(), []);
  const close = useCallback(() => getCurrentWindow().close(), []);

  const toggleMaximize = useCallback(async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) await win.unmaximize();
    else await win.maximize();
    setIsMaximized(await win.isMaximized());
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    setIsFullscreen(next);
  }, []);

  return { isMaximized, isFullscreen, minimize, toggleMaximize, close, toggleFullscreen };
}
