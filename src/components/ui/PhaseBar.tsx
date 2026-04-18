interface PhaseBarProps {
  label: string;
  percent: number;
  /** Whether this phase is currently being processed. */
  active: boolean;
  accent: "blue" | "emerald";
}

export function PhaseBar({ label, percent, active, accent }: PhaseBarProps) {
  const barColor = accent === "blue" ? "bg-blue-500" : "bg-emerald-500";
  const labelColor =
    percent > 0
      ? accent === "blue"
        ? "text-blue-400"
        : "text-emerald-400"
      : "text-gray-600";

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-16 text-xs ${labelColor}`}>{label}</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300 ${active ? "animate-pulse" : ""}`}
          style={{ width: `${percent.toFixed(1)}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs text-gray-500">{percent.toFixed(0)}%</span>
    </div>
  );
}
