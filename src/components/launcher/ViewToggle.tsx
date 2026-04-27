import type { ViewMode } from "./useViewMode";

interface Props {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="inline-flex p-0.5 rounded-md bg-white/5 border border-white/10"
    >
      <ToggleButton
        active={value === "grid"}
        onClick={() => onChange("grid")}
        title="Grid view"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      </ToggleButton>
      <ToggleButton
        active={value === "list"}
        onClick={() => onChange("list")}
        title="List view"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M3 4h10M3 8h10M3 12h10" />
        </svg>
      </ToggleButton>
    </div>
  );
}

interface BtnProps {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function ToggleButton({ active, onClick, title, children }: BtnProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={[
        "px-2 py-1 rounded transition-colors",
        active
          ? "bg-white/15 text-white"
          : "text-slate-400 hover:text-slate-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
