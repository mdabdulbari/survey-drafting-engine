import type { ProjectMeta } from "../../ipc/types";

export type ProjectStatus =
  | { kind: "ready"; label: "Ready" }
  | { kind: "needs-conversion"; label: "Needs conversion" }
  | { kind: "converting"; label: "Converting…" }
  | { kind: "missing"; label: "Source missing" }
  | { kind: "broken"; label: "COPC missing" };

export function deriveStatus(p: ProjectMeta): ProjectStatus {
  if (!p.laz_exists && !p.copc_exists) return { kind: "missing", label: "Source missing" };
  if (p.copc_ready && p.copc_exists) return { kind: "ready", label: "Ready" };
  if (p.copc_ready && !p.copc_exists) return { kind: "broken", label: "COPC missing" };
  return { kind: "needs-conversion", label: "Needs conversion" };
}

const STATUS_DOT: Record<ProjectStatus["kind"], string> = {
  ready: "bg-emerald-400",
  "needs-conversion": "bg-amber-400",
  converting: "bg-sky-400",
  missing: "bg-red-400",
  broken: "bg-red-400",
};

const STATUS_TEXT: Record<ProjectStatus["kind"], string> = {
  ready: "text-emerald-300",
  "needs-conversion": "text-amber-300",
  converting: "text-sky-300",
  missing: "text-red-300",
  broken: "text-red-300",
};

export function statusDotClass(s: ProjectStatus): string {
  return STATUS_DOT[s.kind];
}

export function statusTextClass(s: ProjectStatus): string {
  return STATUS_TEXT[s.kind];
}
