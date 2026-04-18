/**
 * Typed wrappers around all Tauri `invoke` calls.
 *
 * Rules:
 *  - One function per Rust command.
 *  - No business logic — just invoke and return.
 *  - Fire-and-forget commands (startConversion) return `Promise<void>`; their
 *    results arrive via event subscriptions in `events.ts`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ProjectMeta } from "./types";

export function createProject(name: string, lazPath: string): Promise<string> {
  return invoke<string>("create_project", { name, lazPath });
}

export function openProject(projectId: string): Promise<ProjectMeta> {
  return invoke<ProjectMeta>("open_project", { projectId });
}

export function listProjects(): Promise<ProjectMeta[]> {
  return invoke<ProjectMeta[]>("list_projects");
}

/**
 * Kick off COPC conversion for a project.
 *
 * Fire-and-forget — progress and completion arrive via the events in
 * `events.ts`.  The returned promise resolves when the Rust command returns
 * (not when conversion finishes).
 */
export function startConversion(projectId: string): Promise<void> {
  return invoke<void>("convert_to_copc", { projectId });
}

/**
 * Read a contiguous byte range from the memory-mapped COPC file.
 *
 * Returns a raw `ArrayBuffer` — no JSON encoding, no base64.
 * Target round-trip: < 10 ms for 1 MB.
 */
export function readCopcRange(
  projectId: string,
  offset: number,
  len: number,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_copc_range", { projectId, offset, len });
}
