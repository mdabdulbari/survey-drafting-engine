import { useEffect, useState } from "react";
import { listProjects } from "../ipc";
import { Button } from "./ui/Button";
import type { ProjectMeta } from "../ipc/types";

interface Props {
  onOpen: (project: ProjectMeta) => void;
  onNew: () => void;
}

export function ProjectList({ onOpen, onNew }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4 w-80">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-lg">Projects</h2>
        <Button onClick={onNew} className="text-sm px-3 py-1.5">
          + New
        </Button>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!loading && projects.length === 0 && (
        <p className="text-gray-400 text-sm">
          No projects yet. Open a LAZ file to get started.
        </p>
      )}

      <ul className="flex flex-col gap-2 overflow-y-auto max-h-[60vh]">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onOpen(p)}
              className="w-full text-left px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
            >
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
                <span>{p.copc_ready ? "Ready" : "Not converted"}</span>
                <span>·</span>
                <span>{new Date(p.created_at).toLocaleDateString()}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
