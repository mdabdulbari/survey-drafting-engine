/**
 * Payload types shared between command responses and event subscriptions.
 * These mirror the Rust structs in `src-tauri/src/commands/`.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  laz_path: string;
  copc_path: string;
  copc_ready: boolean;
  created_at: string;
}

export interface ConversionProgressPayload {
  project_id: string;
  message: string;
  /** 0–100 when known. */
  percent?: number;
  /** 1 = reading/indexing, 2 = writing.  Absent for plain log lines. */
  phase?: 1 | 2;
}

export interface ConversionDonePayload {
  project_id: string;
}
