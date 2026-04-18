/**
 * LOD streaming manager (Milestone 11).
 *
 * evaluate() is called from useFrame whenever the camera moves.
 * It traverses the COPC octree and returns:
 *   toLoad  — nodes in the render set that are not yet loaded
 *   toUnload — loaded nodes no longer in the render set
 *
 * Algorithm:
 *   1. Start at root. If outside frustum → skip subtree.
 *   2. Compute screen-space error (pixels).
 *   3. If error < threshold → node is good enough; add to render set, stop recursing.
 *   4. If error ≥ threshold AND children exist → recurse children.
 *   5. After traversal, enforce 40M-point budget by trimming lowest-priority toLoad items.
 */

import * as THREE from "three";
import { Bounds } from "copc";
import type { Hierarchy } from "copc";
import type { Origin } from "./coordinate-system";

type SupportedCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

const ROOT_KEY = "0-0-0-0";

export interface NodeTarget {
  key: string;
  pointCount: number;
  screenSpaceError: number;
}

function parseKey(key: string): [number, number, number, number] {
  const parts = key.split("-").map(Number);
  return [parts[0], parts[1], parts[2], parts[3]];
}

function childKeys(key: string): string[] {
  const [d, x, y, z] = parseKey(key);
  const nd = d + 1;
  const nx = x * 2;
  const ny = y * 2;
  const nz = z * 2;
  return [
    `${nd}-${nx}-${ny}-${nz}`,
    `${nd}-${nx + 1}-${ny}-${nz}`,
    `${nd}-${nx}-${ny + 1}-${nz}`,
    `${nd}-${nx + 1}-${ny + 1}-${nz}`,
    `${nd}-${nx}-${ny}-${nz + 1}`,
    `${nd}-${nx + 1}-${ny}-${nz + 1}`,
    `${nd}-${nx}-${ny + 1}-${nz + 1}`,
    `${nd}-${nx + 1}-${ny + 1}-${nz + 1}`,
  ];
}

export class LodManager {
  private readonly rootBounds: Bounds;
  private readonly nodes: Hierarchy.Node.Map;
  private readonly spacing: number;
  private readonly origin: Origin;
  private readonly errorThresholdPixels: number;
  private readonly maxPoints: number;

  // Reusable Three.js objects — allocated once, not per-frame.
  private readonly _box = new THREE.Box3();
  private readonly _sphere = new THREE.Sphere();
  private readonly _frustum = new THREE.Frustum();
  private readonly _projMatrix = new THREE.Matrix4();

  constructor(
    rootBounds: Bounds,
    nodes: Hierarchy.Node.Map,
    spacing: number,
    origin: Origin,
    errorThresholdPixels = 1,
    maxPoints = 10_000_000
  ) {
    this.rootBounds = rootBounds;
    this.nodes = nodes;
    this.spacing = spacing;
    this.origin = origin;
    this.errorThresholdPixels = errorThresholdPixels;
    this.maxPoints = maxPoints;
  }

  evaluate(
    camera: SupportedCamera,
    rendererHeight: number,
    loadedKeys: Set<string>
  ): { toLoad: NodeTarget[]; toUnload: string[] } {
    // Focal length equivalent in pixels.
    // Perspective: rendererHeight / (2 * tan(halfFov))
    // Orthographic: zoom (pixels per world unit — no perspective divide needed)
    const isOrtho = camera instanceof THREE.OrthographicCamera;
    const focalLength = isOrtho
      ? (camera as THREE.OrthographicCamera).zoom
      : (() => {
          const fovRad = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
          return rendererHeight / (2 * Math.tan(fovRad / 2));
        })();

    this._projMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projMatrix);

    const renderSet = new Set<string>();
    this._traverse(ROOT_KEY, focalLength, isOrtho, camera, renderSet);

    const toLoad: NodeTarget[] = [];
    for (const key of renderSet) {
      if (!loadedKeys.has(key)) {
        const node = this.nodes[key]!;
        toLoad.push({
          key,
          pointCount: node.pointCount,
          screenSpaceError: this._screenSpaceError(key, focalLength, isOrtho, camera),
        });
      }
    }

    const toUnload: string[] = [];
    for (const key of loadedKeys) {
      if (!renderSet.has(key)) {
        toUnload.push(key);
      }
    }

    // Sort highest screen-space error first (most important to load first).
    toLoad.sort((a, b) => b.screenSpaceError - a.screenSpaceError);

    // Enforce point budget.
    let budget = this.maxPoints;
    for (const loaded of loadedKeys) {
      const n = this.nodes[loaded];
      if (n) budget -= n.pointCount;
    }
    const trimmed: NodeTarget[] = [];
    for (const target of toLoad) {
      if (budget <= 0) break;
      trimmed.push(target);
      budget -= target.pointCount;
    }

    return { toLoad: trimmed, toUnload };
  }

  private _traverse(
    key: string,
    focalLength: number,
    isOrtho: boolean,
    camera: THREE.Camera,
    renderSet: Set<string>
  ): void {
    const node = this.nodes[key];
    if (!node) return;

    const bounds = this._nodeBounds(key);
    if (!this._frustum.intersectsBox(bounds)) return;

    const sse = this._screenSpaceError(key, focalLength, isOrtho, camera);

    // If children exist and error is too high, recurse instead of rendering this node.
    const existingChildren = childKeys(key).filter((k) => k in this.nodes);
    if (sse >= this.errorThresholdPixels && existingChildren.length > 0) {
      for (const child of existingChildren) {
        this._traverse(child, focalLength, isOrtho, camera, renderSet);
      }
    } else {
      renderSet.add(key);
    }
  }

  private _screenSpaceError(
    key: string,
    focalLength: number,
    isOrtho: boolean,
    camera: THREE.Camera
  ): number {
    const [d] = parseKey(key);
    const geometricError = this.spacing / Math.pow(2, d);

    if (isOrtho) {
      // Orthographic: no perspective divide — error is purely zoom-dependent.
      return geometricError * focalLength;
    }

    const bounds = this._nodeBounds(key);
    bounds.getBoundingSphere(this._sphere);
    const distance = Math.max(
      camera.position.distanceTo(this._sphere.center) - this._sphere.radius,
      0.001
    );

    return (geometricError * focalLength) / distance;
  }

  private _nodeBounds(key: string): THREE.Box3 {
    const [minx, miny, minz, maxx, maxy, maxz] =
      key === ROOT_KEY
        ? this.rootBounds
        : Bounds.stepTo(this.rootBounds, parseKey(key));

    const [ox, oy, oz] = this.origin;
    // Mirror the Y↔Z swap applied in the worker: survey Z → Three.js Y, survey Y → Three.js Z.
    this._box.set(
      new THREE.Vector3(minx - ox, minz - oz, miny - oy),
      new THREE.Vector3(maxx - ox, maxz - oz, maxy - oy)
    );
    return this._box;
  }
}
