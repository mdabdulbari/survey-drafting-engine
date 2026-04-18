import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { LodController } from "./LodController";
import { PointCloud } from "./PointCloud";

export function Viewport() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
      <Canvas camera={{ position: [0, 100, 0], fov: 60, near: 0.01, far: 50_000 }}>
        <ambientLight intensity={0.5} />

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={0.1}
          maxDistance={5000}
        />

        <PointCloud />
        <LodController />

        {/* Remove Stats before shipping */}
        <Stats />
      </Canvas>
    </div>
  );
}
