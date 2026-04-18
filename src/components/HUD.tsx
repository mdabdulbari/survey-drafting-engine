import { usePointCloudStore } from "../store/pointCloudStore";
import type { ProjectMeta } from "../ipc/types";

interface Props {
  project: ProjectMeta;
}

/** Top-left heads-up display showing the active project and point cloud status. */
export function HUD({ project }: Props) {
  const nodes = usePointCloudStore((s) => s.nodes);
  const nodeCount = nodes ? Object.keys(nodes).length : null;

  return (
    <div className="absolute top-2 left-2 text-white text-xs bg-black/40 px-2 py-1 rounded space-y-0.5">
      <div>{project.name} — COPC ready</div>
      {nodeCount !== null && <div>{nodeCount} hierarchy nodes</div>}
    </div>
  );
}
