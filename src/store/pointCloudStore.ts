import { create } from "zustand";
import type { Copc, Getter, Hierarchy } from "copc";
import type { Origin, ScenePoint, SurveyPoint } from "../lib/coordinate-system";
import type { GpuBufferPool } from "../lib/gpu-buffer-pool";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A loaded node occupies one slot in the GPU buffer pool.
 * Position and color share a single GpuSlot (no separate color pool).
 */
export interface NodeSlot {
  slotIndex: number;
  pointCount: number;
}

/** The point the user last clicked, in both coordinate spaces. */
export interface PickedPoint {
  /** Scene-space position — where the on-screen marker is drawn. */
  scene: ScenePoint;
  /** Survey CRS position (X east, Y north, Z elevation) — what is displayed. */
  survey: SurveyPoint;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface PointCloudState {
  projectId: string | null;
  copc: Copc | null;
  getter: Getter | null;
  nodes: Hierarchy.Node.Map | null;
  origin: Origin | null;
  nodeSlots: Record<string, NodeSlot>;
  /**
   * GPU buffer pool — null until the R3F canvas mounts and initialises it.
   * The pool is owned by PointCloud.tsx and disposed on canvas unmount.
   */
  gpuPool: GpuBufferPool | null;
  pickedPoint: PickedPoint | null;

  setCopc: (
    projectId: string,
    copc: Copc,
    getter: Getter,
    nodes: Hierarchy.Node.Map,
    origin: Origin,
  ) => void;
  setGpuPool: (pool: GpuBufferPool | null) => void;
  markLoaded: (nodeKey: string, slotIndex: number, pointCount: number) => void;
  markUnloaded: (nodeKey: string) => void;
  setPickedPoint: (point: PickedPoint | null) => void;
  reset: () => void;
}

// ── Initial state ─────────────────────────────────────────────────────────────

/**
 * Project-level state — cleared by `reset()` when a new project is opened.
 * Does NOT include canvas-level state (gpuPool) which survives project switches.
 */
const projectInitialState = {
  projectId: null,
  copc: null,
  getter: null,
  nodes: null,
  origin: null,
  nodeSlots: {} as Record<string, NodeSlot>,
  pickedPoint: null as PickedPoint | null,
};

// ── Store instance ────────────────────────────────────────────────────────────

export const usePointCloudStore = create<PointCloudState>((set) => ({
  ...projectInitialState,
  gpuPool: null,

  setCopc: (projectId, copc, getter, nodes, origin) =>
    set({
      projectId,
      copc,
      getter,
      nodes,
      origin,
      nodeSlots: {},
      pickedPoint: null,
    }),

  setGpuPool: (pool) => set({ gpuPool: pool }),

  markLoaded: (nodeKey, slotIndex, pointCount) =>
    set((s) => ({
      nodeSlots: { ...s.nodeSlots, [nodeKey]: { slotIndex, pointCount } },
    })),

  markUnloaded: (nodeKey) =>
    set((s) => {
      const { [nodeKey]: _removed, ...rest } = s.nodeSlots;
      return { nodeSlots: rest };
    }),

  setPickedPoint: (point) => set({ pickedPoint: point }),

  // reset() clears project data only — gpuPool is canvas-level and survives
  // project switches.
  reset: () => set(projectInitialState),
}));
