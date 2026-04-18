/**
 * Compatibility shim — re-exports the split IPC modules so that existing
 * imports from `"../ipc"` continue to resolve.
 *
 * New code should import directly from the specific sub-module:
 *   import { createProject } from "../ipc/commands";
 *   import { onConversionProgress } from "../ipc/events";
 */
export * from "./ipc/commands";
export * from "./ipc/events";
export * from "./ipc/types";
