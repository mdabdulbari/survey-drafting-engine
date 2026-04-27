import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const [version, setVersion] = useState<string>("");
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.0.0"));
    okRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-[420px] bg-slate-900 border border-white/10 rounded-xl shadow-2xl p-6"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-[0_0_18px_-4px_rgba(56,189,248,0.6)]">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 18l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="12" r="1.2" fill="currentColor" />
              <circle cx="13" cy="16" r="1.2" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Survey Drafting Engine</h3>
            <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
              Version {version || "—"}
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-300 leading-relaxed">
          A high-performance point-cloud authoring tool. Built with Tauri, React, and Three.js.
        </p>

        <div className="mt-6 flex items-center justify-end">
          <button
            ref={okRef}
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
