/**
 * Typed wrappers around all Tauri `listen` subscriptions.
 *
 * Each function returns a `Promise<UnlistenFn>` — call the returned function
 * to remove the listener (typically in a `useEffect` cleanup).
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConversionProgressPayload, ConversionDonePayload } from "./types";

export type { ConversionProgressPayload, ConversionDonePayload };

export function onConversionProgress(
  handler: (payload: ConversionProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<ConversionProgressPayload>("conversion_progress", (e) =>
    handler(e.payload),
  );
}

export function onConversionDone(
  handler: (payload: ConversionDonePayload) => void,
): Promise<UnlistenFn> {
  return listen<ConversionDonePayload>("conversion_done", (e) =>
    handler(e.payload),
  );
}

export function onConversionError(
  handler: (payload: ConversionProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<ConversionProgressPayload>("conversion_error", (e) =>
    handler(e.payload),
  );
}
