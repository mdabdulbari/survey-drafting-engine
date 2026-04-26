export function ProjectListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading projects">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.02] border border-white/5"
          style={{ opacity: 1 - i * 0.15 }}
        >
          <div className="w-9 h-9 rounded-md bg-white/5 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/5 rounded bg-white/10 animate-pulse" />
            <div className="h-2.5 w-3/5 rounded bg-white/5 animate-pulse" />
          </div>
          <div className="w-12 h-3 rounded bg-white/5 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
