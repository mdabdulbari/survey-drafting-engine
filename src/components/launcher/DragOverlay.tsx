interface Props {
  show: boolean;
}

export function DragOverlay({ show }: Props) {
  if (!show) return null;
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm pointer-events-none"
    >
      <div className="px-10 py-8 rounded-2xl border-2 border-dashed border-blue-400/60 bg-blue-500/10 text-center">
        <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-blue-200" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0-4-4m4 4 4-4" />
            <path d="M5 21h14" />
          </svg>
        </div>
        <div className="text-white text-base font-semibold">Drop to create project</div>
        <div className="text-slate-300 text-sm mt-1">
          Release a <span className="font-mono text-slate-100">.laz</span> file anywhere on the window
        </div>
      </div>
    </div>
  );
}
