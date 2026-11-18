/**
 * GPU point picking.
 *
 * Point positions live only in VRAM (see gpu-buffer-pool.ts), so CPU
 * raycasting is impossible. Instead, render a small window around the cursor
 * with each point's buffer index encoded as its RGBA colour, read the window
 * back, and take the hit nearest the cursor.
 *
 * Cost per pick: one draw call into a 13×13 target + a 676-byte readback.
 */

import * as THREE from "three";

const PICK_RADIUS = 6;
const PICK_SIZE = PICK_RADIUS * 2 + 1;

const VERTEX_SHADER = /* glsl */ `
  uniform float uPointSize;
  flat varying vec4 vIdColor;

  void main() {
    // +1 so that 0 (the clear colour) means "no point".
    uint id = uint(gl_VertexID) + 1u;
    vIdColor = vec4(
      float(id & 255u),
      float((id >> 8) & 255u),
      float((id >> 16) & 255u),
      float((id >> 24) & 255u)
    ) / 255.0;

    // NaN positions (empty pool slots) produce a NaN clip position and are
    // discarded by the rasteriser, exactly as in the display pass.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  flat varying vec4 vIdColor;

  void main() {
    gl_FragColor = vIdColor;
  }
`;

type PickCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;

export class PointPicker {
  private readonly target = new THREE.WebGLRenderTarget(PICK_SIZE, PICK_SIZE);
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { uPointSize: { value: 1 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    blending: THREE.NoBlending,
  });

  private readonly points: THREE.Points;
  private readonly pixels = new Uint8Array(PICK_SIZE * PICK_SIZE * 4);
  private readonly savedClearColor = new THREE.Color();

  /** `geometry` is shared with the display mesh; the picker never disposes it. */
  constructor(geomertry: THREE.BufferGeometry) {
    this.points = new THREE.Points(geomertry, this.material);
    this.points.frustumCulled = false;
  }

  /**
   * Return the buffer index of the visible point nearest (x, y), or null.
   * x, y are CSS pixels relative to the canvas' top-left corner.
   * pointSize is the on-screen point size in CSS pixels, so hit areas match
   * what the user sees.
   */
  pick(
    renderer: THREE.WebGLRenderer,
    camera: PickCamera,
    x: number,
    y: number,
    viewWidth: number,
    viewHeight: number,
    pointSize: number,
  ): number | null {
    this.material.uniforms.uPointSize.value = pointSize;

    const savedTarget = renderer.getRenderTarget();
    const savedAutoClear = renderer.autoClear;
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClearColor);

    // Centre the cursor inside the middle pixel of the pick window.
    camera.setViewOffset(
      viewWidth,
      viewHeight,
      x - PICK_RADIUS - 0.5,
      y - PICK_RADIUS - 0.5,
      PICK_SIZE,
      PICK_SIZE,
    );

    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.clear();
      renderer.render(this.points, camera);
      renderer.readRenderTargetPixels(
        this.target,
        0,
        0,
        PICK_SIZE,
        PICK_SIZE,
        this.pixels,
      );
    } finally {
      camera.clearViewOffset();
      renderer.setRenderTarget(savedTarget);
      renderer.setClearColor(this.savedClearColor, savedClearAlpha);
      renderer.autoClear = savedAutoClear;
    }

    return nearestHit(this.pixels);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
/** Decode the hit closest to the window centre; null if the window is empty. */
function nearestHit(pixels: Uint8Array): number | null {
  let best = -1;
  let bestDist = Infinity;

  for (let row = 0; row < PICK_SIZE; row++) {
    for (let col = 0; col < PICK_SIZE; col++) {
      const i = (row * PICK_SIZE + col) * 4;
      const id =
        pixels[i] |
        (pixels[i + 1] << 8) |
        (pixels[i + 2] << 16) |
        (pixels[i + 3] << 24);

      if (id === 0) continue;

      const dx = col - PICK_RADIUS;
      const dy = row - PICK_RADIUS;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = id - 1;
      }
    }
  }

  return best >= 0 ? best : null;
}
