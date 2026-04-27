import { useEffect } from "react";

export interface ShortcutHandlers {
  onToggleFullscreen?: () => void;
  onNewProject?: () => void;
  onReload?: () => void;
}

/** DOM-level keyboard shortcuts for the app. Skips when typing in a field. */
export function useGlobalShortcuts({
  onToggleFullscreen,
  onNewProject,
  onReload,
}: ShortcutHandlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (e.key === "F11") {
        e.preventDefault();
        onToggleFullscreen?.();
        return;
      }
      if (inField) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewProject?.();
      } else if (meta && e.key.toLowerCase() === "r") {
        e.preventDefault();
        onReload?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleFullscreen, onNewProject, onReload]);
}
