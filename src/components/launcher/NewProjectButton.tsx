import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProject, startConversion } from "../../ipc";

interface Props {
  onProjectCreated: (projectId: string) => void;
}

export function NewProjectButton({ onProjectCreated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    const filePath = await open({
      multiple: false,
      filters: [{ name: "LAZ Files", extensions: ["laz"] }],
    });
    if (!filePath) return;

    setError(null);
    setBusy(true);
    try {
      const path = filePath as string;
      const name = path.split(/[\\/]/).pop() ?? "Untitled";
      const projectId = await createProject(name, path);
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

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={[
          "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg",
          "bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
          "text-white text-sm font-medium shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset,0_2px_8px_-2px_rgba(0,0,0,0.4)]",
          "transition-colors",
        ].join(" ")}
      >
        <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3v10M3 8h10" strokeLinecap="round" />
        </svg>
        {busy ? "Creating…" : "New project"}
      </button>
      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-[11px] text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
