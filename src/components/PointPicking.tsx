/**
 * Click-to-pick: left click (without dragging) selects the nearest visible
 * point and stores its survey coordinates. Escape or clicking empty space
 * clears the selection. Also renders the marker on the picked point.
 */

import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { PointPicker } from "../lib/point-picker";
import { sceneToSurvey, type ScenePoint } from "../lib/coordinate-system";
import { usePointCloudStore } from "../store/pointCloudStore";

/** Pointer travel (CSS px) beyond which a press counts as a drag, not a click. */
const CLICK_TOLERENCE_PX = 4;

interface Props {
  geometry: THREE.BufferGeometry;
  /** On-screen point size in CSS px — keeps pick hit areas matched to display. */
  pointSize: number;
}

export function PointPicking({ geometry, pointSize }: Props) {
  const { gl, camera } = useThree();
  const picked = usePointCloudStore((s) => s.pickedPoint);

  useEffect(() => {
    const picker = new PointPicker(geometry);
    const canvas = gl.domElement;
    const position = new Float32Array(3);
    let downX = 0;
    let downY = 0;
    let downId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      downX = e.clientX;
      downY = e.clientY;
      downId = e.pointerId;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerId !== downId) return;
      downId = -1;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_TOLERENCE_PX)
        return;
      const { gpuPool, copc, origin, setPickedPoint } =
        usePointCloudStore.getState();

      if (!gpuPool || !copc || !origin) return;

      const rect = canvas.getBoundingClientRect();
      const index = picker.pick(
        gl,
        camera as THREE.OrthographicCamera | THREE.PerspectiveCamera,
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
        pointSize,
      );

      if (index === null) {
        setPickedPoint(null);
        return;
      }

      gpuPool.readPosition(index, position);
      if (Number.isNaN(position[0])) {
        // Slot was unloaded between render and pick — treat as a miss.
        setPickedPoint(null);
        return;
      }

      const scene: ScenePoint = [position[0], position[1], position[2]];
      setPickedPoint({
        scene,
        survey: sceneToSurvey(scene, origin, copc.header),
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        usePointCloudStore.getState().setPickedPoint(null);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      picker.dispose();
    };
  }, [gl, camera, geometry, pointSize]);

  if (!picked) return null;

  return (
    <Html
      position={picked.scene}
      center
      zIndexRange={[50, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className="h-3 w-3 rounded-full border-2 border-amber-300 shadow-[0_0_0_2px_rgba(0,0,0,0.6)]" />
    </Html>
  );
}
