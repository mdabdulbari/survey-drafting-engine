import { useEffect, useRef, useState } from "react";
import { listProjects } from "../../ipc";
import type { ProjectMeta } from "../../ipc/types";
import { AboutDialog } from "./AboutDialog";

interface Props {
  onNewProject: () => void;
  onOpenProject: (p: ProjectMeta) => void;
  onToggleFullscreen: () => void;
  onQuit: () => void;
}

export function AppMenu({ onNewProject, onOpenProject, onToggleFullscreen, onQuit }: Props) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load recent when menu opens.
  useEffect(() => {
    if (!open) return;
    listProjects()
      .then((all) => setRecent(all.slice(0, 5)))
      .catch((err) => console.warn("listProjects (menu):", err));
  }, [open]);

  // Outside-click + Escape dismissal.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRecentOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setRecentOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setRecentOpen(false);
  }

  return (
    <>
      <div ref={ref} className="relative no-drag">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[
            "px-2 h-7 inline-flex items-center gap-1 rounded text-[12px] font-medium",
            "transition-colors",
            open ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
          ].join(" ")}
        >
          File
          <svg viewBox="0 0 8 8" className="w-2 h-2 opacity-70" fill="currentColor">
            <path d="M0 2l4 4 4-4z" />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1 min-w-[240px] py-1 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl z-50"
          >
            <MenuItem
              label="New project"
              shortcut="Ctrl N"
              onClick={() => {
                close();
                onNewProject();
              }}
            />

            <div
              className="relative"
              onMouseEnter={() => setRecentOpen(true)}
              onMouseLeave={() => setRecentOpen(false)}
            >
              <MenuItem
                label="Open recent"
                trailing={
                  <svg viewBox="0 0 8 8" className="w-2 h-2 text-slate-500" fill="currentColor">
                    <path d="M2 0l4 4-4 4z" />
                  </svg>
                }
                onClick={() => setRecentOpen((v) => !v)}
              />
              {recentOpen && (
                <div className="absolute left-full top-0 ml-1 min-w-[260px] py-1 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl">
                  {recent.length === 0 ? (
                    <div className="px-3 py-1.5 text-[11px] text-slate-500">No recent projects</div>
                  ) : (
                    recent.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          close();
                          onOpenProject(p);
                        }}
                        className="block w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 truncate"
                        title={p.laz_path}
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="my-1 border-t border-white/10" />

            <MenuItem
              label="Toggle full screen"
              shortcut="F11"
              onClick={() => {
                close();
                onToggleFullscreen();
              }}
            />
            <MenuItem
              label="Reload"
              shortcut="Ctrl R"
              onClick={() => {
                close();
                window.location.reload();
              }}
            />
            <MenuItem
              label="About"
              onClick={() => {
                close();
                setAboutOpen(true);
              }}
            />

            <div className="my-1 border-t border-white/10" />

            <MenuItem
              label="Quit"
              shortcut="Alt F4"
              danger
              onClick={() => {
                close();
                onQuit();
              }}
            />
          </div>
        )}
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </>
  );
}

interface ItemProps {
  label: string;
  shortcut?: string;
  trailing?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

function MenuItem({ label, shortcut, trailing, danger, onClick }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "w-full flex items-center justify-between gap-4 px-3 py-1.5 text-sm transition-colors",
        danger ? "text-red-300 hover:bg-red-500/15" : "text-slate-200 hover:bg-white/5",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2">
        {shortcut && (
          <span className="text-[10px] text-slate-500 tabular-nums">{shortcut}</span>
        )}
        {trailing}
      </span>
    </button>
  );
}
