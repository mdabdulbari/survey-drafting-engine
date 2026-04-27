import type { AppPhase } from "../../types";
import type { ProjectMeta } from "../../ipc/types";

interface Props {
  phase: AppPhase;
  project: ProjectMeta | null;
  onBackToLauncher: () => void;
}

export function Breadcrumb({ phase, project, onBackToLauncher }: Props) {
  if (phase === "launcher" || !project) {
    return (
      <span className="text-[12px] text-slate-400 tracking-tight font-medium select-none">
        Survey Drafting Engine
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[12px] min-w-0 max-w-[60vw]">
      <button
        type="button"
        onClick={onBackToLauncher}
        className="no-drag text-slate-400 hover:text-white hover:underline decoration-blue-400/60 underline-offset-4 transition-colors"
      >
        Projects
      </button>
      <span className="text-slate-600">/</span>
      <span
        className="text-slate-100 font-medium truncate tabular-nums"
        title={project.name}
      >
        {project.name}
      </span>
      {phase === "converting" && (
        <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] text-sky-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-400" />
          </span>
          Converting…
        </span>
      )}
    </div>
  );
}
