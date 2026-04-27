/**
 * Procedural per-project thumbnail. Hashes the project id to a stable hue,
 * builds a CSS gradient + dot-grid background. Survives reloads — same id
 * produces the same colors.
 */

function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export interface ThumbStyle {
  hue: number;
  background: string;
}

export function thumbStyle(projectId: string): ThumbStyle {
  const h = hashString(projectId);
  const hue = h % 360;
  const c1 = `hsl(${hue} 55% 18%)`;
  const c2 = `hsl(${(hue + 28) % 360} 55% 32%)`;
  const dotColor = `hsl(${hue} 60% 75% / 0.18)`;
  // Layered: dot grid on top, gradient on the bottom.
  const background =
    `radial-gradient(circle, ${dotColor} 1px, transparent 1.4px) 0 0 / 14px 14px,` +
    ` linear-gradient(135deg, ${c1}, ${c2})`;
  return { hue, background };
}
