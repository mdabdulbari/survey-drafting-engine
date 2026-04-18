/**
 * Loads the COPC header and root hierarchy page via the Tauri IPC adapter,
 * then enqueues the root node for immediate rendering.
 */

import { Copc } from "copc";
import type { Hierarchy } from "copc";
import { makeTauriGetter } from "./copc-tauri-adapter";
import { computeOrigin } from "./coordinate-system";
import { usePointCloudStore } from "../store/pointCloudStore";
import { enqueueNode } from "./node-loader";

const ROOT_KEY = "0-0-0-0";

export async function loadCopc(projectId: string): Promise<void> {
  const t0 = performance.now();

  const getter = makeTauriGetter(projectId);
  const copc = await Copc.create(getter);
  const origin = computeOrigin(copc.info.cube);

  // Recursively load all hierarchy pages so the LodManager knows about every
  // available node, not just the coarse root page.
  const allNodes: Hierarchy.Node.Map = {} as Hierarchy.Node.Map;
  const pageQueue: Hierarchy.Page[] = [copc.info.rootHierarchyPage];

  while (pageQueue.length > 0) {
    const page = pageQueue.shift()!;
    const subtree = await Copc.loadHierarchyPage(getter, page);
    Object.assign(allNodes, subtree.nodes);
    // Queue child pages for loading (values can be undefined per copc types).
    for (const childPage of Object.values(subtree.pages)) {
      if (childPage) pageQueue.push(childPage);
    }
  }

  usePointCloudStore
    .getState()
    .setCopc(projectId, copc, getter, allNodes, origin);

  const nodeCount = Object.keys(allNodes).length;
  console.log(
    `[copc] Loaded: ${nodeCount} nodes in ${(performance.now() - t0).toFixed(0)}ms`,
    "origin:", origin,
    "cube:", copc.info.cube,
  );

  // Kick off root node — first points visible as soon as decode completes.
  if (allNodes[ROOT_KEY]) {
    enqueueNode(ROOT_KEY);
  }
}
