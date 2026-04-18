/// <reference lib="webworker" />

/**
 * Web Worker — LAZ decoding off the main thread (Milestone 10).
 *
 * Flow:
 *   Main → Worker : { type:'decode', nodeKey, compressedBytes (transferred),
 *                     nodeInfo, copcMeta, origin }
 *   Worker → Main : { type:'decoded', nodeKey, points (transferred), pointCount }
 *                 | { type:'error', nodeKey, message }
 *
 * The worker never makes Tauri IPC calls.  The main thread fetches the
 * compressed LAZ chunk and transfers ownership to the worker.  The worker
 * decodes via copc.js + laz-perf and transfers the XYZ Float32Array back.
 */

import { Copc } from "copc";
import type { Copc as CopcType, Getter, Hierarchy } from "copc";
import { LazPerf } from "laz-perf";
// Vite resolves this to the correct served URL for the WASM binary.
// Without this, Emscripten resolves relative to the worker script URL and
// gets the HTML fallback page instead of the actual .wasm file.
import lazPerfWasmUrl from "laz-perf/lib/web/laz-perf.wasm?url";
import type { Origin } from "../lib/coordinate-system";

// ---------------------------------------------------------------------------
// LazPerf singleton — initialised on first decode, reused for all subsequent.
// ---------------------------------------------------------------------------
type LazPerfInstance = Awaited<ReturnType<typeof LazPerf.create>>;
let lazPerfInstance: LazPerfInstance | null = null;

async function getLazPerf(): Promise<LazPerfInstance> {
  if (!lazPerfInstance) {
    lazPerfInstance = await LazPerf.create({
      // Direct Emscripten to the correct asset URL rather than resolving
      // relative to the worker script, which returns an HTML fallback.
      locateFile: (path: string) =>
        path.endsWith(".wasm") ? lazPerfWasmUrl : path,
    });
  }
  return lazPerfInstance;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

interface DecodeMessage {
  type: "decode";
  nodeKey: string;
  compressedBytes: ArrayBuffer;
  nodeInfo: Hierarchy.Node;
  copcMeta: CopcType;
  origin: Origin;
}

self.onmessage = async (e: MessageEvent<DecodeMessage>) => {
  const { type, nodeKey, compressedBytes, nodeInfo, copcMeta, origin } = e.data;
  if (type !== "decode") return;

  try {
    const lazPerf = await getLazPerf();
    const compressed = new Uint8Array(compressedBytes);

    // Build an in-memory getter so copc.js can decode without IPC.
    // copc calls getter(begin, end) with absolute file offsets; we translate
    // to offsets within the compressed chunk we received.
    const { pointDataOffset } = nodeInfo;
    const mockGetter: Getter = (begin, end) =>
      Promise.resolve(
        compressed.subarray(begin - pointDataOffset, end - pointDataOffset)
      );

    const view = await Copc.loadPointDataView(mockGetter, copcMeta, nodeInfo, {
      lazPerf,
    });

    const xGet = view.getter("X");
    const yGet = view.getter("Y");
    const zGet = view.getter("Z");
    const count = view.pointCount;

    const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Survey is Z-up (X=east, Y=north, Z=elevation).
      // Three.js is Y-up, so we remap: survey Z → Three.js Y, survey Y → Three.js Z.
      points[i * 3]     = xGet(i) - origin[0]; // east  → X
      points[i * 3 + 1] = zGet(i) - origin[2]; // elev  → Y (up)
      points[i * 3 + 2] = yGet(i) - origin[1]; // north → Z
    }

    // Extract RGB if available. LAS stores uint16 (0–65535); normalize to 0–1.
    const colors = new Float32Array(count * 3);
    try {
      const rGet = view.getter("Red");
      const gGet = view.getter("Green");
      const bGet = view.getter("Blue");
      for (let i = 0; i < count; i++) {
        colors[i * 3]     = rGet(i) / 65535;
        colors[i * 3 + 1] = gGet(i) / 65535;
        colors[i * 3 + 2] = bGet(i) / 65535;
      }
    } catch {
      // No RGB in this file — fill with a neutral light-blue.
      for (let i = 0; i < count; i++) {
        colors[i * 3]     = 0.67;
        colors[i * 3 + 1] = 0.87;
        colors[i * 3 + 2] = 1.0;
      }
    }

    // Transfer ownership — zero-copy back to main thread.
    self.postMessage(
      { type: "decoded", nodeKey, points, colors, pointCount: count },
      { transfer: [points.buffer, colors.buffer] }
    );
  } catch (err) {
    self.postMessage({
      type: "error",
      nodeKey,
      message: String(err),
    });
  }
};
