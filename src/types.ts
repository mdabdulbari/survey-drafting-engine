/**
 * Application-level types — UI state machines and other frontend-only shapes.
 *
 * IPC payload types (ProjectMeta, ConversionProgressPayload, …) live in
 * `src/ipc/types.ts` because they mirror Rust structs.
 */

export type AppPhase =
  | "projectList"  // initial screen — browse existing projects
  | "idle"         // picking a new LAZ file
  | "converting"   // PDAL subprocess running
  | "ready";       // project open, point cloud streaming
