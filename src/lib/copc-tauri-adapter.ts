/**
 * Adapts the copc library's `Getter` interface to Tauri IPC.
 *
 * copc's `Getter` signature: (begin: number, end: number) => Promise<Uint8Array>
 * where [begin, end) is an exclusive byte range in the file.
 *
 * We translate that to `read_copc_range(offset, len)` calls that go through
 * the memory-mapped Rust backend — no HTTP server, no file:// reads in JS.
 */

import type { Getter } from "copc";
import { readCopcRange } from "../ipc";

export function makeTauriGetter(projectId: string): Getter {
  return async (begin: number, end: number): Promise<Uint8Array> => {
    const buffer = await readCopcRange(projectId, begin, end - begin);
    return new Uint8Array(buffer);
  };
}
