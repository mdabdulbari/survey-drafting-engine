/**
 * GPU-resident point buffer pool.
 *
 * All slots share two global WebGL buffers (positions + colors), each sized
 * for SLOT_COUNT × POINTS_PER_SLOT points.  Slot N occupies the sub-range
 * at byteOffset = N × POINTS_PER_SLOT × 3 × 4 bytes.
 *
 * Benefits over per-slot buffers:
 *   - One draw call per frame (vs. one per loaded node)
 *   - No Three.js per-draw overhead (uniform push, VAO bind) per node
 *   - Empty / unloaded slots are filled with NaN positions → WebGL clips them
 *
 * Memory (position + color, both Float32 × 3 components):
 *   SLOT_COUNT × POINTS_PER_SLOT × 3 × 4 bytes × 2 = 960 MB VRAM
 *
 * JS-heap cost: zero beyond pool metadata.  Ceiling is VRAM only.
 */

// ── Slot ─────────────────────────────────────────────────────────────────────

/** A GpuSlot is a logical sub-range inside the global position/color buffers. */
export interface GpuSlot {
  readonly slotIndex: number;
  readonly pointCapacity: number;
}

// ── Module constants ──────────────────────────────────────────────────────────

/**
 * Number of node slots.
 * 128 slots × 78 125 pts = ~10 M points, ~240 MB VRAM (pos + color).
 * Raise to 256 (480 MB) or 512 (960 MB) on GPUs with more VRAM headroom.
 */
export const SLOT_COUNT = 128;

/**
 * Maximum points per slot.
 * Sized to comfortably hold one COPC inner node (~65 K default chunk size).
 */
export const POINTS_PER_SLOT = 78_125;

/** Total point budget: 128 × 78 125 = 10 000 000 */
export const MAX_POINTS = SLOT_COUNT * POINTS_PER_SLOT;

/**
 * Byte stride per slot (positions or colors, one component set).
 * position/color share the same per-slot byte size.
 */
const BYTES_PER_SLOT = POINTS_PER_SLOT * 3 * Float32Array.BYTES_PER_ELEMENT;

/**
 * Sentinel buffer: POINTS_PER_SLOT × 3 NaN floats.
 * Uploaded to a slot on unload — WebGL clips any vertex with a NaN position.
 * Allocated once at module load, reused for every clearSlot() call.
 */
const NAN_SLOT = new Float32Array(POINTS_PER_SLOT * 3).fill(NaN);

// ── Pool ─────────────────────────────────────────────────────────────────────

export class GpuBufferPool {
  private readonly gl: WebGL2RenderingContext;
  private readonly _slots: GpuSlot[];
  private readonly _free: number[];

  /** Global position buffer — sub-ranges written per slot via bufferSubData. */
  readonly posBuffer: WebGLBuffer;
  /** Global color buffer — same layout as posBuffer. */
  readonly colorBuffer: WebGLBuffer;

  readonly pointsPerSlot: number = POINTS_PER_SLOT;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const totalBytes = SLOT_COUNT * BYTES_PER_SLOT;

    this.posBuffer   = allocBuffer(gl, totalBytes);
    this.colorBuffer = allocBuffer(gl, totalBytes);

    // Initialise all position slots with NaN so unoccupied slots are invisible.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    for (let i = 0; i < SLOT_COUNT; i++) {
      gl.bufferSubData(gl.ARRAY_BUFFER, i * BYTES_PER_SLOT, NAN_SLOT);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this._slots = Array.from({ length: SLOT_COUNT }, (_, i) => ({
      slotIndex: i,
      pointCapacity: POINTS_PER_SLOT,
    }));

    this._free = Array.from({ length: SLOT_COUNT }, (_, i) => i);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  acquire(): GpuSlot | null {
    const idx = this._free.shift();
    return idx !== undefined ? this._slots[idx] : null;
  }

  /**
   * Upload `positions` and `colors` into the slot's sub-range via bufferSubData.
   *
   * The caller may discard the CPU arrays immediately — data lives on the GPU.
   */
  upload(slot: GpuSlot, positions: Float32Array, colors: Float32Array): void {
    const { gl } = this;
    const byteOffset = slot.slotIndex * BYTES_PER_SLOT;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, positions);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, colors);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // GLBufferAttribute reads directly from the GPU buffer — no CPU mirror needed.
  }

  /**
   * Overwrite the slot's position sub-range with NaN.
   * Must be called on unload so the freed slot becomes invisible.
   */
  clearSlot(slotIndex: number): void {
    const { gl } = this;
    const byteOffset = slotIndex * BYTES_PER_SLOT;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, NAN_SLOT);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  release(slotIndex: number): void {
    this._free.unshift(slotIndex);
  }

  getSlot(slotIndex: number): GpuSlot {
    return this._slots[slotIndex];
  }

  get freeCount(): number {
    return this._free.length;
  }

  /** Delete the two global WebGL buffers.  Call when the canvas is unmounting. */
  dispose(): void {
    this.gl.deleteBuffer(this.posBuffer);
    this.gl.deleteBuffer(this.colorBuffer);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function allocBuffer(gl: WebGL2RenderingContext, byteLen: number): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error("WebGL buffer creation failed");
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, byteLen, gl.DYNAMIC_DRAW);
  return buf;
}
