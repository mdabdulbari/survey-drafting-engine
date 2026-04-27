import { forwardRef, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectMeta } from "../../ipc/types";
import {
  deriveStatus,
  statusDotClass,
  statusTextClass,
} from "./projectStatus";
import { absoluteTime, formatBytes, relativeTime } from "./format";
import { thumbStyle } from "./thumbnail";

interface Props {
  project: ProjectMeta;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
}

export const ProjectCard = forwardRef<HTMLDivElement, Props>(function ProjectCard(
  { project, selected, onSelect, onOpen, onReveal, onDelete, onContextMenu },
  ref,
) {
  const status = deriveStatus(project);
  const thumb = thumbStyle(project.id);

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
        "group relative flex flex-col rounded-xl overflow-hidden cursor-pointer",
        "bg-slate-900/40 border transition-all",
        selected
          ? "border-blue-500/60 ring-2 ring-blue-500/40"
          : "border-white/5 hover:border-white/15",
      ].join(" ")}
    >
      {/* Thumbnail */}
      <div
        className="relative h-36 w-full"
        style={{ background: thumb.background }}
      >
        {/* Centered point-cloud glyph */}
        <svg
          viewBox="0 0 64 64"
          className="absolute inset-0 m-auto w-16 h-16 text-white/35"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="14" cy="20" r="2" />
          <circle cx="22" cy="14" r="2" />
          <circle cx="32" cy="18" r="2.4" />
          <circle cx="42" cy="14" r="2" />
          <circle cx="50" cy="22" r="2" />
          <circle cx="18" cy="30" r="2.2" />
          <circle cx="28" cy="28" r="2.6" />
          <circle cx="38" cy="30" r="2.2" />
          <circle cx="48" cy="34" r="2" />
          <circle cx="14" cy="40" r="2" />
          <circle cx="24" cy="42" r="2.4" />
          <circle cx="34" cy="40" r="2.2" />
          <circle cx="44" cy="44" r="2.4" />
          <circle cx="20" cy="50" r="2" />
          <circle cx="32" cy="52" r="2.2" />
          <circle cx="46" cy="52" r="2" />
        </svg>

        {/* Status pill */}
        <div className="absolute top-2 right-2">
          <span
            className={[
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full",
              "text-[10px] font-medium",
              "bg-black/55 backdrop-blur-sm border border-white/10",
              statusTextClass(status),
            ].join(" ")}
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

        {/* Hover action bar */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <CardIconButton title="Open" onClick={stop(onOpen)} variant="primary">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </CardIconButton>
          <CardIconButton title="Reveal in folder" onClick={stop(onReveal)}>
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6a1.5 1.5 0 0 1 1.06.44l.9.9a1.5 1.5 0 0 0 1.06.44H12.5A1.5 1.5 0 0 1 14 6.28V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
            </svg>
          </CardIconButton>
          <CardIconButton title="Delete" onClick={stop(onDelete)} variant="danger">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M5 4.5l.5 8a1 1 0 0 0 1 .95h3a1 1 0 0 0 1-.95l.5-8" strokeLinecap="round" />
            </svg>
          </CardIconButton>
        </div>
      </div>

      {/* Meta strip */}
      <div className="px-3 py-2.5 border-t border-white/5 bg-slate-950/40">
        <div className="text-[13px] font-medium text-white truncate" title={project.name}>
          {project.name}
        </div>
        <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-1.5">
          <span>{formatBytes(project.laz_size)}</span>
          <span className="text-slate-600">·</span>
          <span title={absoluteTime(project.created_at)}>
            {relativeTime(project.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
});

interface IconBtnProps {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  variant?: "default" | "primary" | "danger";
  children: React.ReactNode;
}

function CardIconButton({ title, onClick, variant = "default", children }: IconBtnProps) {
  const variants = {
    default: "bg-white/10 hover:bg-white/20 text-white",
    primary: "bg-blue-500/80 hover:bg-blue-500 text-white",
    danger: "bg-white/10 hover:bg-red-500/80 text-white",
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`p-1.5 rounded-md backdrop-blur-sm transition-colors ${variants[variant]}`}
    >
      {children}
    </button>
  );
}
