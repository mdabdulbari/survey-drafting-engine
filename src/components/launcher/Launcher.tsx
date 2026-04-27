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
import {
  createProject,
  deleteProject,
  listProjects,
  revealInFolder,
  startConversion,
} from "../../ipc";
import type { ProjectMeta } from "../../ipc/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { DragOverlay } from "./DragOverlay";
import { ProjectCard } from "./ProjectCard";
import { ProjectListSkeleton } from "./ProjectListSkeleton";
import { ProjectRow } from "./ProjectRow";
import { Sidebar } from "./Sidebar";
import { ViewToggle } from "./ViewToggle";
import {
  countByStatus,
  deriveStatus,
  matchesFilter,
  type FilterKey,
} from "./projectStatus";
import { useDragDrop } from "./useDragDrop";
import { useViewMode } from "./useViewMode";

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

const FILTER_TITLES: Record<FilterKey, string> = {
  all: "All projects",
  ready: "Ready",
  "needs-conversion": "Needs conversion",
  issues: "Issues",
};

/** Card-grid min-card width must match the `minmax(...)` value below.
 *  Used to compute how many columns the keyboard nav should step. */
const GRID_MIN_PX = 220;

export function Launcher({ onOpenProject, onProjectCreated }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [view, setView] = useViewMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    project: ProjectMeta;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectMeta | null>(null);
  const [cols, setCols] = useState(1);

  const searchRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement>(null);

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

  // ── Drag-drop (window-wide) ─────────────────────────────────────────────────
  const handleDrop = useCallback(
    async (paths: string[]) => {
      const lazFile = paths.find((p) => p.toLowerCase().endsWith(".laz"));
      if (!lazFile) {
        setError("Drop a .laz file to create a project.");
        return;
      }
      try {
        const name = lazFile.split(/[\\/]/).pop() ?? "Untitled";
        const projectId = await createProject(name, lazFile);
        onProjectCreated(projectId);
        startConversion(projectId).catch((err) =>
          console.error("convert_to_copc error:", err),
        );
      } catch (err) {
        setError(String(err));
      }
    },
    [onProjectCreated],
  );
  const { hover: dragHover } = useDragDrop({ onDrop: handleDrop });

  // ── Counts (for sidebar) — computed off the unfiltered list ────────────────
  const counts = useMemo(
    () => countByStatus(projects ?? []),
    [projects],
  );

  // ── Filter + search + sort ────────────────────────────────────────────────
  const visible = useMemo(() => {
    if (!projects) return [];
    let out = projects.filter((p) => matchesFilter(p, filter));
    const q = query.trim().toLowerCase();
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
  }, [projects, query, sort, filter]);

  // Keep selection in-bounds when filter/sort/search changes.
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some((p) => p.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  // ── Grid column count via ResizeObserver ───────────────────────────────────
  useEffect(() => {
    if (view !== "grid") return;
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      // Account for the gap (16px) between cards: cols where each card has at least GRID_MIN_PX.
      const next = Math.max(1, Math.floor((w + 16) / (GRID_MIN_PX + 16)));
      setCols(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, visible.length]);

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
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

  function focusIndex(idx: number) {
    if (visible.length === 0) return;
    const clamped = Math.max(0, Math.min(visible.length - 1, idx));
    const id = visible[clamped].id;
    setSelectedId(id);
    cardRefs.current.get(id)?.focus();
  }

  function handleListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (visible.length === 0) return;
    const stride = view === "grid" ? cols : 1;
    const here = selectedIndex < 0 ? 0 : selectedIndex;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(here + stride);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(here - stride);
    } else if (e.key === "ArrowRight" && view === "grid") {
      e.preventDefault();
      focusIndex(here + 1);
    } else if (e.key === "ArrowLeft" && view === "grid") {
      e.preventDefault();
      focusIndex(here - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusIndex(visible.length - 1);
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

  const headerSubtitle =
    projects === null
      ? "Loading…"
      : visible.length === 0 && projects.length > 0
        ? "No matches"
        : `${visible.length} of ${projects.length}`;

  const setRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };

  return (
    <div className="absolute inset-0 bg-slate-950 text-slate-100 flex">
      <Sidebar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        onProjectCreated={onProjectCreated}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-10 pt-10 pb-6 flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {FILTER_TITLES[filter]}
            </h1>
            <p className="text-sm text-slate-400 mt-1">{headerSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <SearchBox ref={searchRef} value={query} onChange={setQuery} />
            <SortSelect value={sort} onChange={setSort} />
            <ViewToggle value={view} onChange={setView} />
          </div>
        </header>

        <div
          className="flex-1 px-10 pb-10 overflow-y-auto"
          role={view === "grid" ? "grid" : "listbox"}
          aria-label="Projects"
          tabIndex={visible.length > 0 ? -1 : 0}
          onKeyDown={handleListKey}
        >
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200 flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  refresh();
                }}
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
            <NoMatchesState
              query={query}
              filter={filter}
              onClearSearch={() => setQuery("")}
              onClearFilter={() => setFilter("all")}
            />
          ) : view === "grid" ? (
            <div
              ref={gridRef}
              className="grid gap-4"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_PX}px, 1fr))`,
              }}
            >
              {visible.map((p) => (
                <ProjectCard
                  key={p.id}
                  ref={setRef(p.id)}
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
          ) : (
            <div className="flex flex-col gap-1.5">
              {visible.map((p) => (
                <ProjectRow
                  key={p.id}
                  ref={setRef(p.id)}
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

      <DragOverlay show={dragHover} />

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
        Click <span className="text-slate-200">New project</span> in the sidebar, or
        drop a <span className="font-mono text-slate-300">.laz</span> file
        anywhere on this window to get started.
      </p>
    </div>
  );
}

function NoMatchesState({
  query,
  filter,
  onClearSearch,
  onClearFilter,
}: {
  query: string;
  filter: FilterKey;
  onClearSearch: () => void;
  onClearFilter: () => void;
}) {
  const hasQuery = query.length > 0;
  const hasFilter = filter !== "all";
  return (
    <div className="mt-12 flex flex-col items-center text-center px-6">
      <h3 className="text-base font-medium text-white">No matches</h3>
      <p className="text-sm text-slate-400 mt-1.5">
        {hasQuery && (
          <>
            Nothing matches “<span className="text-slate-200">{query}</span>”
            {hasFilter && <> in {FILTER_TITLES[filter]}</>}.
          </>
        )}
        {!hasQuery && hasFilter && <>No projects in {FILTER_TITLES[filter]}.</>}
      </p>
      <div className="mt-3 flex gap-2">
        {hasQuery && (
          <button
            type="button"
            onClick={onClearSearch}
            className="px-3 py-1.5 text-sm rounded-md bg-white/5 hover:bg-white/10 text-slate-200"
          >
            Clear search
          </button>
        )}
        {hasFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="px-3 py-1.5 text-sm rounded-md bg-white/5 hover:bg-white/10 text-slate-200"
          >
            Show all projects
          </button>
        )}
      </div>
    </div>
  );
}
