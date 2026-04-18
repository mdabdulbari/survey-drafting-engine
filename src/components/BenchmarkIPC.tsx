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
    <div className="absolute bottom-2 left-2 flex flex-col gap-1">
      <button
        onClick={run}
        disabled={running}
        className="px-3 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50"
      >
        {running ? "Running..." : "Benchmark IPC (1MB)"}
      </button>
      {result && (
        <span className="text-white text-xs bg-black/60 px-2 py-1 rounded font-mono">
          {result}
        </span>
      )}
    </div>
  );
}
