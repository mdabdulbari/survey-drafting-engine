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
