/**
 * LOD evaluation controller.
 *
 * Runs inside the R3F canvas context. Evaluates the octree and dispatches
 * load/unload requests ONLY after the camera has settled for SETTLE_MS.
 * This prevents the queue from filling with stale requests mid-gesture.
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePointCloudStore } from "../store/pointCloudStore";
import { LodManager } from "../lib/lod-manager";
import { enqueueNode, unloadNode } from "../lib/node-loader";

/** How long the camera must be still before LOD re-evaluates (ms). */
const SETTLE_MS = 150;

export function LodController() {
  const { camera, size } = useThree();
  const lodManager = useRef<LodManager | null>(null);
  const prevMatrix = useRef(new THREE.Matrix4());
  const prevProjMatrix = useRef(new THREE.Matrix4());
  const lastMoveTime = useRef(0);

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
  }, [copc, nodes, origin]);

  useFrame(() => {
    if (!lodManager.current) return;

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

    const { toLoad, toUnload } = lodManager.current.evaluate(
      camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      size.height,
      loadedKeys
    );

    for (const key of toUnload) unloadNode(key);
    for (const { key } of toLoad) enqueueNode(key);
  });

  return null;
}
