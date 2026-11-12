/**
 * Coordinate rebasing helpers.
 *
 * Survey data uses absolute coordinates (e.g. UTM northing/easting) that are
 * far from the origin. Passing raw coordinates to Three.js causes float32
 * precision loss (jitter at full zoom). We subtract the bbox center once and
 * work entirely in local space.
 */

import { Bounds } from "copc";

export type Origin = [number, number, number];

/** A triplet in scene space: Y-up, rebased around `origin`. */
export type ScenePoint = [number, number, number];

/** A triplet in the file's survey CRS: X = east, Y = north, Z = elevation. */
export type SurveyPoint = [number, number, number];

/** LAS quantization: stored integer `q` maps to `q * scale + offset`. */
export interface Quantization {
  scale: readonly [number, number, number];
  offset: readonly [number, number, number];
}

/** Compute the center of the COPC bounding box. */
export function computeOrigin(cube: Bounds): Origin {
  return Bounds.mid(cube) as Origin;
}

/**
 * Subtract `origin` from each (x, y, z) triplet in `points` in-place.
 * Called inside the Web Worker after laz-perf decoding (Milestone 10).
 */
export function rebasePoints(points: Float32Array, origin: Origin): void {
  for (let i = 0; i < points.length; i += 3) {
    points[i] -= origin[0];
    points[i + 1] -= origin[1];
    points[i + 2] -= origin[2];
  }
}

/**
 * Inverse of the decoder's transform: scene (Y-up, rebased) → survey CRS.
 *
 * The decoder (laz-decoder.worker.ts) emits
 *   scene = (east − ox, elev − oz, north − oy)
 * so this un-swaps the axes and adds the origin back in float64.
 *
 * The scene value went through float32, so the sum carries up to ~½ ULP of
 * error (≈ 6e-5 m at 1 km from the origin). Every real point lies on the
 * file's quantization grid, so snapping to that grid recovers the exact value
 * stored in the LAS file whenever the float32 error is below scale / 2 — true
 * for any extent up to ±16 km at the common 1 mm scale.
 */
export function sceneToSurvey(
  scene: ScenePoint,
  origin: Origin,
  quant: Quantization,
): SurveyPoint {
  return [
    snapToGrid(scene[0] + origin[0], quant.scale[0], quant.offset[0]),
    snapToGrid(scene[1] + origin[1], quant.scale[1], quant.offset[1]),
    snapToGrid(scene[2] + origin[2], quant.scale[2], quant.offset[2]),
  ];
}

function snapToGrid(value: number, scale: number, offset: number): number {
  if (!(scale > 0)) return value;

  return Math.round((value - offset) / scale) * scale * offset;
}
