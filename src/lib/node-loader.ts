/**
 * Node loading pipeline.
 *
 * - Fetches compressed LAZ chunks via Tauri IPC (main thread).
 * - Transfers raw bytes to the laz-decoder Web Worker for decoding.
 * - Uploads decoded XYZ + RGB directly into the GPU buffer pool via
 *   `gl.bufferSubData` — the transient CPU Float32Arrays are released
 *   immediately after upload.
 * - Notifies the Zustand store so PointCloud re-renders.
 *
 * No permanent CPU copy of point data is retained.
 *
 * Concurrency: at most MAX_CONCURRENT nodes load simultaneously.
 */

import { Copc } from "copc";
import { usePointCloudStore } from "../store/pointCloudStore";

const MAX_CONCURRENT = 8;

// Keys currently being fetched or decoded.
const inFlight = new Set<string>();
// Ordered queue of keys waiting to start.
const queue: string[] = [];
let active = 0;

// ── Worker singleton ──────────────────────────────────────────────────────────

type WorkerMessage =
  | { type: "decoded"; nodeKey: string; points: Float32Array; colors: Float32Array; pointCount: number }
  | { type: "error"; nodeKey: string; message: string };

const worker = new Worker(
  new URL("../workers/laz-decoder.worker.ts", import.meta.url),
  { type: "module" },
);

const pending = new Map<
  string,
  {
    resolve: (result: { points: Float32Array; colors: Float32Array }) => void;
    reject: (err: Error) => void;
  }
>();

worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, nodeKey } = e.data;
  const cb = pending.get(nodeKey);
  if (!cb) return;
  pending.delete(nodeKey);

  if (type === "decoded") {
    cb.resolve({ points: e.data.points, colors: e.data.colors });
  } else {
    cb.reject(new Error(e.data.message));
  }
};

function decodeInWorker(
  nodeKey: string,
  compressedBytes: Uint8Array,
): Promise<{ points: Float32Array; colors: Float32Array }> {
  return new Promise((resolve, reject) => {
    const { copc, nodes, origin } = usePointCloudStore.getState();
    if (!copc || !nodes || !origin) {
      reject(new Error("Store not initialised"));
      return;
    }
    const nodeInfo = nodes[nodeKey];
    if (!nodeInfo) {
      reject(new Error(`Node ${nodeKey} not in hierarchy`));
      return;
    }

    pending.set(nodeKey, { resolve, reject });
    worker.postMessage(
      { type: "decode", nodeKey, compressedBytes: compressedBytes.buffer, nodeInfo, copcMeta: copc, origin },
      [compressedBytes.buffer],
    );
  });
}

// ── Load one node: fetch → decode → GPU upload → notify store ─────────────────

async function doLoad(nodeKey: string): Promise<void> {
  const { getter, nodes, gpuPool } = usePointCloudStore.getState();
  if (!getter || !nodes) return;

  if (!gpuPool) {
    console.warn("[node-loader] GPU pool not initialised — skipping", nodeKey);
    return;
  }

  const nodeInfo = nodes[nodeKey];
  if (!nodeInfo || nodeInfo.pointCount === 0) return;

  const slot = gpuPool.acquire();
  if (!slot) {
    console.warn("[node-loader] GPU pool exhausted — skipping", nodeKey);
    return;
  }

  try {
    // Fetch compressed chunk via Tauri IPC.
    const compressed = await Copc.loadCompressedPointDataBuffer(getter, nodeInfo);

    // Decode in the worker — main thread is never blocked.
    const { points, colors } = await decodeInWorker(nodeKey, compressed);

    // Upload to GPU.  After this call the CPU arrays are unreferenced and
    // will be collected on the next GC cycle.
    const count = Math.min(points.length / 3, slot.pointCapacity);
    gpuPool.upload(slot, points.subarray(0, count * 3), colors.subarray(0, count * 3));

    usePointCloudStore.getState().markLoaded(nodeKey, slot.slotIndex, count);
  } catch (err) {
    gpuPool.release(slot.slotIndex);
    console.error("[node-loader] Failed to load", nodeKey, err);
  }
}

// ── Queue management ──────────────────────────────────────────────────────────

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const key = queue.shift()!;
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    active++;
    doLoad(key).finally(() => {
      inFlight.delete(key);
      active--;
      pump();
    });
  }
}

export function enqueueNode(nodeKey: string): void {
  const { nodeSlots } = usePointCloudStore.getState();
  if (nodeKey in nodeSlots) return;
  if (inFlight.has(nodeKey)) return;
  if (!queue.includes(nodeKey)) queue.push(nodeKey);
  pump();
}

export function unloadNode(nodeKey: string): void {
  const { nodeSlots, gpuPool } = usePointCloudStore.getState();
  const slot = nodeSlots[nodeKey];
  if (slot && gpuPool) {
    gpuPool.clearSlot(slot.slotIndex);
    gpuPool.release(slot.slotIndex);
    usePointCloudStore.getState().markUnloaded(nodeKey);
  }
  const idx = queue.indexOf(nodeKey);
  if (idx !== -1) queue.splice(idx, 1);
}
