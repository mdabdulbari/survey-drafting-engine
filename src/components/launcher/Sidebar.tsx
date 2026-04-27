import { NewProjectButton } from "./NewProjectButton";
import type { FilterKey, StatusCounts } from "./projectStatus";

interface Props {
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  counts: StatusCounts;
  onProjectCreated: (projectId: string) => void;
}

interface FilterDef {
  key: FilterKey;
  label: string;
  count: number;
  dot: string;
}

export function Sidebar({ filter, onFilterChange, counts, onProjectCreated }: Props) {
  const items: FilterDef[] = [
    { key: "all",              label: "All projects",     count: counts.all,             dot: "bg-slate-400" },
    { key: "ready",            label: "Ready",            count: counts.ready,           dot: "bg-emerald-400" },
    { key: "needs-conversion", label: "Needs conversion", count: counts.needsConversion, dot: "bg-amber-400" },
    { key: "issues",           label: "Issues",           count: counts.issues,          dot: "bg-red-400" },
  ];

  return (
    <aside className="w-[280px] flex-shrink-0 border-r border-white/5 flex flex-col bg-gradient-to-b from-slate-900 to-slate-950">
      {/* Brand */}
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-[0_2px_8px_-2px_rgba(56,189,248,0.5)]">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 18l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="12" r="1.2" fill="currentColor" />
              <circle cx="13" cy="16" r="1.2" fill="currentColor" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold tracking-tight text-sm truncate">
              Survey Drafting Engine
            </div>
            <div className="text-[10px] text-slate-500">v0.1.0</div>
          </div>
        </div>
      </div>

      {/* New project */}
      <div className="px-4 pb-5 border-b border-white/5">
        <NewProjectButton onProjectCreated={onProjectCreated} />
      </div>

      {/* Filters */}
      <nav className="px-3 py-4">
        <h2 className="px-3 text-[10px] uppercase tracking-[0.14em] text-slate-500 font-semibold mb-2">
          Library
        </h2>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = filter === item.key;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onFilterChange(item.key)}
                  className={[
                    "w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm",
                    "transition-colors relative",
                    active
                      ? "bg-blue-500/10 text-white"
                      : "text-slate-300 hover:bg-white/[0.04] hover:text-white",
                  ].join(" ")}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r bg-blue-400" />
                  )}
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.dot}`} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className={`text-[11px] tabular-nums ${active ? "text-slate-300" : "text-slate-500"}`}>
                    {item.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="mt-auto px-6 pb-6 text-[11px] text-slate-500 leading-relaxed">
        <p>
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">↑ ↓</kbd>{" "}
          navigate ·{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">⏎</kbd>{" "}
          open
        </p>
        <p className="mt-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">Ctrl K</kbd>{" "}
          search ·{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">Del</kbd>{" "}
          delete
        </p>
      </div>
    </aside>
  );
}
