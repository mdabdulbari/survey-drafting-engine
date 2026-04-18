import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProject, startConversion } from "../ipc";
import { Button } from "./ui/Button";

interface Props {
  onProjectCreated: (projectId: string) => void;
}

export function FileOpen({ onProjectCreated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpen() {
    setError(null);

    const filePath = await open({
      multiple: false,
      filters: [{ name: "LAZ Files", extensions: ["laz"] }],
    });
    if (!filePath) return;

    const name = (filePath as string).split(/[\\/]/).pop() ?? "Untitled";

    setLoading(true);
    try {
      const projectId = await createProject(name, filePath as string);
      onProjectCreated(projectId);
      // Conversion runs in the background; progress arrives via events.
      startConversion(projectId).catch((err) =>
        console.error("convert_to_copc error:", err)
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button onClick={handleOpen} loading={loading} loadingLabel="Opening...">
        Open LAZ File
      </Button>
      {error && (
        <p className="text-red-400 text-sm max-w-xs text-center">{error}</p>
      )}
    </div>
  );
}
