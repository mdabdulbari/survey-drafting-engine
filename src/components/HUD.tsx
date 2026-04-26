import { usePointCloudStore } from "../store/pointCloudStore";
import type { ProjectMeta } from "../ipc/types";

interface Props {
  project: ProjectMeta;
  onBack?: () => void;
}

/** Top-left heads-up display showing the active project and point cloud status. */
export function HUD({ project, onBack }: Props) {
  const nodes = usePointCloudStore((s) => s.nodes);
  const nodeCount = nodes ? Object.keys(nodes).length : null;

  return (
    <div className="absolute top-4 left-4 select-none">
      <div className="px-4 py-3 rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.45)] text-white max-w-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-medium">
              Project
            </span>
          </div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              title="Back to projects"
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4 6 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Projects
            </button>
          )}
        </div>
        <div
          className="mt-1.5 text-[15px] font-semibold tracking-tight truncate"
          title={project.name}
        >
          {project.name}
        </div>
        <div className="mt-2 flex items-center gap-2.5 text-[11px] text-white/55 font-mono">
          <span className="text-emerald-300/80">COPC ready</span>
          {nodeCount !== null && (
            <>
              <span className="text-white/20">·</span>
              <span>{nodeCount.toLocaleString()} nodes</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
