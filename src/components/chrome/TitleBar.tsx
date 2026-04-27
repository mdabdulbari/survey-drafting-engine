import type { AppPhase } from "../../types";
import type { ProjectMeta } from "../../ipc/types";
import { useWindowState } from "../../hooks/useWindowState";
import { AppMenu } from "./AppMenu";
import { Breadcrumb } from "./Breadcrumb";
import { WindowControls } from "./WindowControls";

interface Props {
  phase: AppPhase;
  project: ProjectMeta | null;
  onBackToLauncher: () => void;
  onNewProject: () => void;
  onOpenProject: (p: ProjectMeta) => void;
}

export function TitleBar({
  phase,
  project,
  onBackToLauncher,
  onNewProject,
  onOpenProject,
}: Props) {
  const win = useWindowState();

  return (
    <div
      className="relative h-9 flex items-stretch select-none border-b border-white/5 bg-gradient-to-b from-slate-950/95 to-slate-950/60 backdrop-blur-xl z-30"
      data-tauri-drag-region
    >
      {/* Left: brand mark + app menu */}
      <div className="flex items-center gap-1.5 pl-2.5 pr-1 no-drag">
        <div
          className="w-5 h-5 rounded-[5px] bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-[0_0_10px_-2px_rgba(56,189,248,0.7)]"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 18l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <AppMenu
          onNewProject={onNewProject}
          onOpenProject={onOpenProject}
          onToggleFullscreen={win.toggleFullscreen}
          onQuit={win.close}
        />
      </div>

      {/* Middle: drag region containing the breadcrumb */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 px-4"
        data-tauri-drag-region
      >
        <div className="no-drag flex items-center min-w-0">
          <Breadcrumb phase={phase} project={project} onBackToLauncher={onBackToLauncher} />
        </div>
      </div>

      {/* Right: window controls */}
      <WindowControls win={win} />
    </div>
  );
}
