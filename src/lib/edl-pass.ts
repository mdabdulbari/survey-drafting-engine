/**
 * Eye-Dome Lighting (EDL) post-process pass.
 *
 * EDL is a screen-space shading technique that darkens pixels adjacent to
 * depth discontinuities — edges, corners, silhouettes of pipes, walls, etc.
 * Flat surfaces stay bright.  Even at low point density, structure pops out
 * immediately.  This is the primary reason ReCap/AutoCAD looks "solid".
 *
 * Algorithm (per pixel):
 *   1. Sample depth at the pixel and its 4 axis-aligned neighbours.
 *   2. response = sum of max(0, neighbour_depth - centre_depth)
 *   3. shade = exp(-response × uStrength × 300)
 *   4. colour = input_colour × shade
 *
 * Background pixels (depth ≥ 0.9999, i.e. the far plane) are passed through
 * unchanged — EDL shading against the clear-colour background looks wrong.
 *
 * This pass extends ShaderPass so it slots into Three.js EffectComposer.
 * It overrides render() to pull the depth texture from the readBuffer before
 * calling the parent draw.
 */

import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

const EDL_SHADER = {
  name: "EdlShader",

  uniforms: {
    tDiffuse:    { value: null as THREE.Texture | null },
    tDepth:      { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStrength:   { value: 0.3 },
    uRadius:     { value: 2.0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2      uResolution;
    uniform float     uStrength;
    uniform float     uRadius;

    varying vec2 vUv;

    float readDepth(vec2 uv) {
      return texture2D(tDepth, uv).r;
    }

    void main() {
      vec4  colour = texture2D(tDiffuse, vUv);
      float cd     = readDepth(vUv);

      // Pass background through unchanged.
      if (cd >= 0.9999) {
        gl_FragColor = colour;
        return;
      }

      vec2 px = uRadius / uResolution;

      // Point-cloud EDL: neighbours that are background (depth ≥ 0.9999) must
      // not count toward the response.  In a mesh renderer every neighbour is
      // on a surface; in a point cloud an isolated point's neighbours are empty
      // sky (depth=1.0).  Counting sky would darken every visible point to black.
      // Fix: treat background neighbours as the same depth as the centre pixel —
      // only genuine geometry-vs-geometry depth breaks produce shading.
      float nd;
      float response = 0.0;

      nd = readDepth(vUv + vec2( px.x, 0.0)); response += max(0.0, (nd < 0.9999 ? nd : cd) - cd);
      nd = readDepth(vUv + vec2(-px.x, 0.0)); response += max(0.0, (nd < 0.9999 ? nd : cd) - cd);
      nd = readDepth(vUv + vec2(0.0,  px.y)); response += max(0.0, (nd < 0.9999 ? nd : cd) - cd);
      nd = readDepth(vUv + vec2(0.0, -px.y)); response += max(0.0, (nd < 0.9999 ? nd : cd) - cd);

      // Gentler multiplier (was 300 — far too aggressive for sparse point clouds).
      // Clamp minimum brightness so even strong edges stay readable.
      float shade = max(exp(-response * uStrength * 40.0), 0.35);
      gl_FragColor = vec4(colour.rgb * shade, colour.a);
    }
  `,
};

export class EdlPass extends ShaderPass {
  constructor() {
    // ShaderPass constructor takes `shader: object` — cast satisfies the checker.
    super(EDL_SHADER as object);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // Pull the depth texture written by the preceding RenderPass.
    if (readBuffer.depthTexture) {
      this.uniforms["tDepth"].value = readBuffer.depthTexture;
    }
    this.uniforms["uResolution"].value.set(readBuffer.width, readBuffer.height);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
