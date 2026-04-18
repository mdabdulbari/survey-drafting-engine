/**
 * Single-draw-call point cloud renderer.
 *
 * All loaded nodes share two global WebGL buffers (positions + colors).
 * One THREE.Points mesh is created once and never recreated — the GPU buffers
 * are updated in-place by node-loader via bufferSubData.
 *
 * Draw calls per frame: 1.
 * This eliminates Three.js per-node overhead regardless of how many nodes
 * are loaded.
 *
 * Unloaded slots have NaN positions; the vertex shader discards them so they
 * are never visible.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { usePointCloudStore } from "../store/pointCloudStore";
import { GpuBufferPool, SLOT_COUNT, POINTS_PER_SLOT, MAX_POINTS } from "../lib/gpu-buffer-pool";

// ── GPU pool initialiser ──────────────────────────────────────────────────────

function GpuPoolProvider() {
  const { gl } = useThree();

  useEffect(() => {
    const rawGl = gl.getContext() as WebGL2RenderingContext;
    const pool = new GpuBufferPool(rawGl);
    usePointCloudStore.getState().setGpuPool(pool);
    return () => {
      pool.dispose();
      usePointCloudStore.getState().setGpuPool(null);
    };
  }, [gl]);

  return null;
}

// ── Single consolidated mesh ──────────────────────────────────────────────────

function SinglePointCloudMesh() {
  const { gl, camera, size } = useThree();
  const gpuPool     = usePointCloudStore((s) => s.gpuPool);
  const copc        = usePointCloudStore((s) => s.copc);
  const nodeSlots   = usePointCloudStore((s) => s.nodeSlots);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  // Build geometry once when the pool becomes available.
  // Uses GLBufferAttribute — points directly at the WebGL buffer the pool owns.
  // No CPU copy is kept; Three.js reads VRAM on each draw call.
  const geometry = useMemo(() => {
    if (!gpuPool) return null;

    const rawGl = gl.getContext() as WebGL2RenderingContext;
    const geom  = new THREE.BufferGeometry();

    // GLBufferAttribute(buffer, type, itemSize, elementSize, count)
    //   type        = FLOAT (5126)
    //   itemSize    = 3  (x, y, z components)
    //   elementSize = 4  (bytes per float)
    //   count       = MAX_POINTS
    const posAttr = new THREE.GLBufferAttribute(gpuPool.posBuffer,   rawGl.FLOAT, 3, 4, MAX_POINTS);
    const colAttr = new THREE.GLBufferAttribute(gpuPool.colorBuffer, rawGl.FLOAT, 3, 4, MAX_POINTS);

    geom.setAttribute("position", posAttr);
    geom.setAttribute("color",    colAttr);

    // Start with 0 visible points — updated below as nodeSlots changes.
    geom.setDrawRange(0, 0);
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);

    return geom;
  }, [gpuPool, gl]);

  // Update draw range whenever loaded slots change.
  // Draw the contiguous span from 0 to the last loaded slot's end, so that
  // any slot gaps (NaN positions) are included but discarded by the GPU.
  useEffect(() => {
    if (!geometry) return;
    const slotIndices = Object.values(nodeSlots).map((s) => s.slotIndex);
    if (slotIndices.length === 0) {
      geometry.setDrawRange(0, 0);
      return;
    }
    const maxSlot  = Math.max(...slotIndices);
    const endPoint = (maxSlot + 1) * POINTS_PER_SLOT;
    geometry.setDrawRange(0, endPoint);
  }, [geometry, nodeSlots]);

  // Build material.
  const material = useMemo(() => {
    if (!gpuPool) return null;
    const mat = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      sizeAttenuation: false,
    });
    materialRef.current = mat as unknown as THREE.ShaderMaterial;
    return mat;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpuPool, copc?.info.spacing]);

  // Keep spacing uniform in sync when a new project opens.
  useEffect(() => {
    const mat = materialRef.current;
    if (mat && copc && "uniforms" in mat) {
      mat.uniforms.uSpacing.value = copc.info.spacing;
    }
  }, [copc]);

  // Update uFocalLength and uOrthographic every frame.
  useFrame(() => {
    const mat = materialRef.current;
    if (!mat || !("uniforms" in mat)) return;

    if (camera instanceof THREE.OrthographicCamera) {
      mat.uniforms.uOrthographic.value = 1.0;
      mat.uniforms.uFocalLength.value  = camera.zoom;
    } else {
      mat.uniforms.uOrthographic.value = 0.0;
      const cam    = camera as THREE.PerspectiveCamera;
      const fovRad = (cam.fov * Math.PI) / 180;
      mat.uniforms.uFocalLength.value  = size.height / (2 * Math.tan(fovRad / 2));
    }
  });

  useEffect(() => {
    return () => { if (geometry) geometry.dispose(); };
  }, [geometry]);

  useEffect(() => {
    return () => { if (material) material.dispose(); };
  }, [material]);

  if (!geometry || !material) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export function PointCloud() {
  return (
    <>
      <GpuPoolProvider />
      <SinglePointCloudMesh />
    </>
  );
}

// Re-export constants for callers that previously imported from PointCloud.
export { SLOT_COUNT, POINTS_PER_SLOT };
