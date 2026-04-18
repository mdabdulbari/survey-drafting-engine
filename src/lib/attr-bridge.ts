/**
 * Module-level bridge so gpu-buffer-pool can always reach the CURRENT
 * BufferAttributes, even if the geometry has been recreated since the pool
 * last stored a reference.
 *
 * PointCloud.tsx writes here every time useMemo creates (or recreates) the
 * geometry.  gpu-buffer-pool reads here at upload() call time, so it always
 * gets the live attribute.
 */
import type { BufferAttribute } from "three";

export interface AttrBridge {
  posAttr: BufferAttribute | null;
  colAttr: BufferAttribute | null;
}

export const attrBridge: AttrBridge = { posAttr: null, colAttr: null };
