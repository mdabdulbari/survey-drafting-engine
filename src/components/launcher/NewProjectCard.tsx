import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createProject, startConversion } from "../../ipc";

interface Props {
  onProjectCreated: (projectId: string) => void;
  /** Disabled while another op is in flight (e.g., conversion already running). */
  disabled?: boolean;
}

export function NewProjectCard({ onProjectCreated, disabled = false }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);

  async function startFromPath(filePath: string) {
    if (!filePath.toLowerCase().endsWith(".laz")) {
      setError("Only .laz files are supported.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const name = filePath.split(/[\\/]/).pop() ?? "Untitled";
      const projectId = await createProject(name, filePath);
      onProjectCreated(projectId);
      startConversion(projectId).catch((err) =>
        console.error("convert_to_copc error:", err),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBrowse() {
    if (busy || disabled) return;
    const filePath = await open({
      multiple: false,
      filters: [{ name: "LAZ Files", extensions: ["laz"] }],
    });
    if (!filePath) return;
    await startFromPath(filePath as string);
  }

  // Tauri v2 file-drop subscription.
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
            const lazFile = payload.paths.find((p) =>
              p.toLowerCase().endsWith(".laz"),
            );
            if (lazFile) {
              startFromPath(lazFile);
            } else {
              setError("Drop a .laz file.");
            }
          }
        });
        if (cancelled) handle();
        else unlisten = handle;
      } catch (err) {
        // Drag-drop wiring is best-effort; the Browse button still works.
        console.warn("drag-drop listener failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interactive = !busy && !disabled;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleBrowse}
        disabled={!interactive}
        className={[
          "group w-full rounded-xl border-2 border-dashed transition-all",
          "px-6 py-8 flex flex-col items-center gap-3 text-center",
          hover
            ? "border-blue-400 bg-blue-500/10"
            : "border-white/15 hover:border-white/30 hover:bg-white/[0.03]",
          !interactive && "opacity-60 cursor-not-allowed",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className={[
            "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
            hover ? "bg-blue-500/20 text-blue-200" : "bg-white/5 text-slate-300 group-hover:text-white",
          ].join(" ")}
        >
          <svg
            viewBox="0 0 24 24"
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <div>
          <div className="text-white font-medium">
            {busy ? "Creating project…" : "New project"}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Drop a <span className="font-mono text-slate-300">.laz</span> file here, or click to browse
          </div>
        </div>
      </button>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
