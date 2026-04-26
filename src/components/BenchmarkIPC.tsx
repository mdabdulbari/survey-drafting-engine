/**
 * Temporary component — verifies Milestone 5 acceptance criteria.
 * Remove once binary IPC round-trip is confirmed < 10ms for 1MB.
 */

import { useState } from "react";
import { readCopcRange } from "../ipc";

interface Props {
  projectId: string;
}

export function BenchmarkIPC({ projectId }: Props) {
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const t0 = performance.now();
      const buf = await readCopcRange(projectId, 0, 1_048_576);
      const ms = (performance.now() - t0).toFixed(1);
      setResult(`1MB → ArrayBuffer(${buf.byteLength}) in ${ms}ms`);
    } catch (err) {
      setResult(`Error: ${String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-2 max-w-xs">
      <button
        onClick={run}
        disabled={running}
        className="self-start px-4 py-2 rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/10 hover:bg-white/[0.08] hover:border-white/20 active:bg-white/[0.06] transition-colors text-white/90 text-xs font-medium tracking-wide shadow-[0_8px_32px_rgba(0,0,0,0.45)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? "Running…" : "Benchmark IPC (1 MB)"}
      </button>
      {result && (
        <span className="px-3 py-2 rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/10 text-white/75 text-[11px] font-mono shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
          {result}
        </span>
      )}
    </div>
  );
}
