function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export interface ThumbPoint {
  x: number;
  y: number;
  r: number;
}

/**
 * Generates a deterministic scatter of points for a project's thumbnail minimap.
 * Same project ID always produces the same layout.
 */
export function thumbPoints(projectId: string): ThumbPoint[] {
  let seed = hashString(projectId);
  function next(): number {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed >>> 0) / 0x100000000;
  }

  const numClusters = 2 + Math.floor(next() * 3);
  const clusters: [number, number][] = [];
  for (let i = 0; i < numClusters; i++) {
    clusters.push([0.12 + next() * 0.76, 0.18 + next() * 0.64]);
  }

  const points: ThumbPoint[] = [];
  const count = 40 + Math.floor(next() * 28);
  for (let i = 0; i < count; i++) {
    const [cx, cy] = clusters[Math.floor(next() * clusters.length)];
    const angle = next() * Math.PI * 2;
    const spread = 0.10 + next() * 0.11;
    const dist = Math.sqrt(next()) * spread;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    if (x >= 0.02 && x <= 0.98 && y >= 0.02 && y <= 0.98) {
      points.push({ x, y, r: 1.2 + next() * 1.9 });
    }
  }
  return points;
}
