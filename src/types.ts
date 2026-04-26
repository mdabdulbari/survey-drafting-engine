/**
 * Application-level types — UI state machines and other frontend-only shapes.
 *
 * IPC payload types (ProjectMeta, ConversionProgressPayload, …) live in
 * `src/ipc/types.ts` because they mirror Rust structs.
 */

export type AppPhase =
  | "launcher"    // full-screen project launcher (browse + create)
  | "converting"  // PDAL subprocess running
  | "ready";      // project open, point cloud streaming
