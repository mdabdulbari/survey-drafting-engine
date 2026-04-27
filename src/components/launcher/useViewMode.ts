import { useCallback, useEffect, useState } from "react";

export type ViewMode = "grid" | "list";

const KEY = "launcher.view";

function read(): ViewMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => read());

  useEffect(() => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const set = useCallback((m: ViewMode) => setMode(m), []);
  return [mode, set];
}
