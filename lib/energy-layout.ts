import type { CellGeometry, GameCell } from './explosion-game.ts';

export interface EnergyOrbLayout { left: number; top: number; width: number; height: number }

interface EnergySlotSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const unitSquare: CellGeometry = { x: 0, y: 0, width: 1, height: 1, centerX: .5, centerY: .5, vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] };

function inradius({ vertices, centerX, centerY }: CellGeometry) {
  return Math.min(...vertices.map(([ax, ay], index) => {
    const [bx, by] = vertices[(index + 1) % vertices.length];
    return Math.abs((bx - ax) * (ay - centerY) - (ax - centerX) * (by - ay)) / Math.hypot(bx - ax, by - ay);
  }));
}

export function energySlotLayout(cell: GameCell): { strokeWidth: number; segments: EnergySlotSegment[] } {
  const count = Math.min(8, Math.max(0, Math.floor(cell.capacity)));
  if (!count) return { strokeWidth: 0, segments: [] };

  const geometry = cell.geometry ?? unitSquare;
  const { x, y, centerX, centerY, vertices } = geometry;
  const tolerance = 1e-9;
  let edgeIndex = 0;
  let bestSlope = Infinity;
  let bestMidY = -Infinity;
  for (const [index, [ax, ay]] of vertices.entries()) {
    const [bx, by] = vertices[(index + 1) % vertices.length];
    const slope = Math.abs(by - ay) / Math.hypot(bx - ax, by - ay);
    const midY = (ay + by) / 2;
    // Prefer the edge closest to horizontal, and the lower edge when tied.
    if (slope < bestSlope - tolerance || (Math.abs(slope - bestSlope) <= tolerance && midY > bestMidY + tolerance)) {
      edgeIndex = index;
      bestSlope = slope;
      bestMidY = midY;
    }
  }

  const first = vertices[edgeIndex];
  const second = vertices[(edgeIndex + 1) % vertices.length];
  const [left, right] = first[0] <= second[0] ? [first, second] : [second, first];
  const [dx, dy] = [right[0] - left[0], right[1] - left[1]];
  const inset = .28;
  const rowFraction = .70;
  const stride = rowFraction / count;
  // Reserve space for the energy pips on the center side of the slot row.
  const strokeWidth = Math.min(.13 * inradius(geometry), .36 * stride * Math.hypot(dx, dy) * (1 - inset));
  // Move the row toward the centroid without changing the direction of the edge.
  const localPoint = (alongEdge: number) => [
    (left[0] + alongEdge * dx) * (1 - inset) + centerX * inset - x,
    (left[1] + alongEdge * dy) * (1 - inset) + centerY * inset - y,
  ];
  const segments = Array.from({ length: count }, (_, slot) => {
    const middle = (1 - rowFraction) / 2 + stride * (slot + .5);
    const [x1, y1] = localPoint(middle - .2 * stride);
    const [x2, y2] = localPoint(middle + .2 * stride);
    return { x1, y1, x2, y2 };
  });
  return { strokeWidth, segments };
}

export function rotatedCellOverlayStyle(cell: GameCell) {
  const geometry = cell.geometry ?? unitSquare;
  const { x, y, width, height, centerX, centerY } = geometry;
  const radius = inradius(geometry);
  const atX = (offset: number) => `${(centerX - x + offset * radius) / width * 100}%`;
  const atY = (offset: number) => `${(centerY - y + offset * radius) / height * 100}%`;
  return {
    '--cell-center-x': atX(0),
    '--cell-center-y': atY(0),
    '--cell-mark-above': atY(-.57),
    '--cell-mark-below': atY(.57),
    '--cell-mark-width': `${.5 * radius / width * 100}%`,
    '--cell-mark-height': `${.5 * radius / height * 100}%`,
    '--cell-mark-orb-offset': `${.17 * radius / height * 100}%`,
    '--cell-orb-x': atX(-.32),
    '--cell-count-x': atX(.36),
  };
}

// Physical coordinates preserve circular pips and keep every arrangement inside
// the polygon, including downward triangles and small mixed-topology cells.
export function energyOrbLayout(cell: GameCell): EnergyOrbLayout[] {
  const count = Math.min(8, Math.max(0, Math.floor(cell.energy)));
  if (!count) return [];
  const geometry = cell.geometry ?? unitSquare;
  const { x, y, width, height, centerX, centerY } = geometry;
  const radius = inradius(geometry);
  const ringCount = count === 7 ? 6 : count === 5 ? 4 : count;
  let points: [number, number][];
  if (count === 1) points = [[0, 0]];
  else if (count === 2) points = [[-.3, 0], [.3, 0]];
  else if (count === 4 || count === 5) {
    points = [[-.27, -.27], [.27, -.27], [-.27, .27], [.27, .27]];
    if (count === 5) points.unshift([0, 0]);
  } else {
    points = Array.from({ length: ringCount }, (_, index) => {
      const angle = -Math.PI / 2 + index * 2 * Math.PI / ringCount;
      return [Math.cos(angle) * .43, Math.sin(angle) * .43];
    });
    if (count === 7) points.unshift([0, 0]);
  }
  const diameter = radius * (count === 1 ? .66 : count <= 4 ? .44 : count === 8 ? .25 : .32);
  return points.map(([dx, dy]) => ({
    left: (centerX + dx * radius - x) / width * 100,
    top: (centerY + dy * radius - y) / height * 100,
    width: diameter / width * 100,
    height: diameter / height * 100,
  }));
}
