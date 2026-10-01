import { forwardRef, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectMeta } from "../../ipc/types";
import {
  deriveStatus,
  statusDotClass,
  statusTextClass,
  type ProjectStatus,
} from "./projectStatus";
import { absoluteTime, formatBytes, parentDir, relativeTime } from "./format";
import { thumbPoints } from "./thumbnail";

interface Props {
  project: ProjectMeta;
  selected: boolean;
  isConverting?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
}

const STRIPE_COLOR: Record<ProjectStatus["kind"], string> = {
  ready:              "rgba(52,211,153,0.65)",
  "needs-conversion": "rgba(251,191,36,0.75)",
  converting:         "rgba(56,189,248,0.75)",
  missing:            "rgba(248,113,113,0.75)",
  broken:             "rgba(248,113,113,0.75)",
};

function folderLabel(path: string): string {
  const dir = parentDir(path);
  if (dir === path) return "";
  const i = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
  return i === -1 ? dir : dir.slice(i + 1);
}

export const ProjectCard = forwardRef<HTMLDivElement, Props>(function ProjectCard(
  { project, selected, isConverting = false, onSelect, onOpen, onReveal, onDelete, onContextMenu },
  ref,
) {
  const effectiveStatus: ProjectStatus = isConverting
    ? { kind: "converting", label: "Converting…" }
    : deriveStatus(project);

  const points = useMemo(() => thumbPoints(project.id), [project.id]);
  const folder = folderLabel(project.laz_path);
  const stripeColor = STRIPE_COLOR[effectiveStatus.kind];

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
      style={{ borderLeftWidth: 3, borderLeftColor: stripeColor }}
      className={[
        "group relative flex flex-col rounded-xl overflow-hidden cursor-pointer",
        "bg-slate-900/40 border border-white/[0.07] transition-all duration-150",
        "shadow-[0_2px_8px_-4px_rgba(0,0,0,0.5)]",
        "hover:-translate-y-px hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.55)] hover:border-white/15",
        selected ? "ring-2 ring-blue-500/40 border-blue-500/40" : "",
      ].join(" ")}
    >
      {/* Thumbnail */}
      <div
        className="relative h-36 w-full overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 45% 42%, #0e1d33 0%, #070d1a 100%)' }}
      >
        {/* Procedural point-cloud minimap */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
          aria-hidden
        >
          {points.map((pt, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
              key={i}
              cx={pt.x * 100}
              cy={pt.y * 100}
              r={pt.r}
              fill="white"
              fillOpacity={[0.50, 0.18, 0.60, 0.22, 0.42, 0.13, 0.55, 0.28, 0.45, 0.15][i % 10]}
            />
          ))}
        </svg>

        {/* Permanent bottom vignette into meta strip */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" aria-hidden />

        {/* Converting shimmer */}
        {isConverting && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-500/10 to-transparent animate-pulse" />
        )}

        {/* Status pill */}
        <div className="absolute top-2 right-2 z-10">
          <span
            className={[
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full",
              "text-[10px] font-medium",
              "bg-black/60 backdrop-blur-sm border border-white/10",
              statusTextClass(effectiveStatus),
            ].join(" ")}
            title={
              effectiveStatus.kind === "missing"
                ? `Source LAZ not found at ${project.laz_path}`
                : effectiveStatus.kind === "broken"
                  ? `COPC artifact missing at ${project.copc_path}`
                  : effectiveStatus.label
            }
          >
            <span
              className={[
                "w-1.5 h-1.5 rounded-full",
                isConverting ? "bg-sky-400 animate-pulse" : statusDotClass(effectiveStatus),
              ].join(" ")}
            />
            {effectiveStatus.label}
          </span>
        </div>

        {/* Hover action bar */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
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
      <div className="px-3 py-2.5 border-t border-white/[0.07] bg-slate-950/50">
        <div className="text-[13px] font-medium text-white truncate" title={project.name}>
          {project.name}
        </div>
        {folder && (
          <div
            className="mt-0.5 text-[10.5px] text-slate-500 truncate"
            title={project.laz_path}
          >
            {folder}
          </div>
        )}
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
