/**
 * Single-viewport renderer with Eye-Dome Lighting.
 *
 * Full-canvas orthographic view with Sketchfab-style turntable orbit.
 * Middle-drag pans, Shift+Middle-drag orbits, wheel zooms.  EDL post-
 * processing sharpens edge outlines.
 *
 * ──────────────────────────────────────────────────────────────────────
 * World convention (Y-up — Three.js default)
 * ──────────────────────────────────────────────────────────────────────
 *
 * The scene graph is Y-up: the vertical (gravity) axis is world +Y.
 * Whatever transform the loader/rebaser applies (survey CRS → scene),
 * points end up with their elevation along +Y.  Empirically, placing
 * the camera at (0, -r, 0) with up=+Z and looking at origin produced a
 * flipped plan view — "airplane upside down, wheels up" — which is only
 * possible if the camera was *below* the model looking upward through
 * it.  That pins the vertical axis to +Y.
 *
 * If you later change rebasePoints to emit Z-up data, swap the formula
 * in `applyOrbit` and set `camera.up` to (0, 0, 1); the rest of this
 * file (event handlers, cube, presets) doesn't depend on world
 * convention.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Camera orbit convention (yaw / pitch, Y-up)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   yaw α    — rotation around world Y (vertical), measured from +Z.
 *               α = 0        → camera on +Z side, looking -Z   (FRONT)
 *               α = +π/2     → camera on +X side, looking -X   (RIGHT)
 *               α = ±π       → camera on -Z side, looking +Z   (BACK)
 *               α = -π/2     → camera on -X side, looking +X   (LEFT)
 *
 *   pitch φ  — elevation above horizon.
 *               φ = 0        → camera on horizon plane (XZ), elevation views
 *               φ = +π/2     → camera directly above target    (TOP / plan)
 *               φ = -π/2     → camera directly below target    (BOTTOM)
 *
 *   Cartesian:
 *      cam.x = target.x + r · cos(φ) · sin(α)
 *      cam.y = target.y + r · sin(φ)
 *      cam.z = target.z + r · cos(φ) · cos(α)
 *
 *   camera.up is *always* world +Y — yaw and pitch never touch roll.
 *
 * Pole degeneracy
 *   At φ = ±π/2 the view axis becomes parallel to the yaw axis (world Y),
 *   so a yaw rotation visually reads as roll (camera spins about its own
 *   view direction).  This is geometric, not a bug: clamp pitch away
 *   from the poles by a small epsilon and start off-pole so the first
 *   drag yields an unambiguous orbit.  Initial pose is FRONT
 *   (yaw = 0, pitch = 0): purely horizontal, maximally far from either
 *   pole.
 *
 * Input handling
 *   Middle drag              → pan in the screen plane (scene follows cursor)
 *   Shift + middle drag      → orbit:
 *                               horizontal dx  →  yaw   += dx · speed
 *                               vertical   dy  →  pitch += dy · speed
 *   Scroll wheel             → zoom (orthographic camera.zoom only)
 *
 *   Drag-right increases yaw → camera orbits around +Y from +Z toward +X
 *   (standard Sketchfab / Blender turntable).  Drag-down increases
 *   pitch → camera rises → more of the top shows.
 *
 * Why a custom controller instead of OrbitControls
 *   OrbitControls keeps its own spherical state internally and re-derives
 *   it from camera.position each frame.  Running a useFrame that also
 *   writes camera.position creates a two-master feedback loop where the
 *   two systems fight every frame and axes drift.  Owning the whole
 *   pan/orbit/zoom pipeline here eliminates that class of bug.
 *
 * Render loop
 *   CameraControls.useFrame runs at priority 0 (before EDL) and is the
 *   sole writer of camera.position / camera.up / camera.matrixWorld.
 *   EdlRenderer.useFrame runs at priority 1 and drives the composer.
 *   Both rely on the frame order guarantees R3F provides.
 *
 * Depth texture ownership
 *   EffectComposer internally ping-pongs between renderTarget1 and
 *   renderTarget2; if both share a DepthTexture, EdlPass reads the
 *   texture it's writing to → feedback loop.  Fix: attach the depth
 *   texture only to renderTarget1 (written by RenderPass).  renderTarget2
 *   never needs a depth attachment — ShaderPass / OutputPass don't read
 *   depth.
 */

import React, { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { LodController } from "./LodController";
import { PointCloud } from "./PointCloud";
import { EdlPass } from "../lib/edl-pass";
import { usePointCloudStore } from "../store/pointCloudStore";

// ───────────────────────────────────────────────────────────────────────────
// Orbit constants & helpers
// ───────────────────────────────────────────────────────────────────────────

const ORBIT_SPEED = 0.005; // radians per pixel
const ZOOM_STEP = 1.1; // wheel notch factor
const PITCH_EPS = 0.001; // stay off the poles
const PITCH_MAX = Math.PI / 2 - PITCH_EPS;
const PITCH_MIN = -Math.PI / 2 + PITCH_EPS;

const INITIAL_YAW = 0; // FRONT: camera on +Z, looking -Z
const INITIAL_PITCH = 0; // horizon-level: off-pole, drag yaw is unambiguous

// r = orbit radius.  Only affects near/far clipping in orthographic mode;
// view extent is set by camera.zoom.
const INITIAL_RADIUS = 10_000;
const INITIAL_CAMERA_POSITION: [number, number, number] = [
  0,
  0,
  INITIAL_RADIUS,
];

/**
 * Place an orbiting camera at (yaw, pitch, r) around `target` with world-Y up.
 * Writes position, resets up to (0,1,0), points at target, and refreshes the
 * world matrix.  This is the single point where yaw/pitch become a pose.
 */
function applyOrbit(
  camera: THREE.Camera,
  target: THREE.Vector3,
  yaw: number,
  pitch: number,
  radius: number,
): void {
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  camera.position.set(
    target.x + radius * cosP * sinY,
    target.y + radius * sinP,
    target.z + radius * cosP * cosY,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

// ───────────────────────────────────────────────────────────────────────────
// CameraControls — owns pan, orbit, zoom; authoritative over camera.position
// ───────────────────────────────────────────────────────────────────────────

interface OrbitRefs {
  yawRef: { current: number };
  pitchRef: { current: number };
  radiusRef: { current: number };
  targetRef: { current: THREE.Vector3 };
}

function CameraControls({ yawRef, pitchRef, radiusRef, targetRef }: OrbitRefs) {
  const { gl, camera, size } = useThree();
  const copc = usePointCloudStore((s) => s.copc);

  // ── Auto-fit on new file ─────────────────────────────────────────────────
  // Use the largest span of the three axes so the model stays framed at any
  // yaw/pitch.  Slight over-fit (1.1) leaves breathing room at the edges.
  useEffect(() => {
    if (!copc) return;

    const [minx, miny, minz, maxx, maxy, maxz] = copc.info.cube;
    const xSpan = maxx - minx;
    const ySpan = maxy - miny;
    const zSpan = maxz - minz;
    const maxSpan = Math.max(xSpan, ySpan, zSpan);

    if (maxSpan <= 0 || size.width <= 0 || size.height <= 0) return;

    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = Math.min(size.width, size.height) / (maxSpan * 1.1);
    cam.updateProjectionMatrix();

    // Reset orbit to the initial pose.
    yawRef.current = INITIAL_YAW;
    pitchRef.current = INITIAL_PITCH;
    targetRef.current.set(0, 0, 0);
    radiusRef.current = INITIAL_RADIUS;

    applyOrbit(
      cam,
      targetRef.current,
      yawRef.current,
      pitchRef.current,
      radiusRef.current,
    );
  }, [copc, camera, size]);

  // ── Pointer & wheel handlers ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = gl.domElement;
    let mode: "none" | "pan" | "orbit" = "none";
    let lastX = 0,
      lastY = 0;
    let capturedId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1) return; // middle button only
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
        // Yaw:   drag right (+dx) → camera orbits from +Z toward +X.
        // Pitch: drag down  (+dy) → camera tilts up, more top-face visible.
        yawRef.current += dx * ORBIT_SPEED;
        pitchRef.current = Math.max(
          PITCH_MIN,
          Math.min(PITCH_MAX, pitchRef.current + dy * ORBIT_SPEED),
        );
      } else {
        // Grab-style pan: scene follows cursor.  1 screen pixel = 1/zoom world
        // units in orthographic projection.  Shifting camera.position AND
        // target by the same delta preserves orbit radius — no rewind needed.
        const cam = camera as THREE.OrthographicCamera;
        const scale = 1 / cam.zoom;

        const right = new THREE.Vector3().setFromMatrixColumn(
          cam.matrixWorld,
          0,
        );
        const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);

        // drag right (+dx) → camera moves left  → scene appears to follow right
        // drag down  (+dy) → camera moves up    → scene appears to follow down
        const delta = right
          .multiplyScalar(-dx * scale)
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
        try {
          canvas.releasePointerCapture(capturedId);
        } catch {
          /* ok */
        }
        capturedId = -1;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camera as THREE.OrthographicCamera;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      cam.zoom = Math.max(1e-6, cam.zoom * factor);
      cam.updateProjectionMatrix();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [gl, camera]);

  // ── Apply orbit every frame (priority 0, before EDL) ─────────────────────
  useFrame((state) => {
    applyOrbit(
      state.camera,
      targetRef.current,
      yawRef.current,
      pitchRef.current,
      radiusRef.current,
    );
  }, 0);

  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// EdlRenderer — owns the render loop (priority 1)
// ───────────────────────────────────────────────────────────────────────────

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

    // Depth texture goes on renderTarget1 only; see file-header note.
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
      depthTexRef.current = null;
    };
  }, [gl, scene, camera, size.width, size.height]);

  useFrame(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.render();
  }, 1);

  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// ViewCube — orientation indicator + preset buttons
// ───────────────────────────────────────────────────────────────────────────
//
// Classic CSS cube face placements (Y-down CSS space):
//   Front:   translateZ(H)                      — +Z face, toward viewer at rest
//   Back:    rotateY(180°)  translateZ(H)       — −Z face
//   Right:   rotateY( 90°)  translateZ(H)       — +X face, right side
//   Left:    rotateY(-90°)  translateZ(H)       — −X face, left side
//   Top:     rotateX( 90°)  translateZ(H)       — −Y face in CSS (visually above)
//   Bottom:  rotateX(-90°)  translateZ(H)       — +Y face in CSS (visually below)
//
// To mirror the camera, we rotate the container so the face the camera is
// looking at ends up at +Z (toward the viewer of the cube):
//
//   container transform = rotateX(−pitchDeg) rotateY(−yawDeg)
//
// The cube is a pure CSS artifact; this mapping does not depend on whether
// the 3D world is Y-up or Z-up — only on the (yaw, pitch) pair.
//
// Sanity checks:
//   yaw=0,    pitch=0      → identity                 (Front face toward user)
//   yaw=π/2,  pitch=0      → rotateY(-90°)            (Right face → +Z)
//   yaw=π,    pitch=0      → rotateY(-180°)           (Back face  → +Z)
//   yaw=-π/2, pitch=0      → rotateY( 90°)            (Left face  → +Z)
//   yaw=0,    pitch=+π/2   → rotateX(-90°)            (Top face   → +Z)
//   yaw=0,    pitch=-π/2   → rotateX( 90°)            (Bottom     → +Z)

const CUBE_S = 72; // px — side length of each cube face
const CUBE_H = CUBE_S / 2;

const FACE_BASE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.5px",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.25)",
  boxSizing: "border-box",
  cursor: "pointer",
  userSelect: "none",
};

type Preset = { label: string; yaw: number; pitch: number };

const PRESETS: Preset[] = [
  { label: "Top", yaw: 0, pitch: PITCH_MAX },
  { label: "Front", yaw: 0, pitch: 0 },
  { label: "Right", yaw: Math.PI / 2, pitch: 0 },
  { label: "Bot", yaw: 0, pitch: PITCH_MIN },
  { label: "Back", yaw: Math.PI, pitch: 0 },
  { label: "Left", yaw: -Math.PI / 2, pitch: 0 },
];

interface ViewCubeProps {
  yawRef: { current: number };
  pitchRef: { current: number };
}

function ViewCube({ yawRef, pitchRef }: ViewCubeProps) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // rAF loop — mirror camera yaw/pitch into the cube container transform
  // without triggering React re-renders.
  useEffect(() => {
    const tick = () => {
      if (cubeRef.current) {
        const yawDeg = (yawRef.current * 180) / Math.PI;
        const pitchDeg = (pitchRef.current * 180) / Math.PI;
        cubeRef.current.style.transform = `rotateX(${-pitchDeg}deg) rotateY(${-yawDeg}deg)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [yawRef, pitchRef]);

  const snap = (yaw: number, pitch: number) => {
    yawRef.current = yaw;
    pitchRef.current = pitch;
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* 3D cube — rotates to mirror which face the camera is looking at */}
      <div
        style={{
          width: CUBE_S,
          height: CUBE_S,
          perspective: 260,
          flexShrink: 0,
        }}
      >
        <div
          ref={cubeRef}
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            transformStyle: "preserve-3d",
          }}
        >
          {/* Front — CSS +Z face (camera yaw=0, pitch=0) */}
          <div
            style={{
              ...FACE_BASE,
              background: "rgba(30,100,210,0.88)",
              transform: `translateZ(${CUBE_H}px)`,
            }}
            onClick={() => snap(0, 0)}
          >
            Front
          </div>

          {/* Back — CSS -Z face (camera yaw=π) */}
          <div
            style={{
              ...FACE_BASE,
              background: "rgba(20,80,175,0.88)",
              transform: `rotateY(180deg) translateZ(${CUBE_H}px)`,
            }}
            onClick={() => snap(Math.PI, 0)}
          >
            Back
          </div>

          {/* Right — CSS +X face (camera yaw=+π/2) */}
          <div
            style={{
              ...FACE_BASE,
              background: "rgba(25,90,190,0.88)",
              transform: `rotateY(90deg) translateZ(${CUBE_H}px)`,
            }}
            onClick={() => snap(Math.PI / 2, 0)}
          >
            Right
          </div>

          {/* Left — CSS -X face (camera yaw=-π/2) */}
          <div
            style={{
              ...FACE_BASE,
              background: "rgba(25,90,190,0.88)",
              transform: `rotateY(-90deg) translateZ(${CUBE_H}px)`,
            }}
            onClick={() => snap(-Math.PI / 2, 0)}
          >
            Left
          </div>

          {/* Top — visually above (camera pitch=+π/2) */}
          <div
            style={{
              ...FACE_BASE,
              background: "rgba(50,140,240,0.92)",
              transform: `rotateX(90deg) translateZ(${CUBE_H}px)`,
            }}
            onClick={() => snap(0, PITCH_MAX)}
          >
            Top
          </div>

          {/* Bottom — visually below (camera pitch=-π/2) */}
          <div
            style={{
              ...FACE_BASE,
              background: "rgba(15,65,160,0.88)",
              transform: `rotateX(-90deg) translateZ(${CUBE_H}px)`,
            }}
            onClick={() => snap(0, PITCH_MIN)}
          >
            Bot
          </div>
        </div>
      </div>

      {/* Always-visible preset buttons — all 6 views one click away */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 3,
          width: CUBE_S + 16,
        }}
      >
        {PRESETS.map(({ label, yaw, pitch }) => (
          <button
            key={label}
            onClick={() => snap(yaw, pitch)}
            style={{
              background: "rgba(20,70,160,0.80)",
              border: "1px solid rgba(100,160,255,0.35)",
              color: "#bdd",
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 2px",
              cursor: "pointer",
              borderRadius: 3,
              letterSpacing: "0.3px",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MultiViewport
// ───────────────────────────────────────────────────────────────────────────

export function MultiViewport() {
  // Orbit state lives here so CameraControls (inside Canvas) and ViewCube
  // (HTML overlay outside Canvas) share the exact same ref objects.
  const yawRef = useRef(INITIAL_YAW);
  const pitchRef = useRef(INITIAL_PITCH);
  const radiusRef = useRef(INITIAL_RADIUS);
  const targetRef = useRef(new THREE.Vector3(0, 0, 0));

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        background: "#111",
      }}
    >
      <Canvas
        orthographic
        camera={{
          position: INITIAL_CAMERA_POSITION, // +Z = Front view for Y-up world
          up: [0, 1, 0], // world +Y is vertical
          zoom: 0.01,
          near: 1,
          far: 200_000,
        }}
      >
        <ambientLight intensity={0.5} />

        <CameraControls
          yawRef={yawRef}
          pitchRef={pitchRef}
          radiusRef={radiusRef}
          targetRef={targetRef}
        />
        <PointCloud />
        <LodController />
        <EdlRenderer />

        {/* Remove Stats before shipping */}
        <Stats />
      </Canvas>

      {/* HTML overlay — sits outside the Canvas so it's always on top */}
      <ViewCube yawRef={yawRef} pitchRef={pitchRef} />
    </div>
  );
}
