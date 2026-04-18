/**
 * Custom ShaderMaterial for point cloud rendering.
 *
 * Features over the default PointsMaterial:
 *
 *   Adaptive point size — gl_PointSize scales with screen-space projection of
 *   the node's geometric spacing.  Coarse LOD nodes (large spacing, farther
 *   camera) produce bigger points that fill visual gaps; fine nodes near the
 *   camera produce small tight points.  The same formula used by LodManager
 *   for screen-space error: sse = (spacing × focalLength) / distance.
 *
 *   Circular points — fragment shader discards the corners of the GL_POINT
 *   square, producing smooth discs instead of pixels/squares.
 *
 *   NaN guard — positions initialised to NaN (empty pool slots) produce a
 *   NaN gl_Position.  The shader detects this via `x != x` and moves the
 *   point outside clip space, ensuring it is always discarded.
 *
 * uFocalLength must be updated every frame via the material's uniforms.
 */

import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 color;
  varying vec3 vColor;

  uniform float uSpacing;
  uniform float uFocalLength;
  uniform float uMinSize;
  uniform float uMaxSize;
  // 0.0 = perspective camera, 1.0 = orthographic camera.
  // For orthographic, uFocalLength carries the camera zoom (pixels per world unit).
  uniform float uOrthographic;

  void main() {
    // NaN guard: unoccupied pool slots have NaN positions.
    // NaN != NaN is always true; move the point outside clip space.
    if (position.x != position.x) {
      gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vColor = color;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Adaptive size: project geometric spacing onto screen pixels.
    //   Perspective: sse = (spacing × focalLength) / dist
    //   Orthographic: sse = spacing × zoom  (zoom = pixels per world unit)
    float dist  = max(-mvPos.z, 0.001);
    float persp = (uSpacing * uFocalLength) / dist;
    float ortho = uSpacing * uFocalLength;
    float sse   = mix(persp, ortho, uOrthographic);
    gl_PointSize = clamp(sse * 0.5, uMinSize, uMaxSize);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;

  void main() {
    // Discard corners — render a circle instead of a square.
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    if (dot(uv, uv) > 1.0) discard;

    gl_FragColor = vec4(vColor, 1.0);
  }
`;

export function makePointCloudMaterial(spacing: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSpacing:      { value: spacing },
      uFocalLength:  { value: 500.0 },   // updated per-frame from PointCloud
      uMinSize:      { value: 3.0 },
      uMaxSize:      { value: 12.0 },
      uOrthographic: { value: 0.0 },     // updated per-frame from PointCloud
    },
    vertexShader:   VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthWrite: true,
    depthTest:  true,
  });
}
