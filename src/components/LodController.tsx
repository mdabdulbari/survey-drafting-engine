/**
 * LOD evaluation controller.
 *
 * Runs inside the R3F canvas context. Evaluates the octree and dispatches
 * load/unload requests ONLY after the camera has settled for SETTLE_MS.
 * This prevents the queue from filling with stale requests mid-gesture.
 *
 * Deferred unload — eliminates the "black gap" during zoom transitions.
 *   When the render set changes, fresh tiles take a fetch + worker-decode +
 *   GPU upload to arrive (often 100s of ms).  Unloading the now-stale tiles
 *   immediately leaves the canvas background visible in their place.
 *
 *   Instead, evaluate() pushes outgoing tiles into `staleKeys`.  Each frame
 *   we drain that set, dropping a stale tile only once its volume is covered
 *   by another loaded node — either an ancestor (coarser; zoom-out case) or
 *   the full set of its existing descendants (finer; zoom-in case).  Tiles
 *   that re-enter the render set on a later evaluate() are removed from the
 *   stale set so they aren't re-unloaded.
 *
 *   Memory cost: peak GPU usage briefly holds old + new in flight.  The
 *   per-evaluate point budget in lod-manager.ts caps load volume; if budget
 *   pressure prevents new loads, stale tiles linger (low-detail rather than
 *   black — the preferable failure mode).
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Hierarchy } from "copc";
import { usePointCloudStore } from "../store/pointCloudStore";
import { LodManager } from "../lib/lod-manager";
import { enqueueNode, unloadNode } from "../lib/node-loader";

/** How long the camera must be still before LOD re-evaluates (ms). */
const SETTLE_MS = 150;

function parentKey(key: string): string | null {
  const [d, x, y, z] = key.split("-").map(Number);
  if (d === 0) return null;
  return `${d - 1}-${x >> 1}-${y >> 1}-${z >> 1}`;
}

function existingChildKeys(
  key: string,
  nodes: Hierarchy.Node.Map,
): string[] {
  const [d, x, y, z] = key.split("-").map(Number);
  const nd = d + 1;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const k = `${nd}-${x * 2 + (i & 1)}-${y * 2 + ((i >> 1) & 1)}-${z * 2 + ((i >> 2) & 1)}`;
    if (k in nodes) out.push(k);
  }
  return out;
}

/**
 * True if every spatial sub-volume of `key` is covered by some node in
 * `loaded` other than `key` itself.  A loaded ancestor covers the whole
 * volume coarsely; a fully-loaded subtree covers it finely.
 */
function isCovered(
  key: string,
  loaded: Set<string>,
  nodes: Hierarchy.Node.Map,
): boolean {
  // Coarser coverage — any ancestor loaded?
  let cur: string | null = parentKey(key);
  while (cur !== null) {
    if (loaded.has(cur)) return true;
    cur = parentKey(cur);
  }
  // Finer coverage — recurse into existing descendants.
  return descendantsCover(key, loaded, nodes);
}

function descendantsCover(
  key: string,
  loaded: Set<string>,
  nodes: Hierarchy.Node.Map,
): boolean {
  const children = existingChildKeys(key, nodes);
  if (children.length === 0) return false;
  for (const child of children) {
    if (loaded.has(child)) continue;
    if (!descendantsCover(child, loaded, nodes)) return false;
  }
  return true;
}

export function LodController() {
  const { camera, size } = useThree();
  const lodManager = useRef<LodManager | null>(null);
  const prevMatrix = useRef(new THREE.Matrix4());
  const prevProjMatrix = useRef(new THREE.Matrix4());
  const lastMoveTime = useRef(0);
  const staleKeys = useRef<Set<string>>(new Set());

  const copc = usePointCloudStore((s) => s.copc);
  const nodes = usePointCloudStore((s) => s.nodes);
  const origin = usePointCloudStore((s) => s.origin);

  useEffect(() => {
    if (!copc || !nodes || !origin) {
      lodManager.current = null;
      return;
    }
    lodManager.current = new LodManager(
      copc.info.cube,
      nodes,
      copc.info.spacing,
      origin
    );
    // Force re-evaluation on the next settled frame.
    prevMatrix.current.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    prevProjMatrix.current.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    lastMoveTime.current = 0;
    staleKeys.current.clear();
  }, [copc, nodes, origin]);

  useFrame(() => {
    const mgr = lodManager.current;
    if (!mgr) return;

    // Drain stale keys whose volume is now covered by another loaded node.
    // Runs every frame so background load completions get cleaned up promptly,
    // independent of camera movement.
    if (staleKeys.current.size > 0) {
      const loaded = new Set(
        Object.keys(usePointCloudStore.getState().nodeSlots),
      );
      for (const k of [...staleKeys.current]) {
        if (!loaded.has(k)) {
          // Already gone (e.g., load failed and slot was released).
          staleKeys.current.delete(k);
          continue;
        }
        if (isCovered(k, loaded, mgr.nodes)) {
          unloadNode(k);
          staleKeys.current.delete(k);
        }
      }
    }

    const now = performance.now();

    // Camera moved this frame (position/rotation OR zoom) — record and skip.
    // projectionMatrix must be checked separately: orthographic zoom only
    // changes projectionMatrix, not matrixWorld.
    const moved =
      !camera.matrixWorld.equals(prevMatrix.current) ||
      !camera.projectionMatrix.equals(prevProjMatrix.current);
    if (moved) {
      prevMatrix.current.copy(camera.matrixWorld);
      prevProjMatrix.current.copy(camera.projectionMatrix);
      lastMoveTime.current = now;
      return;
    }

    // Camera is static but hasn't settled long enough yet.
    if (now - lastMoveTime.current < SETTLE_MS) return;

    // Camera settled — evaluate the octree once, then wait for the next move.
    // Infinity makes (now - lastMoveTime < SETTLE_MS) permanently true,
    // so the early-return fires on every subsequent static frame until the
    // camera moves again and resets lastMoveTime to a real timestamp.
    lastMoveTime.current = Infinity;

    const { nodeSlots } = usePointCloudStore.getState();
    const loadedKeys = new Set(Object.keys(nodeSlots));

    const { toLoad, toUnload } = mgr.evaluate(
      camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      size.height,
      loadedKeys
    );

    // Mark outgoing tiles stale instead of unloading immediately.
    for (const key of toUnload) staleKeys.current.add(key);
    // Anything coming back into the render set is no longer stale.
    for (const { key } of toLoad) staleKeys.current.delete(key);

    for (const { key } of toLoad) enqueueNode(key);
  });

  return null;
}
