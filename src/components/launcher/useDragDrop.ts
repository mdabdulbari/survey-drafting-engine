import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface Options {
  onDrop: (paths: string[]) => void;
}

/** Subscribes to Tauri's window-wide drag-drop event. Returns whether a drag
 *  is currently hovering the window so callers can render an overlay. */
export function useDragDrop({ onDrop }: Options): { hover: boolean } {
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const handle = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload as
            | { type: "enter" | "over"; paths?: string[] }
            | { type: "drop"; paths: string[] }
            | { type: "leave" };
          if (payload.type === "enter" || payload.type === "over") {
            setHover(true);
          } else if (payload.type === "leave") {
            setHover(false);
          } else if (payload.type === "drop") {
            setHover(false);
            onDrop(payload.paths);
          }
        });
        if (cancelled) handle();
        else unlisten = handle;
      } catch (err) {
        console.warn("drag-drop listener failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // onDrop intentionally not in deps — caller is responsible for stable identity
    // or accepting that we re-subscribe. Re-subscribing is cheap.
  }, [onDrop]);

  return { hover };
}
