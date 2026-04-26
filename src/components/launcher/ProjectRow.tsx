import { forwardRef, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectMeta } from "../../ipc/types";
import {
  deriveStatus,
  statusDotClass,
  statusTextClass,
} from "./projectStatus";
import {
  absoluteTime,
  formatBytes,
  parentDir,
  relativeTime,
  truncateMiddle,
} from "./format";

interface Props {
  project: ProjectMeta;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
}

export const ProjectRow = forwardRef<HTMLDivElement, Props>(function ProjectRow(
  { project, selected, onSelect, onOpen, onReveal, onDelete, onContextMenu },
  ref,
) {
  const status = deriveStatus(project);
  const dir = parentDir(project.laz_path);

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen();
    }
  }

  function stop<T extends HTMLElement>(handler: () => void) {
    return (e: MouseEvent<T>) => {
      e.stopPropagation();
      handler();
    };
  }

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={handleKey}
      onContextMenu={onContextMenu}
      className={[
        "group relative flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer",
        "border transition-colors",
        selected
          ? "bg-blue-500/10 border-blue-500/40"
          : "bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10",
      ].join(" ")}
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-md bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 flex items-center justify-center text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
        LAZ
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium truncate">{project.name}</span>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] ${statusTextClass(status)}`}
            title={
              status.kind === "missing"
                ? `Source LAZ not found at ${project.laz_path}`
                : status.kind === "broken"
                  ? `COPC artifact missing at ${project.copc_path}`
                  : status.label
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(status)}`} />
            {status.label}
          </span>
        </div>
        <div
          className="text-xs text-slate-400 truncate mt-0.5"
          title={project.laz_path}
        >
          {truncateMiddle(dir, 60)}
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5 text-[11px] text-slate-400 flex-shrink-0">
        <span title={absoluteTime(project.created_at)}>
          {relativeTime(project.created_at)}
        </span>
        <span>{formatBytes(project.laz_size)}</span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
        <IconButton title="Open" onClick={stop(onOpen)} variant="primary">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
        <IconButton title="Reveal in folder" onClick={stop(onReveal)}>
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6a1.5 1.5 0 0 1 1.06.44l.9.9a1.5 1.5 0 0 0 1.06.44H12.5A1.5 1.5 0 0 1 14 6.28V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
          </svg>
        </IconButton>
        <IconButton title="Delete" onClick={stop(onDelete)} variant="danger">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M5 4.5l.5 8a1 1 0 0 0 1 .95h3a1 1 0 0 0 1-.95l.5-8" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
});

interface IconButtonProps {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  variant?: "default" | "primary" | "danger";
  children: React.ReactNode;
}

function IconButton({
  title,
  onClick,
  variant = "default",
  children,
}: IconButtonProps) {
  const variants = {
    default: "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white",
    primary: "bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 hover:text-white",
    danger: "bg-white/5 hover:bg-red-500/20 text-slate-300 hover:text-red-200",
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${variants[variant]}`}
    >
      {children}
    </button>
  );
}
