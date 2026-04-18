import { useConversionEvents, type ConversionState } from "../hooks/useConversionEvents";
import { LogPanel } from "./ui/LogPanel";
import { PhaseBar } from "./ui/PhaseBar";

interface Props {
  projectId: string;
  onDone: () => void;
}

// ── Derived display helpers ───────────────────────────────────────────────────

function heading({ status, phases }: ConversionState): string {
  if (status === "error") return "Conversion failed";
  if (phases.activePhase === 1) return `Reading… ${phases.phase1Pct.toFixed(0)}%`;
  if (phases.activePhase === 2) return `Writing… ${phases.phase2Pct.toFixed(0)}%`;
  return "Starting…";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConversionProgress({ projectId, onDone }: Props) {
  const state = useConversionEvents(projectId, onDone);

  if (state.status === "done") {
    return (
      <div className="px-6 py-4 bg-green-800 text-white rounded-lg font-medium">
        Conversion complete
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900 text-white rounded-lg w-96 flex flex-col gap-3">
      <div className="font-semibold">{heading(state)}</div>

      <div className="flex flex-col gap-2">
        <PhaseBar
          label="Reading"
          percent={state.phases.phase1Pct}
          active={state.phases.activePhase === 1}
          accent="blue"
        />
        <PhaseBar
          label="Writing"
          percent={state.phases.phase2Pct}
          active={state.phases.activePhase === 2}
          accent="emerald"
        />
      </div>

      <LogPanel messages={state.messages} emptyText="Starting…" />
    </div>
  );
}
