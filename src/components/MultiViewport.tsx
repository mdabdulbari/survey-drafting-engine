/**
 * Single-viewport renderer with Eye-Dome Lighting.
 *
 * Full-canvas top-down orthographic (plan) view.  No rotation — left/right mouse
 * buttons pan, scroll wheel zooms.  EDL post-processing sharpens edge outlines.
 *
 * Coordinate mapping (from rebasePoints in coordinate-system.ts):
 *   Survey X (easting)   → Three.js X
 *   Survey Y (northing)  → Three.js Y   ← horizontal, north is +Y
 *   Survey Z (elevation) → Three.js Z   ← vertical, up is +Z
 *
 * Camera sits at high Z (above the scene), looks down −Z, north (+Y) is up.
 *
 * Camera controls (no OrbitControls — fully custom to avoid state conflicts):
 *   Middle drag              → pan (grab-style: scene follows cursor)
 *   Shift + Middle drag      → AutoCAD-style orbit:
 *                               horizontal → spin plan view around Z axis
 *                               vertical   → tilt camera toward horizon
 *   Scroll wheel             → zoom (orthographic camera.zoom)
 *
 * Z-up orbit formula (elev=0 → top-down, elev=π/2 → side view):
 *
 *   Camera position:
 *     x = target.x + r·sin(elev)·sin(az)
 *     y = target.y + r·sin(elev)·cos(az)
 *     z = target.z + r·cos(elev)
 *
 *   Camera up = d(pos)/d(elev), normalized:
 *     = [cos(elev)·sin(az),  cos(elev)·cos(az),  −sin(elev)]
 *     At elev=0, az=0  →  [0, 1, 0]  (north up, east right) ✓
 *
 * Depth texture ownership:
 *   EffectComposer internally clones its render target, which would share the
 *   same DepthTexture reference across both buffers → framebuffer feedback loop
 *   when EdlPass reads tDepth while rendering to the same texture attachment.
 *   Fix: assign an independent DepthTexture only to renderTarget1 (written by
 *   RenderPass).  renderTarget2 gets no depth texture — ShaderPass / OutputPass
 *   never need a depth attachment.
 */

import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }     from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass }     from "three/examples/jsm/postprocessing/OutputPass.js";
import { LodController }  from "./LodController";
import { PointCloud }     from "./PointCloud";
import { EdlPass }        from "../lib/edl-pass";
import { usePointCloudStore } from "../store/pointCloudStore";

// ---------------------------------------------------------------------------
// CameraControls — owns all camera interaction (pan, orbit, zoom)
// ---------------------------------------------------------------------------
//
// No OrbitControls — using it alongside a custom orbit useFrame causes the two
// systems to fight each other every frame (OrbitControls resets spherical state
// from camera.position, then our useFrame re-overrides, resulting in jitter or
// wrong axes).  Implementing everything here is cleaner and free of conflicts.
//
// Pan formula (grab-style):
//   delta = cameraRight * (dx / zoom) + cameraUp * (-dy / zoom)
//   Both camera.position and target move by delta — orbit pivot follows pan.
//
// The useFrame orbit formula runs every frame and is the single authority on
// camera.position.  Pan preserves r because it adds the same delta to both
// camera.position and target, so |camera.position − target| is unchanged.

const ORBIT_SPEED = 0.004; // radians per pixel

function CameraControls() {
  const { gl, camera, size } = useThree();
  const copc = usePointCloudStore((s) => s.copc);

  const azRef     = useRef(0);                            // azimuth (spin around Z)
  const elevRef   = useRef(0);                            // elevation (0 = top-down)
  const targetRef = useRef(new THREE.Vector3(0, 0, 0));  // orbit + pan pivot

  // ── Auto-fit when a new COPC file is opened ───────────────────────────────
  useEffect(() => {
    if (!copc) return;

    const [minx, miny, , maxx, maxy] = copc.info.cube;
    const xSpan = maxx - minx; // easting  extent → viewport width
    const ySpan = maxy - miny; // northing extent → viewport height

    if (xSpan <= 0 || ySpan <= 0 || size.width <= 0 || size.height <= 0) return;

    const fitZoom = Math.min(
      size.width  / (xSpan * 1.1),
      size.height / (ySpan * 1.1),
    );

    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = fitZoom;
    cam.updateProjectionMatrix();

    // Reset orbit to straight top-down.
    azRef.current   = 0;
    elevRef.current = 0;
    targetRef.current.set(0, 0, 0);
    cam.position.set(0, 0, 10000);
    cam.updateMatrixWorld();
  }, [copc, camera, size]);

  // ── Pointer and wheel handlers ────────────────────────────────────────────
  useEffect(() => {
    const canvas = gl.domElement;
    let mode: "none" | "pan" | "orbit" = "none";
    let lastX = 0, lastY = 0;
    let capturedId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1) return;
      mode = e.shiftKey ? "orbit" : "pan";
      lastX = e.clientX;
      lastY = e.clientY;
      capturedId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (mode === "none") return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (mode === "orbit") {
        // Horizontal drag spins the plan view (az); vertical drag tilts (elev).
        azRef.current  += dx * ORBIT_SPEED;
        elevRef.current = Math.max(
          -Math.PI * 0.45,
          Math.min(Math.PI * 0.45, elevRef.current - dy * ORBIT_SPEED),
        );
      } else {
        // Grab-style pan: scene follows cursor.
        // 1 screen pixel = 1/zoom world units in orthographic projection.
        const cam   = camera as THREE.OrthographicCamera;
        const scale = 1 / cam.zoom;

        // Read camera axes from its current world matrix (set last frame).
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const up    = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);

        // delta:  drag right (+dx) → camera moves left (−right) → scene follows right
        //         drag down  (+dy) → camera moves up  (+up)    → scene follows down
        const delta = right.multiplyScalar(-dx * scale)
                           .addScaledVector(up, dy * scale);

        targetRef.current.add(delta);
        cam.position.add(delta);
        cam.updateMatrixWorld();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 1) return;
      mode = "none";
      if (capturedId >= 0) {
        try { canvas.releasePointerCapture(capturedId); } catch { /* ok */ }
        capturedId = -1;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam    = camera as THREE.OrthographicCamera;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      cam.zoom = Math.max(1e-6, cam.zoom * factor);
      cam.updateProjectionMatrix();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup",   onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup",   onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [gl, camera]);

  // ── Apply Z-up spherical orbit every frame ────────────────────────────────
  useFrame((state) => {
    const az     = azRef.current;
    const elev   = elevRef.current;
    const target = targetRef.current;
    const r      = state.camera.position.distanceTo(target);

    // Z-up spherical → Cartesian
    state.camera.position.set(
      target.x + r * Math.sin(elev) * Math.sin(az),
      target.y + r * Math.sin(elev) * Math.cos(az),
      target.z + r * Math.cos(elev),
    );

    // up = d(pos)/d(elev), normalized — smooth at every angle including elev=0
    state.camera.up.set(
       Math.cos(elev) * Math.sin(az),
       Math.cos(elev) * Math.cos(az),
      -Math.sin(elev),
    );

    state.camera.lookAt(target);
    state.camera.updateMatrixWorld();
  });

  return null;
}

// ---------------------------------------------------------------------------
// EdlRenderer — owns the render loop, disables R3F's auto-render (priority=1)
// ---------------------------------------------------------------------------

function EdlRenderer() {
  const { gl, scene, camera, size } = useThree();

  const composerRef = useRef<EffectComposer | null>(null);
  const depthTexRef = useRef<THREE.DepthTexture | null>(null);

  useEffect(() => {
    const w = size.width;
    const h = size.height;
    if (w === 0 || h === 0) return;

    const composer = new EffectComposer(gl);
    composer.setSize(w, h);

    const depthTex = new THREE.DepthTexture(w, h);
    composer.renderTarget1.depthTexture = depthTex;
    composer.renderTarget2.depthTexture = null;

    depthTexRef.current = depthTex;

    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EdlPass());
    composer.addPass(new OutputPass());

    composerRef.current = composer;

    return () => {
      composer.dispose();
      depthTex.dispose();
      composerRef.current = null;
      depthTexRef.current  = null;
    };
  }, [gl, scene, camera, size.width, size.height]);

  useFrame(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.render();
  }, 1);

  return null;
}

// ---------------------------------------------------------------------------
// MultiViewport (single viewport)
// ---------------------------------------------------------------------------

export function MultiViewport() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
      {/*
        orthographic → R3F creates an OrthographicCamera.
        Camera at [0,0,10000]: above the scene (Z = elevation axis).
        up=[0,1,0]: north (+Y = northing) is at the top of screen.
        East (+X = easting) is to the right (standard plan-view orientation).
        Shift + middle drag = AutoCAD-style orbit (horizontal spins, vertical tilts).
        Plain middle drag pans. Scroll zooms.
      */}
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10000], up: [0, 1, 0], zoom: 0.01, near: 1, far: 200_000 }}
      >
        <ambientLight intensity={0.5} />

        <CameraControls />
        <PointCloud />
        <LodController />
        <EdlRenderer />

        {/* Remove Stats before shipping */}
        <Stats />
      </Canvas>
    </div>
  );
}
