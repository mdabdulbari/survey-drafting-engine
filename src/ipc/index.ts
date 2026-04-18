/**
 * Public surface of the IPC layer.
 *
 * Consumers import from `"../ipc"` and get everything they need.
 * The split between commands / events / types is an implementation detail.
 */

export * from "./types";
export * from "./commands";
export * from "./events";
