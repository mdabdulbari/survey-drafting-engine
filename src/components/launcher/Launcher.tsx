import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { deleteProject, listProjects, revealInFolder } from "../../ipc";
import type { ProjectMeta } from "../../ipc/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { NewProjectCard } from "./NewProjectCard";
import { ProjectListSkeleton } from "./ProjectListSkeleton";
import { ProjectRow } from "./ProjectRow";
import { deriveStatus } from "./projectStatus";

type SortKey = "recent" | "name" | "status";

interface Props {
  onOpenProject: (project: ProjectMeta) => void;
  onProjectCreated: (projectId: string) => void;
}

const STATUS_RANK: Record<string, number> = {
  ready: 0,
  "needs-conversion": 1,
  converting: 2,
  broken: 3,
  missing: 4,
};

export function Launcher({ onOpenProject, onProjectCreated }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    project: ProjectMeta;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectMeta | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(String(err));
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Filter + sort
  const visible = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    let out = projects;
    if (q) {
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.laz_path.toLowerCase().includes(q),
      );
    }
    const sorted = [...out];
    if (sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "status") {
      sorted.sort((a, b) => {
        const ra = STATUS_RANK[deriveStatus(a).kind] ?? 99;
        const rb = STATUS_RANK[deriveStatus(b).kind] ?? 99;
        if (ra !== rb) return ra - rb;
        return b.created_at.localeCompare(a.created_at);
      });
    } else {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return sorted;
  }, [projects, query, sort]);

  // Keep selection in-bounds when filter/sort changes.
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some((p) => p.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (inField) return;

      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedIndex = visible.findIndex((p) => p.id === selectedId);
  const selected = selectedIndex >= 0 ? visible[selectedIndex] : null;

  function moveSelection(delta: number) {
    if (visible.length === 0) return;
    const next = Math.max(
      0,
      Math.min(visible.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + delta),
    );
    const id = visible[next].id;
    setSelectedId(id);
    rowRefs.current.get(id)?.focus();
  }

  function handleListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      if (visible[0]) {
        setSelectedId(visible[0].id);
        rowRefs.current.get(visible[0].id)?.focus();
      }
    } else if (e.key === "End") {
      e.preventDefault();
      const last = visible[visible.length - 1];
      if (last) {
        setSelectedId(last.id);
        rowRefs.current.get(last.id)?.focus();
      }
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      onOpenProject(selected);
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      setPendingDelete(selected);
    }
  }

  function openContextMenu(project: ProjectMeta, e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    setSelectedId(project.id);
    setContextMenu({ x: e.clientX, y: e.clientY, project });
  }

  async function confirmDelete(project: ProjectMeta, alsoCopc: boolean) {
    setPendingDelete(null);
    try {
      await deleteProject(project.id, alsoCopc);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const menuItems = (p: ProjectMeta): MenuItem[] => {
    const status = deriveStatus(p);
    const canOpen = status.kind !== "missing";
    return [
      { label: "Open", onClick: () => onOpenProject(p), disabled: !canOpen },
      {
        label: "Reveal source in folder",
        onClick: () => revealInFolder(p.laz_path).catch(console.error),
        disabled: !p.laz_exists,
      },
      {
        label: "Reveal COPC in folder",
        onClick: () => revealInFolder(p.copc_path).catch(console.error),
        disabled: !p.copc_exists,
      },
      {
        label: "Delete project…",
        onClick: () => setPendingDelete(p),
        danger: true,
        separatorBefore: true,
      },
    ];
  };

  return (
    <div className="absolute inset-0 bg-slate-950 text-slate-100 flex">
      {/* Left rail */}
      <aside className="w-[360px] flex-shrink-0 border-r border-white/5 p-8 flex flex-col gap-8 bg-gradient-to-b from-slate-900 to-slate-950">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 18l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9" cy="12" r="1.2" fill="currentColor" />
                <circle cx="13" cy="16" r="1.2" fill="currentColor" />
              </svg>
            </div>
            <div className="text-white font-semibold tracking-tight">
              Survey Drafting Engine
            </div>
          </div>
          <div className="mt-1 ml-[42px] text-[11px] text-slate-500">v0.1.0</div>
        </div>

        <div>
          <h2 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3">
            Start
          </h2>
          <NewProjectCard onProjectCreated={onProjectCreated} />
        </div>

        <div className="mt-auto text-[11px] text-slate-500 leading-relaxed">
          <p>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              ↑ ↓
            </kbd>{" "}
            navigate ·{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              Enter
            </kbd>{" "}
            open ·{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              Del
            </kbd>{" "}
            delete
          </p>
          <p className="mt-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              Ctrl K
            </kbd>{" "}
            search
          </p>
        </div>
      </aside>

      {/* Right pane */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-10 pt-10 pb-6 flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Projects
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {projects === null
                ? "Loading…"
                : projects.length === 0
                  ? "No projects yet."
                  : `${projects.length} project${projects.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SearchBox ref={searchRef} value={query} onChange={setQuery} />
            <SortSelect value={sort} onChange={setSort} />
          </div>
        </header>

        <div
          className="flex-1 px-10 pb-10 overflow-y-auto"
          role="listbox"
          aria-label="Projects"
          tabIndex={visible.length > 0 ? -1 : 0}
          onKeyDown={handleListKey}
        >
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200 flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={refresh}
                className="ml-4 px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-100 text-xs font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {projects === null ? (
            <ProjectListSkeleton />
          ) : projects.length === 0 ? (
            <EmptyState />
          ) : visible.length === 0 ? (
            <NoMatchesState query={query} onClear={() => setQuery("")} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {visible.map((p) => (
                <ProjectRow
                  key={p.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(p.id, el);
                    else rowRefs.current.delete(p.id);
                  }}
                  project={p}
                  selected={p.id === selectedId}
                  onSelect={() => setSelectedId(p.id)}
                  onOpen={() => onOpenProject(p)}
                  onReveal={() =>
                    revealInFolder(p.laz_exists ? p.laz_path : p.copc_path).catch(
                      console.error,
                    )
                  }
                  onDelete={() => setPendingDelete(p)}
                  onContextMenu={(e) => openContextMenu(p, e)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems(contextMenu.project)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          message="The project will be removed from your library. The original LAZ file is never touched."
          checkboxLabel={
            pendingDelete.copc_exists
              ? "Also delete the COPC artifact on disk"
              : undefined
          }
          confirmLabel="Delete"
          destructive
          onConfirm={(alsoCopc) => confirmDelete(pendingDelete, alsoCopc)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

// ── Search & sort controls ────────────────────────────────────────────────────

const SearchBox = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void }
>(function SearchBox({ value, onChange }, ref) {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 16 16"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m13 13-2.5-2.5" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="search"
        placeholder="Search projects…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-64 pl-8 pr-3 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/60 focus:bg-white/[0.07]"
      />
    </div>
  );
});

function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="text-sm bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/60 cursor-pointer"
      aria-label="Sort"
    >
      <option value="recent">Recent</option>
      <option value="name">Name</option>
      <option value="status">Status</option>
    </select>
  );
}

// ── Empty / no-match states ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="mt-12 flex flex-col items-center text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center mb-5">
        <svg viewBox="0 0 24 24" className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" strokeLinejoin="round" />
          <path d="M4 7l8 4 8-4M12 11v10" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="text-base font-medium text-white">No projects yet</h3>
      <p className="text-sm text-slate-400 mt-1.5 max-w-sm leading-relaxed">
        Drop a <span className="font-mono text-slate-300">.laz</span> file onto
        the panel on the left, or click <span className="text-slate-200">New project</span> to
        get started.
      </p>
    </div>
  );
}

function NoMatchesState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <div className="mt-12 flex flex-col items-center text-center px-6">
      <h3 className="text-base font-medium text-white">No matches</h3>
      <p className="text-sm text-slate-400 mt-1.5">
        Nothing matches “<span className="text-slate-200">{query}</span>”.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 px-3 py-1.5 text-sm rounded-md bg-white/5 hover:bg-white/10 text-slate-200"
      >
        Clear search
      </button>
    </div>
  );
}
