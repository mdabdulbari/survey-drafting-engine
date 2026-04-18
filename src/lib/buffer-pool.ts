/**
 * Pre-allocated Float32Array pool.
 *
 * All point geometry is written into slots acquired from this pool.
 * No `new Float32Array()` is ever called in the node-load hot path.
 *
 * Budget (position + color):
 *   256 slots × 78 125 pts × 3 floats × 4 bytes × 2 arrays = 480 MB
 * Tuned for high-end survey workstations.  Reduce SLOT_COUNT for tighter
 * memory environments.
 */

const FLOATS_PER_POINT = 3; // x, y, z

export interface PoolSlot {
  slotIndex: number;
  buffer: Float32Array;
}

export class BufferPool {
  private readonly slots: Float32Array[];
  private readonly free: number[];
  readonly pointsPerSlot: number;

  constructor(slotCount: number, pointsPerSlot: number) {
    this.pointsPerSlot = pointsPerSlot;
    this.slots = Array.from(
      { length: slotCount },
      () => new Float32Array(pointsPerSlot * FLOATS_PER_POINT)
    );
    this.free = Array.from({ length: slotCount }, (_, i) => i);
  }

  acquire(): PoolSlot | null {
    const slotIndex = this.free.pop();
    if (slotIndex === undefined) return null;
    return { slotIndex, buffer: this.slots[slotIndex] };
  }

  release(slotIndex: number): void {
    this.free.push(slotIndex);
  }

  getBuffer(slotIndex: number): Float32Array {
    return this.slots[slotIndex];
  }

  get freeCount(): number {
    return this.free.length;
  }
}

// 256 slots × 78 125 points = 20 000 000 points total
const SLOT_COUNT = 256;
const POINTS_PER_SLOT = 78_125;

/** Position pool — XYZ, allocated once at app start. */
export const bufferPool = new BufferPool(SLOT_COUNT, POINTS_PER_SLOT);

/** Color pool — RGB (float32, normalized 0–1), mirrors bufferPool slot-for-slot. */
export const colorPool = new BufferPool(SLOT_COUNT, POINTS_PER_SLOT);
