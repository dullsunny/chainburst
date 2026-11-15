export const MIXED_TILINGS = ['3.4.6.4', '3.3.3.4.4', '3.3.4.3.4', '3.3.3.3.6'] as const;
export type MixedTiling = typeof MIXED_TILINGS[number];

type Point = [number, number];
interface Tile {
  row: number;
  col: number;
  vertices: Point[];
}

const height = Math.sqrt(3) / 2;
const unitSquare: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

function translate(vertices: Point[], x: number, y: number): Point[] {
  return vertices.map(([vx, vy]) => [vx + x, vy + y]);
}

function squareAndTriangleTiles(topology: '3.3.3.4.4' | '3.3.4.3.4', rows: number, cols: number): Tile[] {
  let motifs: Point[][];
  let columnVector: Point;
  let rowVector: Point;
  if (topology === '3.3.3.4.4') {
    motifs = [
      unitSquare,
      [[0, 1], [1, 1], [.5, 1 + height]],
      [[.5, 1 + height], [1, 1], [1.5, 1 + height]],
    ];
    columnVector = [1, 0];
    rowVector = [.5, 1 + height];
  } else {
    const tips: Point[] = [[.5, -height], [1 + height, .5], [.5, 1 + height], [-height, .5]];
    motifs = [
      unitSquare,
      [[0, 0], [-height, -.5], [.5 - height, -.5 - height], [.5, -height]],
      ...unitSquare.map((vertex, edge) => [vertex, unitSquare[(edge + 1) % 4], tips[edge]]),
    ];
    columnVector = [1 + height, .5];
    rowVector = [-.5, 1 + height];
  }
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * columnVector[0] + row * rowVector[0];
      const y = col * columnVector[1] + row * rowVector[1];
      motifs.forEach((vertices, slot) => tiles.push({ row, col: motifs.length * col + slot, vertices: translate(vertices, x, y) }));
    }
  }
  return tiles;
}

function triangleSquareHexTiles(rows: number, cols: number): Tile[] {
  const vertices: Point[] = [[1, 0], [.5, height], [-.5, height], [-1, 0], [-.5, -height], [.5, -height]];
  const spacing = Math.sqrt(3) + 1;
  const center = (col: number, row: number): Point => [col * spacing * height, (col * .5 + row) * spacing];
  const vertex = (col: number, row: number, index: number): Point => {
    const [x, y] = center(col, row);
    const [dx, dy] = vertices[index % 6];
    return [x + dx, y + dy];
  };
  const directions: Point[] = [[1, 0], [0, 1], [-1, 1]];
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = 6 * col;
      tiles.push({ row, col: key, vertices: translate(vertices, ...center(col, row)) });
      // Each square bridges two parallel hexagon edges one unit apart.
      directions.forEach(([dx, dy], edge) => {
        const nextCol = col + dx;
        const nextRow = row + dy;
        if (nextCol < 0 || nextCol >= cols || nextRow >= rows) return;
        tiles.push({ row, col: key + edge + 1, vertices: [
          vertex(col, row, edge), vertex(nextCol, nextRow, edge + 4),
          vertex(nextCol, nextRow, edge + 3), vertex(col, row, edge + 1),
        ] });
      });
      if (col + 1 >= cols || row + 1 >= rows) continue;
      tiles.push({ row, col: key + 4, vertices: [
        vertex(col, row, 1), vertex(col + 1, row, 3), vertex(col, row + 1, 5),
      ] });
      tiles.push({ row, col: key + 5, vertices: [
        vertex(col + 1, row, 2), vertex(col + 1, row + 1, 4), vertex(col, row + 1, 0),
      ] });
    }
  }
  return tiles;
}

function snubHexTiles(rows: number, cols: number): Tile[] {
  const point = ([col, row]: Point): Point => [col + row / 2, row * height];
  // Every lattice vertex belongs to one of seven classes. The six neighbors
  // of a center occupy the other six classes, so hexagons never overlap.
  const isCenter = ([col, row]: Point) => (col - 2 * row) % 7 === 0;
  const ring: Point[] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const tiles: Tile[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      if (row < rows && col < cols) {
        const triangles: Point[][] = [
          [[col, row], [col + 1, row], [col, row + 1]],
          [[col + 1, row], [col + 1, row + 1], [col, row + 1]],
        ];
        triangles.forEach((triangle, slot) => {
          if (!triangle.some(isCenter)) tiles.push({ row, col: 3 * col + slot, vertices: triangle.map(point) });
        });
      }
      if (isCenter([col, row])) {
        tiles.push({ row, col: 3 * col + 2, vertices: ring.map(([dx, dy]) => point([col + dx, row + dy])) });
      }
    }
  }
  return tiles;
}

export function mixedTilingTiles(topology: MixedTiling, rows: number, cols: number): Tile[] {
  if (topology === '3.4.6.4') return triangleSquareHexTiles(rows, cols);
  if (topology === '3.3.3.3.6') return snubHexTiles(rows, cols);
  return squareAndTriangleTiles(topology, rows, cols);
}
