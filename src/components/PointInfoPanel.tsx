import { useEffect, useState } from "react";
import { usePointCloudStore } from "../store/pointCloudStore";

const AXES = ["X", "Y", "Z"] as const;
const COPIED_FEEDBACK_MS = 1500;

/** Millimetre precision; survey CRS units are metres. */
const formatCoord = (v: number) => v.toFixed(3);

/** Bottom-right readout of the picked point's survey coordinates. */
export function PointInfoPanel() {
  const picked = usePointCloudStore((s) => s.pickedPoint);
  const [copied, setCopied] = useState(false);

  // Reset feedback on a new pick; clear the pending timer on unmount.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => setCopied(false), [picked]);

  if (!picked) {
    return (
      <div className="absolute bottom-4 right-4 select-none pointer-events-none px-3 py-2 rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/10 text-white/45 text-[11px]">
        Click a point to see its coordinates
      </div>
    );
  }

  const values = picked.survey.map(formatCoord);

  const copy = () => {
    navigator.clipboard
      .writeText(values.join(", "))
      .then(() => setCopied(true))
      .catch((err) => console.error("copy coordinates failed", err));
  };

  return (
    <div className="absolute bottom-4 right-4 w-64 px-4 py-3 rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.45)] text-white">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-medium">
          Point
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-[11px] text-white/60 hover:text-white transition-colors"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 font-mono text-[13px] tabular-nums">
        {AXES.map((axis, i) => (
          <div key={axis} className="contents">
            <dt className="text-white/45">{axis}</dt>
            <dd className="text-right">{values[i]}</dd>
            <dd className="text-white/35">m</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
