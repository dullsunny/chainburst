import { MIXED_TILINGS, mixedTilingTiles, type MixedTiling } from './mixed-tilings.ts';

export type CellShape = 'square' | 'triangle' | 'hex';
export type MapKind = 'classic' | 'expanded' | 'shape' | 'mixed' | 'custom';
export type BoardTopology = CellShape | 'trihex' | MixedTiling;
export const BOARD_TOPOLOGY_NAMES: Record<BoardTopology, string> = {
  square: '方形密铺',
  triangle: '三角密铺',
  hex: '六边密铺',
  trihex: '三六角混合密铺',
  '3.4.6.4': '3.4.6.4',
  '3.3.3.4.4': '3.3.3.4.4',
  '3.3.4.3.4': '3.3.4.3.4',
  '3.3.3.3.6': '3.3.3.3.6',
};

export function isBoardTopology(value: unknown): value is BoardTopology {
  return typeof value === 'string' && Object.hasOwn(BOARD_TOPOLOGY_NAMES, value);
}

export function isMixedTiling(topology: BoardTopology): topology is MixedTiling {
  return (MIXED_TILINGS as readonly BoardTopology[]).includes(topology);
}

export interface CellGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  vertices: [number, number][];
}

export interface CellSpec {
  row: number;
  col: number;
  active: boolean;
  shape: CellShape;
  autoCapacity: boolean;
  capacity: number;
  initialEnergy: number;
  boostDirections: string[];
  geometry?: CellGeometry;
}

export interface GameCell extends CellSpec {
  id: string;
  index: number;
  energy: number;
  owner: number | null;
  neighbors: number[];
  boosted: number[];
  /** Physical edge numbers, in the same order as neighbors, on the new mixed tilings. */
  neighborEdges?: number[];
}

export interface GameMap {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  rows: number;
  cols: number;
  kind: MapKind;
  difficulty: '入门' | '进阶' | '专家';
  recommended: string;
  accent: string;
  topology: BoardTopology;
  geometry: { width: number; height: number };
  cells: GameCell[];
}

export const CUSTOM_MAP_SLOT_COUNT = 4;
export const MAX_CUSTOM_MAP_CELLS = 2400;

export interface CustomMapCellOverride {
  index: number;
  active?: false;
  autoCapacity?: false;
  capacity?: number;
  initialEnergy?: number;
  boostDirections?: string[];
}

export interface CustomMapSnapshot {
  version: 1;
  id: string;
  name: string;
  rows: number;
  cols: number;
  topology: BoardTopology;
  cells: CustomMapCellOverride[];
}

export interface Transfer {
  source: number;
  target: number;
  amount: number;
}

export interface WaveResult {
  exploding: number[];
  afterBurst: GameCell[];
  afterTransfer: GameCell[];
  transfers: Transfer[];
}

export const PLAYER_STYLES = [
  { name: '赤焰', short: '赤', color: '#ff5f57', rgb: '255 95 87', symbol: '●' },
  { name: '湛蓝', short: '蓝', color: '#56a8ff', rgb: '86 168 255', symbol: '◆' },
  { name: '翡翠', short: '翠', color: '#3ed598', rgb: '62 213 152', symbol: '▲' },
  { name: '鎏金', short: '金', color: '#ffc857', rgb: '255 200 87', symbol: '✦' },
  { name: '幻紫', short: '紫', color: '#b889ff', rgb: '184 137 255', symbol: '⬟' },
  { name: '霜青', short: '青', color: '#45e0e8', rgb: '69 224 232', symbol: '✚' },
] as const;

const keyFor = (row: number, col: number) => `${row}:${col}`;
const TRI_HEIGHT = Math.sqrt(3) / 2;
const HEX_HEIGHT = 2 / Math.sqrt(3);

function geometryFromVertices(vertices: [number, number][]): CellGeometry {
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return {
    x,
    y,
    width,
    height,
    centerX: vertices.reduce((sum, [vx]) => sum + vx, 0) / vertices.length,
    centerY: vertices.reduce((sum, [, vy]) => sum + vy, 0) / vertices.length,
    vertices,
  };
}

function regularGeometry(topology: CellShape, row: number, col: number): CellGeometry {
  if (topology === 'triangle') {
    const x = col / 2;
    const y = row * TRI_HEIGHT;
    const up = (row + col) % 2 === 0;
    return geometryFromVertices(up
      ? [[x + .5, y], [x + 1, y + TRI_HEIGHT], [x, y + TRI_HEIGHT]]
      : [[x, y], [x + 1, y], [x + .5, y + TRI_HEIGHT]]);
  }
  if (topology === 'hex') {
    const x = col + (row % 2) * .5;
    const y = row * HEX_HEIGHT * .75;
    return geometryFromVertices([
      [x + .5, y], [x + 1, y + HEX_HEIGHT * .25], [x + 1, y + HEX_HEIGHT * .75],
      [x + .5, y + HEX_HEIGHT], [x, y + HEX_HEIGHT * .75], [x, y + HEX_HEIGHT * .25],
    ]);
  }
  return geometryFromVertices([[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1]]);
}

function cloneGeometry(geometry: CellGeometry): CellGeometry {
  return { ...geometry, vertices: geometry.vertices.map(([x, y]) => [x, y]) };
}

function normalizedGeometry(specs: CellSpec[], topology: BoardTopology) {
  const raw = specs.map((spec) => spec.geometry
    ? cloneGeometry(spec.geometry)
    : regularGeometry(topology === 'trihex' || isMixedTiling(topology) ? 'square' : topology, spec.row, spec.col));
  const vertices = raw.flatMap((geometry) => geometry.vertices);
  const minX = Math.min(...vertices.map(([x]) => x));
  const minY = Math.min(...vertices.map(([, y]) => y));
  const maxX = Math.max(...vertices.map(([x]) => x));
  const maxY = Math.max(...vertices.map(([, y]) => y));
  return {
    geometries: raw.map((geometry) => ({
      ...geometry,
      x: geometry.x - minX,
      y: geometry.y - minY,
      centerX: geometry.centerX - minX,
      centerY: geometry.centerY - minY,
      vertices: geometry.vertices.map(([x, y]) => [x - minX, y - minY] as [number, number]),
    })),
    bounds: { width: Math.max(.001, maxX - minX), height: Math.max(.001, maxY - minY) },
  };
}

function pointKey([x, y]: [number, number]) {
  return `${Math.round(x * 1_000_000)}:${Math.round(y * 1_000_000)}`;
}

function edgeKey(a: [number, number], b: [number, number]) {
  const first = pointKey(a);
  const second = pointKey(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function directionFromGeometry(cell: Pick<GameCell, 'shape' | 'geometry'>, neighbor: Pick<GameCell, 'geometry'>) {
  const dx = neighbor.geometry!.centerX - cell.geometry!.centerX;
  const dy = neighbor.geometry!.centerY - cell.geometry!.centerY;
  if (cell.shape === 'hex') {
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle >= -30 && angle <= 30) return 'R';
    if (angle >= 150 || angle <= -150) return 'L';
    if (angle < 0) return dx < 0 ? 'UL' : 'UR';
    return dx < 0 ? 'DL' : 'DR';
  }
  if (cell.shape === 'triangle') {
    if (Math.abs(dy) > Math.abs(dx) * .75) return dy < 0 ? 'U' : 'D';
    return dx < 0 ? 'L' : 'R';
  }
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'L' : 'R';
  return dy < 0 ? 'U' : 'D';
}

function compileCells(specs: CellSpec[], topology: BoardTopology) {
  const { geometries, bounds } = normalizedGeometry(specs, topology);
  const cells: GameCell[] = specs.map((spec, index) => ({
    ...spec,
    geometry: geometries[index],
    id: keyFor(spec.row, spec.col),
    index,
    energy: 0,
    owner: null,
    capacity: spec.active ? Math.max(1, spec.capacity) : 0,
    neighbors: [],
    boosted: [],
    boostDirections: spec.active ? [...spec.boostDirections] : [],
  }));

  const numberedEdges = isMixedTiling(topology);
  const edgeOwners = new Map<string, { cell: number; edge: number }[]>();
  const physicalEdges = numberedEdges ? cells.map(() => new Map<number, number>()) : undefined;
  for (const cell of cells) {
    if (!cell.active) continue;
    const { vertices } = cell.geometry!;
    for (let edge = 0; edge < vertices.length; edge += 1) {
      const key = edgeKey(vertices[edge], vertices[(edge + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const entry = { cell: cell.index, edge: edge + 1 };
      if (owners) owners.push(entry);
      else edgeOwners.set(key, [entry]);
    }
  }
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [{ cell: first, edge: firstEdge }, { cell: second, edge: secondEdge }] = owners;
    cells[first].neighbors.push(second);
    cells[second].neighbors.push(first);
    physicalEdges?.[first].set(second, firstEdge);
    physicalEdges?.[second].set(first, secondEdge);
  }

  const normalized = cells.map((cell) => {
    if (!cell.active) return cell;
    const neighbors = [...cell.neighbors].sort((a, b) => a - b);
    const degree = neighbors.length;
    const capacity = cell.autoCapacity ? Math.max(1, degree) : Math.max(1, cell.capacity);
    const remainder = degree > 0 ? capacity % degree : 0;
    const meaningfulBoost = !cell.autoCapacity && capacity > degree && remainder > 0;
    const neighborEdges = physicalEdges ? neighbors.map((neighbor) => physicalEdges[cell.index].get(neighbor)!) : undefined;
    const directions = neighbors.map((neighbor, index) => neighborEdges
      ? `E${neighborEdges[index]}`
      : directionFromGeometry(cell, cells[neighbor]));
    const validDirections = new Set(directions);
    const boostDirections = meaningfulBoost
      ? [...new Set(cell.boostDirections)].filter((direction) => validDirections.has(direction)).slice(0, remainder)
      : [];
    const boosted = neighbors.filter((_, index) => boostDirections.includes(directions[index]));
    const initialEnergy = Math.min(Math.max(0, cell.initialEnergy), Math.max(0, capacity - 1));
    return {
      ...cell, neighbors, capacity, initialEnergy, energy: initialEnergy, boostDirections, boosted,
      ...(neighborEdges ? { neighborEdges } : {}),
    };
  });

  return { cells: normalized, geometry: bounds };
}

interface MapOptions {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  rows: number;
  cols: number;
  kind: MapKind;
  difficulty: GameMap['difficulty'];
  recommended: string;
  accent: string;
  topology?: CellShape;
  shapeAt?: (row: number, col: number) => CellShape;
  activeAt?: (row: number, col: number) => boolean;
  customize?: (spec: CellSpec) => Partial<CellSpec>;
}

export function createMap(options: MapOptions): GameMap {
  // Construction callbacks must never escape into the playable map: browser
  // Workers cannot structured-clone functions when initializing preview or AI.
  const { shapeAt, activeAt, customize, ...metadata } = options;
  const topology = options.topology ?? 'square';
  const specs: CellSpec[] = [];
  for (let row = 0; row < options.rows; row += 1) {
    for (let col = 0; col < options.cols; col += 1) {
      const base: CellSpec = {
        row,
        col,
        active: activeAt?.(row, col) ?? true,
        shape: shapeAt?.(row, col) ?? topology,
        autoCapacity: true,
        capacity: 4,
        initialEnergy: 0,
        boostDirections: [],
      };
      specs.push({ ...base, ...customize?.(base) });
    }
  }
  const compiled = compileCells(specs, topology);
  return { ...metadata, topology, cells: compiled.cells, geometry: compiled.geometry };
}

export function createClassicMap(size: number): GameMap {
  return createMap({
    id: `classic-${size}`,
    name: `${size} × ${size} 方阵`,
    subtitle: size === 6 ? '经典竞技场' : size >= 16 ? '宏大战场' : '标准方阵',
    description: size === 6 ? '规则纯粹、节奏明快，最适合熟悉连锁爆炸。' : `共 ${size * size} 格的标准方形地图，适合更长线的布局与围攻。`,
    rows: size,
    cols: size,
    kind: 'classic',
    difficulty: size <= 8 ? '入门' : size <= 12 ? '进阶' : '专家',
    recommended: size <= 8 ? '2–4 人' : size <= 12 ? '3–6 人' : '4–6 人',
    accent: '#e8ff58',
  });
}

function createTrihexSpecs(rows: number, cols: number): CellSpec[] {
  const specs: CellSpec[] = [];
  const centers = (row: number, col: number) => ({ x: col * 2 + row, y: row * Math.sqrt(3) });
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const center = centers(row, col);
      const vertices = Array.from({ length: 6 }, (_, vertex) => {
        const angle = vertex * Math.PI / 3;
        return [center.x + Math.cos(angle), center.y + Math.sin(angle)] as [number, number];
      });
      specs.push({
        row: row * 2,
        col: col * 2,
        active: true,
        shape: 'hex',
        autoCapacity: true,
        capacity: 6,
        initialEnergy: 0,
        boostDirections: [],
        geometry: geometryFromVertices(vertices),
      });
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const anchor = centers(row, col);
      specs.push({
        row: row * 2 + 1,
        col: col * 2 + 1,
        active: true,
        shape: 'triangle',
        autoCapacity: true,
        capacity: 3,
        initialEnergy: 0,
        boostDirections: [],
        geometry: geometryFromVertices([
          [anchor.x + 1, anchor.y],
          [anchor.x + 1.5, anchor.y + TRI_HEIGHT],
          [anchor.x + .5, anchor.y + TRI_HEIGHT],
        ]),
      });
      specs.push({
        row: row * 2 + 1,
        col: col * 2 + 2,
        active: true,
        shape: 'triangle',
        autoCapacity: true,
        capacity: 3,
        initialEnergy: 0,
        boostDirections: [],
        geometry: geometryFromVertices([
          [anchor.x + 1.5, anchor.y + TRI_HEIGHT],
          [anchor.x + 2.5, anchor.y + TRI_HEIGHT],
          [anchor.x + 2, anchor.y + Math.sqrt(3)],
        ]),
      });
    }
  }
  return specs;
}

function editorTopology(cells?: CellSpec[], requested?: BoardTopology): BoardTopology {
  if (requested) return requested;
  const shapes = new Set(cells?.filter((cell) => cell.active).map((cell) => cell.shape));
  if (shapes.size === 1) return [...shapes][0] as BoardTopology;
  return 'square';
}

export function createEditorMap(rows = 8, cols = 8, cells?: CellSpec[], requestedTopology?: BoardTopology): GameMap {
  const topology = editorTopology(cells, requestedTopology);
  const prior = new Map((cells ?? []).map((cell) => [keyFor(cell.row, cell.col), cell]));
  const bases = topology === 'trihex'
    ? createTrihexSpecs(rows, cols)
    : isMixedTiling(topology) ? mixedTilingTiles(topology, rows, cols).map(({ row, col, vertices }): CellSpec => ({
      row, col, active: true,
      shape: vertices.length === 3 ? 'triangle' : vertices.length === 4 ? 'square' : 'hex',
      geometry: geometryFromVertices(vertices),
      autoCapacity: true, capacity: vertices.length, initialEnergy: 0, boostDirections: [],
    }))
    : Array.from({ length: rows * cols }, (_, index): CellSpec => ({
      row: Math.floor(index / cols),
      col: index % cols,
      active: true,
      shape: topology,
      autoCapacity: true,
      capacity: topology === 'triangle' ? 3 : topology === 'hex' ? 6 : 4,
      initialEnergy: 0,
      boostDirections: [],
    }));
  const specs = bases.map((base) => {
    const saved = prior.get(keyFor(base.row, base.col));
    if (!saved) return base;
    return {
      ...base,
      active: saved.active,
      autoCapacity: saved.autoCapacity,
      capacity: saved.capacity,
      initialEnergy: saved.initialEnergy,
      boostDirections: [...saved.boostDirections],
    };
  });
  const compiled = compileCells(specs, topology);
  return {
    id: 'custom-map',
    name: '我的地图',
    subtitle: '自定义试验场',
    description: '在地图工坊中创建的自定义地图。',
    rows,
    cols,
    kind: 'custom',
    difficulty: '进阶',
    recommended: '2–6 人',
    accent: '#e8ff58',
    topology,
    geometry: compiled.geometry,
    cells: compiled.cells,
  };
}

function customMapId(slotIndex: number) {
  return `custom-map-${Math.min(CUSTOM_MAP_SLOT_COUNT - 1, Math.max(0, slotIndex)) + 1}`;
}

function cleanCustomMapName(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 24);
  return cleaned || fallback;
}

function preserveEditorIdentity(source: GameMap, rebuilt: GameMap): GameMap {
  return {
    ...rebuilt,
    id: source.id,
    name: source.name,
    subtitle: source.subtitle,
    description: source.description,
    difficulty: source.difficulty,
    recommended: source.recommended,
    accent: source.accent,
  };
}

export function createCustomMap(slotIndex: number, rows = 8, cols = 8, cells?: CellSpec[], topology?: BoardTopology, name?: string): GameMap {
  const slot = Math.min(CUSTOM_MAP_SLOT_COUNT - 1, Math.max(0, slotIndex));
  const fallbackName = `我的地图 ${slot + 1}`;
  return {
    ...createEditorMap(rows, cols, cells, topology),
    id: customMapId(slot),
    name: cleanCustomMapName(name, fallbackName),
    subtitle: `自制地图槽位 ${slot + 1}`,
    description: '在地图工坊中创建的自定义地图。',
  };
}

export function renameCustomMap(map: GameMap, name: string) {
  return { ...map, name: cleanCustomMapName(name, map.name) };
}

export function serializeCustomMap(map: GameMap): CustomMapSnapshot {
  const cells = map.cells.flatMap((cell): CustomMapCellOverride[] => {
    if (cell.active && cell.autoCapacity && cell.initialEnergy === 0 && cell.boostDirections.length === 0) return [];
    return [{
      index: cell.index,
      ...(!cell.active ? { active: false as const } : {}),
      ...(cell.active && !cell.autoCapacity ? { autoCapacity: false as const, capacity: cell.capacity } : {}),
      ...(cell.active && cell.initialEnergy > 0 ? { initialEnergy: cell.initialEnergy } : {}),
      ...(cell.active && cell.boostDirections.length > 0 ? { boostDirections: [...cell.boostDirections] } : {}),
    }];
  });
  return {
    version: 1,
    id: map.id,
    name: map.name,
    rows: map.rows,
    cols: map.cols,
    topology: map.topology,
    cells,
  };
}

function allowedBoostDirections(topology: BoardTopology) {
  return new Set(isMixedTiling(topology)
    ? ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']
    : ['U', 'R', 'D', 'L', 'UL', 'UR', 'DL', 'DR']);
}

export function deserializeCustomMap(value: unknown, slotIndex?: number): GameMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Partial<CustomMapSnapshot>;
  if (payload.version !== 1
    || !Number.isInteger(payload.rows) || (payload.rows ?? 0) < 6 || (payload.rows ?? 0) > 20
    || !Number.isInteger(payload.cols) || (payload.cols ?? 0) < 6 || (payload.cols ?? 0) > 20
    || !isBoardTopology(payload.topology)
    || !Array.isArray(payload.cells)) return null;

  const id = slotIndex === undefined ? payload.id : customMapId(slotIndex);
  if (typeof id !== 'string' || !/^custom-map-[1-4]$/.test(id)) return null;
  const rows = payload.rows as number;
  const cols = payload.cols as number;
  const topology = payload.topology as BoardTopology;
  const base = createEditorMap(rows, cols, undefined, topology);
  if (payload.cells.length > base.cells.length) return null;
  const overrides = new Map<number, CustomMapCellOverride>();
  const allowedDirections = allowedBoostDirections(topology);

  for (const raw of payload.cells) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as CustomMapCellOverride;
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= base.cells.length || overrides.has(item.index)) return null;
    if (item.active !== undefined && item.active !== false) return null;
    if (item.autoCapacity !== undefined && item.autoCapacity !== false) return null;
    if (item.capacity !== undefined && (!Number.isInteger(item.capacity) || item.capacity < 1 || item.capacity > 8)) return null;
    if (item.initialEnergy !== undefined && (!Number.isInteger(item.initialEnergy) || item.initialEnergy < 0 || item.initialEnergy > 7)) return null;
    if (item.boostDirections !== undefined && (!Array.isArray(item.boostDirections)
      || item.boostDirections.length > 8
      || new Set(item.boostDirections).size !== item.boostDirections.length
      || item.boostDirections.some((direction) => typeof direction !== 'string' || !allowedDirections.has(direction)))) return null;
    if (item.active === false && (item.autoCapacity !== undefined || item.capacity !== undefined || item.initialEnergy !== undefined || item.boostDirections !== undefined)) return null;
    if (item.autoCapacity === false && item.capacity === undefined) return null;
    if (item.autoCapacity !== false && item.capacity !== undefined) return null;
    overrides.set(item.index, item);
  }

  const specs = base.cells.map((cell): CellSpec => {
    const item = overrides.get(cell.index);
    return {
      row: cell.row,
      col: cell.col,
      active: item?.active !== false,
      shape: cell.shape,
      autoCapacity: item?.autoCapacity !== false,
      capacity: item?.autoCapacity === false ? item.capacity! : cell.capacity,
      initialEnergy: item?.initialEnergy ?? 0,
      boostDirections: item?.boostDirections ? [...item.boostDirections] : [],
      geometry: cell.geometry ? cloneGeometry(cell.geometry) : undefined,
    };
  });
  const rebuilt = createEditorMap(rows, cols, specs, topology);
  for (const [index, item] of overrides) {
    const cell = rebuilt.cells[index];
    if (!cell || (item.initialEnergy !== undefined && item.initialEnergy >= cell.capacity)) return null;
    if (item.boostDirections && (cell.boostDirections.length !== item.boostDirections.length
      || item.boostDirections.some((direction) => !cell.boostDirections.includes(direction)))) return null;
  }
  const fallbackName = slotIndex === undefined ? '自制地图' : `我的地图 ${slotIndex + 1}`;
  return {
    ...rebuilt,
    id,
    name: cleanCustomMapName(payload.name, fallbackName),
    subtitle: slotIndex === undefined ? '房主自制地图' : `自制地图槽位 ${slotIndex + 1}`,
    description: '在地图工坊中创建的自定义地图。',
  };
}

export function migrateLegacyCustomMap(value: unknown, slotIndex = 0): GameMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!Number.isInteger(payload.rows) || Number(payload.rows) < 6 || Number(payload.rows) > 20
    || !Number.isInteger(payload.cols) || Number(payload.cols) < 6 || Number(payload.cols) > 20
    || !isBoardTopology(payload.topology)
    || !Array.isArray(payload.cells)) return null;

  const rows = Number(payload.rows);
  const cols = Number(payload.cols);
  const topology = payload.topology as BoardTopology;
  const base = createEditorMap(rows, cols, undefined, topology);
  if (payload.cells.length > base.cells.length) return null;
  const allowedCoordinates = new Set(base.cells.map((cell) => keyFor(cell.row, cell.col)));
  const allowedDirections = allowedBoostDirections(topology);
  const prior = new Map<string, Record<string, unknown>>();

  for (const raw of payload.cells) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const cell = raw as Record<string, unknown>;
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col)) return null;
    const key = keyFor(Number(cell.row), Number(cell.col));
    if (!allowedCoordinates.has(key) || prior.has(key)) return null;
    prior.set(key, cell);
  }

  const specs = base.cells.map((cell): CellSpec => {
    const legacy = prior.get(keyFor(cell.row, cell.col));
    const active = legacy?.active !== false;
    const autoCapacity = legacy?.autoCapacity !== false;
    const rawCapacity = Number(legacy?.capacity);
    const capacity = autoCapacity || !Number.isInteger(rawCapacity) ? cell.capacity : Math.min(8, Math.max(1, rawCapacity));
    const rawEnergy = Number(legacy?.initialEnergy);
    const initialEnergy = active && Number.isInteger(rawEnergy) ? Math.min(Math.max(0, rawEnergy), Math.max(0, capacity - 1)) : 0;
    const boostDirections = active && Array.isArray(legacy?.boostDirections)
      ? [...new Set(legacy.boostDirections.filter((direction): direction is string => typeof direction === 'string' && allowedDirections.has(direction)))]
      : [];
    return {
      row: cell.row,
      col: cell.col,
      active,
      shape: cell.shape,
      autoCapacity,
      capacity,
      initialEnergy,
      boostDirections,
      geometry: cell.geometry ? cloneGeometry(cell.geometry) : undefined,
    };
  });
  return createCustomMap(slotIndex, rows, cols, specs, topology, payload.name as string | undefined);
}

export function resizeEditorMap(map: GameMap, rows: number, cols: number) {
  return preserveEditorIdentity(map, createEditorMap(rows, cols, map.cells, map.topology));
}

export function retileEditorMap(map: GameMap, topology: BoardTopology) {
  const changesMixedPattern = topology !== map.topology
    && (topology === 'trihex' || map.topology === 'trihex' || isMixedTiling(topology) || isMixedTiling(map.topology));
  const preserveCells = changesMixedPattern ? undefined : map.cells;
  return preserveEditorIdentity(map, createEditorMap(map.rows, map.cols, preserveCells, topology));
}

export function updateEditorCell(map: GameMap, index: number, patch: Partial<CellSpec>) {
  const specs = map.cells.map((cell, cellIndex): CellSpec => ({
    row: cell.row,
    col: cell.col,
    active: cellIndex === index ? (patch.active ?? cell.active) : cell.active,
    shape: cellIndex === index ? (patch.shape ?? cell.shape) : cell.shape,
    autoCapacity: cellIndex === index ? (patch.autoCapacity ?? cell.autoCapacity) : cell.autoCapacity,
    capacity: cellIndex === index ? (patch.capacity ?? cell.capacity) : cell.capacity,
    initialEnergy: cellIndex === index ? (patch.initialEnergy ?? cell.initialEnergy) : cell.initialEnergy,
    boostDirections: cellIndex === index ? (patch.boostDirections ?? cell.boostDirections) : cell.boostDirections,
    geometry: cell.geometry ? cloneGeometry(cell.geometry) : undefined,
  }));
  return preserveEditorIdentity(map, createEditorMap(map.rows, map.cols, specs, map.topology));
}

export function resetEditorCellToDefault(map: GameMap, index: number) {
  if (!map.cells[index]) return map;
  return updateEditorCell(map, index, {
    active: true,
    autoCapacity: true,
    initialEnergy: 0,
    boostDirections: [],
  });
}

export function resetEditorMapToDefault(map: GameMap) {
  return preserveEditorIdentity(map, createEditorMap(map.rows, map.cols, undefined, map.topology));
}

export function freshCells(map: GameMap) {
  return map.cells.map((cell) => ({
    ...cell,
    geometry: cell.geometry ? cloneGeometry(cell.geometry) : undefined,
    neighbors: [...cell.neighbors],
    boosted: [...cell.boosted],
    energy: cell.initialEnergy,
    owner: null,
  }));
}

export function isLegalMove(cell: GameCell, player: number) {
  return cell.active
    && !isPassiveSpecialCell(cell)
    && (cell.owner === player || (cell.owner === null && cell.energy === 0));
}

export function isPassiveSpecialCell(cell: GameCell) {
  return !cell.autoCapacity && cell.capacity < cell.neighbors.length;
}

export function findNextPlayablePlayer(cells: GameCell[], actor: number, playerCount: number) {
  for (let offset = 1; offset <= playerCount; offset += 1) {
    const candidate = (actor + offset) % playerCount;
    if (cells.some((cell) => isLegalMove(cell, candidate))) return candidate;
  }
  return null;
}

export function getTransferPlan(cell: GameCell) {
  const degree = cell.neighbors.length;
  if (degree === 0) return [];
  if (cell.capacity <= degree) return cell.neighbors.map((target) => ({ target, amount: 1 }));
  const base = Math.floor(cell.capacity / degree);
  let remainder = cell.capacity % degree;
  const priority = [...cell.boosted, ...cell.neighbors.filter((item) => !cell.boosted.includes(item))];
  return priority.map((target) => {
    const amount = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return { target, amount };
  });
}

export function explodeWave(cells: GameCell[], actingPlayer: number): WaveResult | null {
  const exploding = cells.filter((cell) => cell.active && cell.energy >= cell.capacity).map((cell) => cell.index);
  if (exploding.length === 0) return null;
  const afterBurst = cells.map((cell) => ({ ...cell, neighbors: [...cell.neighbors], boosted: [...cell.boosted] }));
  const transfers: Transfer[] = [];

  for (const index of exploding) {
    const source = afterBurst[index];
    source.energy -= source.capacity;
    if (source.energy === 0) source.owner = null;
    for (const item of getTransferPlan(source)) transfers.push({ source: index, target: item.target, amount: item.amount });
  }

  const afterTransfer = afterBurst.map((cell) => ({ ...cell, neighbors: [...cell.neighbors], boosted: [...cell.boosted] }));
  for (const transfer of transfers) {
    const target = afterTransfer[transfer.target];
    target.energy += transfer.amount;
    target.owner = actingPlayer;
  }

  return { exploding, afterBurst, afterTransfer, transfers };
}

export function countTerritory(cells: GameCell[], playerCount: number) {
  return Array.from({ length: playerCount }, (_, player) => cells.filter((cell) => cell.active && cell.owner === player).length);
}

export function findWinner(cells: GameCell[], playerCount: number) {
  const counts = countTerritory(cells, playerCount);
  const occupiedBy = counts.map((count, player) => ({ count, player })).filter((item) => item.count > 0);
  const activeCells = cells.filter((cell) => cell.active).length;
  return occupiedBy.length === 1 && occupiedBy[0].count > activeCells / 2 ? occupiedBy[0].player : null;
}

export function maxStableEnergy(cells: GameCell[]) {
  return cells.reduce((sum, cell) => sum + (cell.active ? Math.max(0, cell.capacity - 1) : 0), 0);
}

export function stateKey(cells: GameCell[]) {
  return cells.filter((cell) => cell.active).map((cell) => `${cell.owner ?? 'n'}:${cell.energy}`).join('|');
}

export function directionForNeighbor(cell: GameCell, neighbor: GameCell) {
  const edge = cell.neighborEdges?.[cell.neighbors.indexOf(neighbor.index)];
  if (edge !== undefined) return `E${edge}`;
  return directionFromGeometry(cell, neighbor);
}

export function edgeLabel(cell: GameCell, neighbor: GameCell) {
  const direction = directionForNeighbor(cell, neighbor);
  const legacyLabels: Record<string, string> = { U: '上', R: '右', D: '下', L: '左', UL: '左上', UR: '右上', DL: '左下', DR: '右下' };
  if (!direction.startsWith('E')) return legacyLabels[direction] ?? direction;
  const angle = Math.atan2(neighbor.geometry!.centerY - cell.geometry!.centerY, neighbor.geometry!.centerX - cell.geometry!.centerX);
  const compass = ['右', '右下', '下', '左下', '左', '左上', '上', '右上'];
  const sector = Math.round(angle / (Math.PI / 4));
  return `边 ${direction.slice(1)} · ${compass[(sector + 8) % 8]}`;
}

export function cellPolygonPoints(cell: GameCell, inset = 0) {
  const { x, y, width, height, centerX, centerY, vertices } = cell.geometry!;
  return vertices.map(([vx, vy]): [number, number] => [
    (vx + (centerX - vx) * inset - x) / width * 100,
    (vy + (centerY - vy) * inset - y) / height * 100,
  ]);
}

export function cellLayoutStyle(map: GameMap, cell: GameCell, inset = 0) {
  const geometry = cell.geometry!;
  const percent = (value: number) => `${Number(value.toFixed(4))}%`;
  return {
    left: percent(geometry.x / map.geometry.width * 100),
    top: percent(geometry.y / map.geometry.height * 100),
    width: percent(geometry.width / map.geometry.width * 100),
    height: percent(geometry.height / map.geometry.height * 100),
    clipPath: `polygon(${cellPolygonPoints(cell, inset).map(([x, y]) => `${percent(x)} ${percent(y)}`).join(', ')})`,
    transformOrigin: `${percent((geometry.centerX - geometry.x) / geometry.width * 100)} ${percent((geometry.centerY - geometry.y) / geometry.height * 100)}`,
  };
}

export type CellOrientation = 'square' | 'up' | 'down' | 'pointy' | 'flat';

export function cellOrientation(cell: GameCell): CellOrientation {
  if (cell.shape === 'square' || !cell.geometry) return 'square';
  const minY = Math.min(...cell.geometry.vertices.map(([, y]) => y));
  const epsilon = Math.max(cell.geometry.width, cell.geometry.height) * 1e-6;
  const topVertices = cell.geometry.vertices.filter(([, y]) => Math.abs(y - minY) <= epsilon).length;
  if (cell.shape === 'triangle') return topVertices === 1 ? 'up' : 'down';
  return topVertices === 1 ? 'pointy' : 'flat';
}

export function formatCellCoordinate(map: GameMap, cell: GameCell) {
  return map.topology === 'trihex' || isMixedTiling(map.topology)
    ? `晶${cell.index + 1}`
    : `${String.fromCharCode(65 + (cell.col % 26))}${map.rows - cell.row}`;
}

export function normalizedCellCenter(map: GameMap, cell: GameCell) {
  return {
    x: geometryNumber(cell.geometry?.centerX) / map.geometry.width,
    y: geometryNumber(cell.geometry?.centerY) / map.geometry.height,
  };
}

export function normalizedTransferRoute(map: GameMap, source: GameCell, target: GameCell) {
  const start = normalizedCellCenter(map, source);
  const end = normalizedCellCenter(map, target);
  const edge = sharedEdgeSegment(source, target);
  const midpoint = edge
    ? { x: (edge[0][0] + edge[1][0]) / (2 * map.geometry.width), y: (edge[0][1] + edge[1][1]) / (2 * map.geometry.height) }
    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return { start, midpoint, end };
}

function geometryNumber(value: number | undefined) {
  return typeof value === 'number' ? value : 0;
}

export function sharedEdgeSegment(first: GameCell, second: GameCell): [[number, number], [number, number]] | null {
  if (!first.geometry || !second.geometry) return null;
  const secondEdges = new Set<string>();
  for (let edge = 0; edge < second.geometry.vertices.length; edge += 1) {
    const a = second.geometry.vertices[edge];
    const b = second.geometry.vertices[(edge + 1) % second.geometry.vertices.length];
    secondEdges.add(edgeKey(a, b));
  }
  for (let edge = 0; edge < first.geometry.vertices.length; edge += 1) {
    const a = first.geometry.vertices[edge];
    const b = first.geometry.vertices[(edge + 1) % first.geometry.vertices.length];
    if (secondEdges.has(edgeKey(a, b))) return [a, b];
  }
  return null;
}

export function sharedEdgeLength(first: GameCell, second: GameCell) {
  const segment = sharedEdgeSegment(first, second);
  return segment ? Math.hypot(segment[1][0] - segment[0][0], segment[1][1] - segment[0][1]) : 0;
}

// Return a shortened shared edge, translated toward the polygon's interior.
// SVG uses the cell's actual aspect ratio, so no rotated CSS box can spill
// past a bottom/diagonal edge and be clipped by the cell mask.
export function insetSharedEdgeSegment(
  first: GameCell,
  second: GameCell,
  { endTrim = .14, insetRatio = .10 } = {},
): [[number, number], [number, number]] | null {
  const segment = sharedEdgeSegment(first, second);
  const geometry = first.geometry;
  if (!segment || !geometry) return null;
  const [a, b] = segment;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  const nx = -dy / length;
  const ny = dx / length;
  const centerDistance = nx * (geometry.centerX - midX) + ny * (geometry.centerY - midY);
  const inset = centerDistance * insetRatio;
  return [
    [a[0] + dx * endTrim + nx * inset - geometry.x, a[1] + dy * endTrim + ny * inset - geometry.y],
    [b[0] - dx * endTrim + nx * inset - geometry.x, b[1] - dy * endTrim + ny * inset - geometry.y],
  ];
}

export function boostEdgeSegments(source: GameCell, target: GameCell) {
  const outer = insetSharedEdgeSegment(source, target);
  const inner = insetSharedEdgeSegment(source, target, { endTrim: .29, insetRatio: .19 });
  return outer && inner ? { outer, inner } : null;
}

const triangleMap = createMap({
  id: 'triangle-8',
  name: '三角回廊',
  subtitle: '8 × 8 三角晶格',
  description: '每格最多连接三条边，低容量让连锁更早、更猛烈。',
  rows: 8,
  cols: 8,
  kind: 'shape',
  difficulty: '进阶',
  recommended: '2–4 人',
  accent: '#45e0e8',
  topology: 'triangle',
  shapeAt: () => 'triangle',
});

const hexMap = createMap({
  id: 'hex-7',
  name: '蜂巢反应堆',
  subtitle: '7 × 7 六边晶格',
  description: '中心格拥有六条通路，爆炸方向更多，包围也更困难。',
  rows: 7,
  cols: 7,
  kind: 'shape',
  difficulty: '进阶',
  recommended: '3–6 人',
  accent: '#ffc857',
  topology: 'hex',
  shapeAt: () => 'hex',
});

const riftMap = createMap({
  id: 'rift-9',
  name: '断层环带',
  subtitle: '9 × 9 镂空地图',
  description: '中央裂隙切断直线连锁，四枚预充能中立格只能由爆炸占领。',
  rows: 9,
  cols: 9,
  kind: 'expanded',
  difficulty: '专家',
  recommended: '3–6 人',
  accent: '#b889ff',
  activeAt: (row, col) => !((row === 4 && col >= 2 && col <= 6) || (col === 4 && row >= 2 && row <= 6)),
  customize: (spec) => ({ initialEnergy: [[1, 4], [4, 1], [4, 7], [7, 4]].some(([r, c]) => r === spec.row && c === spec.col) ? 1 : 0 }),
});

const forgeMap = createMap({
  id: 'forge-8',
  name: '偏流熔炉',
  subtitle: '8 × 8 特殊槽位',
  description: '四角偏流器向外增幅，分散的被动阀只能被连锁点燃，中央不再形成对角循环。',
  rows: 8,
  cols: 8,
  kind: 'expanded',
  difficulty: '专家',
  recommended: '2–4 人',
  accent: '#ff8b5e',
  customize: (spec) => {
    const high = [[1, 1], [1, 6], [6, 1], [6, 6]].some(([r, c]) => r === spec.row && c === spec.col);
    const low = [[2, 4], [3, 2], [4, 5], [5, 3]].some(([r, c]) => r === spec.row && c === spec.col);
    if (high) {
      const vertical = spec.row < 4 ? 'U' : 'D';
      const horizontal = spec.col < 4 ? 'L' : 'R';
      return { autoCapacity: false, capacity: 6, boostDirections: [vertical, horizontal] };
    }
    if (low) return { autoCapacity: false, capacity: 2 };
    return {};
  },
});

const triangleTideMap = createMap({
  id: 'triangle-tide-10',
  name: '三角潮汐',
  subtitle: '10 × 12 断面晶格',
  description: '中央空腔改变三角连锁路线；两侧预充能晶体与四枚被动阀会重塑攻防节奏。',
  rows: 10,
  cols: 12,
  kind: 'expanded',
  difficulty: '专家',
  recommended: '3–6 人',
  accent: '#45e0e8',
  topology: 'triangle',
  shapeAt: () => 'triangle',
  activeAt: (row, col) => ![[4, 5], [4, 6], [5, 5], [5, 6]].some(([r, c]) => r === row && c === col),
  customize: (spec) => {
    const passive = [[2, 3], [3, 8], [6, 3], [7, 8]].some(([r, c]) => r === spec.row && c === spec.col);
    const seeded = [[1, 5], [2, 9], [5, 2], [7, 5], [8, 9]].some(([r, c]) => r === spec.row && c === spec.col);
    if (passive) return { autoCapacity: false, capacity: 2 };
    if (seeded) return { initialEnergy: 1 };
    return {};
  },
});

function offsetHexDistance(row: number, col: number, centerRow: number, centerCol: number) {
  const q = col - (row - (row & 1)) / 2;
  const centerQ = centerCol - (centerRow - (centerRow & 1)) / 2;
  const dq = q - centerQ;
  const dr = row - centerRow;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const hexRingMap = createMap({
  id: 'hex-ring-9',
  name: '蜂巢环城',
  subtitle: '半径 4 六边环城',
  description: '棋盘本身呈正六边形，核心留空；六枚预充能晶体在内环形成争夺带。',
  rows: 9,
  cols: 9,
  kind: 'expanded',
  difficulty: '进阶',
  recommended: '3–6 人',
  accent: '#ffc857',
  topology: 'hex',
  shapeAt: () => 'hex',
  activeAt: (row, col) => {
    const distance = offsetHexDistance(row, col, 4, 4);
    return distance <= 4 && distance !== 0;
  },
  customize: (spec) => ({ initialEnergy: offsetHexDistance(spec.row, spec.col, 4, 4) === 2 && (spec.row + spec.col) % 2 === 0 ? 1 : 0 }),
});

const quadrantGateMap = createMap({
  id: 'quadrant-gates-11',
  name: '四象闸阵',
  subtitle: '11 × 11 分区战场',
  description: '十字断墙把战场分成四区，只能通过四枚被动金闸跨区扩张。',
  rows: 11,
  cols: 11,
  kind: 'expanded',
  difficulty: '专家',
  recommended: '4–6 人',
  accent: '#ff7ab8',
  activeAt: (row, col) => {
    const horizontalWall = row === 5 && ![1, 9].includes(col);
    const verticalWall = col === 5 && ![1, 9].includes(row);
    return !(horizontalWall || verticalWall);
  },
  customize: (spec) => {
    const gate = [[1, 5], [5, 1], [5, 9], [9, 5]].some(([r, c]) => r === spec.row && c === spec.col);
    const amplifier = [[2, 2], [2, 8], [8, 2], [8, 8]].some(([r, c]) => r === spec.row && c === spec.col);
    if (gate) return { autoCapacity: false, capacity: 1 };
    if (amplifier) return { autoCapacity: false, capacity: 6, boostDirections: spec.row < 5 ? ['U', 'D'] : ['L', 'R'] };
    return {};
  },
});

interface TrihexMapOptions {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  rows: number;
  cols: number;
  difficulty: GameMap['difficulty'];
  recommended: string;
  accent: string;
  customize?: (spec: CellSpec) => Partial<CellSpec>;
}

function createTrihexMap(options: TrihexMapOptions): GameMap {
  const { customize, ...metadata } = options;
  const specs = createTrihexSpecs(options.rows, options.cols).map((spec) => ({ ...spec, ...customize?.(spec) }));
  const compiled = compileCells(specs, 'trihex');
  return {
    ...metadata,
    kind: 'mixed',
    topology: 'trihex',
    geometry: compiled.geometry,
    cells: compiled.cells,
  };
}

const mixedMap = createTrihexMap({
  id: 'prism-7',
  name: '棱镜拼图',
  subtitle: '三角 × 六边密铺',
  description: '等边三角与正六边形共边咬合，所有传递都沿真实边界发生。',
  rows: 5,
  cols: 5,
  difficulty: '专家',
  recommended: '2–5 人',
  accent: '#3ed598',
});

const prismPulseMap = createTrihexMap({
  id: 'prism-pulse-6',
  name: '脉冲棱镜',
  subtitle: '三六角门阵',
  description: '三枚六边被动阀与预充能三角晶体交错出现，争夺共边传递的启动权。',
  rows: 6,
  cols: 6,
  difficulty: '专家',
  recommended: '3–6 人',
  accent: '#9f8cff',
  customize: (spec) => {
    const passiveHex = spec.shape === 'hex' && [[2, 4], [6, 8], [8, 2]].some(([r, c]) => r === spec.row && c === spec.col);
    const seededTriangle = spec.shape === 'triangle' && (spec.row * 3 + spec.col) % 11 === 0;
    if (passiveHex) return { autoCapacity: false, capacity: 3 };
    if (seededTriangle) return { initialEnergy: 1 };
    return {};
  },
});

function createMixedMap(topology: MixedTiling, options: Omit<TrihexMapOptions, 'customize'>): GameMap {
  return { ...createEditorMap(options.rows, options.cols, undefined, topology), ...options, kind: 'mixed' };
}

const archimedeanMaps = [
  createMixedMap('3.4.6.4', {
    id: 'hexweave',
    name: '六角织城',
    subtitle: '3.4.6.4 · 三角、方格、六边形',
    description: '正方格从六边形的六侧伸出，三角格填在交汇处。争夺通往多个六边形的桥接格。',
    rows: 5, cols: 5, difficulty: '专家', recommended: '3–6 人', accent: '#52d2b1',
  }),
  createMixedMap('3.3.3.4.4', {
    id: 'terrace',
    name: '长阶回廊',
    subtitle: '3.3.3.4.4 · 方格带与三角带',
    description: '方格成排延伸，三角格在排间交错。沿横排铺开，再从三角带切入相邻一排。',
    rows: 6, cols: 8, difficulty: '进阶', recommended: '2–4 人', accent: '#65afff',
  }),
  createMixedMap('3.3.4.3.4', {
    id: 'rotor',
    name: '旋方阵列',
    subtitle: '3.3.4.3.4 · 交错旋方',
    description: '两种朝向的方格交错排列，三角格把连锁引向斜侧和下一组方格。',
    rows: 5, cols: 5, difficulty: '专家', recommended: '3–6 人', accent: '#b69aff',
  }),
  createMixedMap('3.3.3.3.6', {
    id: 'star-ring',
    name: '扭棱星环',
    subtitle: '3.3.3.3.6 · 六边形与三角网',
    description: '六边格分布在三角网中。三角格容易触发连锁，六边格蓄满后可向六个方向传递。',
    rows: 8, cols: 9, difficulty: '专家', recommended: '2–5 人', accent: '#ff9e6e',
  }),
];

const originalOfficialMaps: GameMap[] = [
  createClassicMap(6),
  createClassicMap(10),
  createClassicMap(20),
  triangleMap,
  hexMap,
  riftMap,
  forgeMap,
  mixedMap,
  triangleTideMap,
  hexRingMap,
  quadrantGateMap,
  prismPulseMap,
  ...archimedeanMaps,
];

// Restrict this trim to curated boards. Custom maps keep their chosen outline.
function trimOfficialMap(map: GameMap, id: string, includes: (cell: GameCell) => boolean = () => true): GameMap {
  const candidates = map.cells.filter(includes);
  const retained = new Set(candidates.filter((cell) => cell.active).map((cell) => cell.index));
  const neighborCount = (cell: GameCell) => cell.neighbors.filter((index) => retained.has(index)).length;
  const pending = candidates.filter((cell) => cell.active && neighborCount(cell) < 2);
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const leaf = pending[cursor];
    if (!retained.delete(leaf.index)) continue;
    for (const index of leaf.neighbors) {
      const neighbor = map.cells[index];
      if (retained.has(index) && neighborCount(neighbor) < 2) pending.push(neighbor);
    }
  }
  const specs = candidates
    .filter((cell) => !cell.active || retained.has(cell.index))
    .map(({ row, col, active, shape, autoCapacity, capacity, initialEnergy, boostDirections, geometry }) =>
      ({ row, col, active, shape, autoCapacity, capacity, initialEnergy, boostDirections, geometry }));
  return { ...map, ...compileCells(specs, map.topology), id };
}

function resizeOfficialTiling(map: GameMap, rows: number, cols: number): GameMap {
  const { cells, geometry } = createEditorMap(rows, cols, undefined, map.topology);
  return { ...map, rows, cols, cells, geometry, recommended: '2–4 人' };
}

const compactTerrace = resizeOfficialTiling(archimedeanMaps[1], 4, 6);
const compactRotor = resizeOfficialTiling(archimedeanMaps[2], 4, 4);
const revisedOfficialMaps = new Map([
  [triangleMap.id, trimOfficialMap(triangleMap, 'triangle-8-v2')],
  [mixedMap.id, trimOfficialMap(mixedMap, 'prism-7-v2')],
  [triangleTideMap.id, trimOfficialMap(triangleTideMap, 'triangle-tide-10-v2')],
  [prismPulseMap.id, trimOfficialMap(prismPulseMap, 'prism-pulse-6-v2')],
  [compactTerrace.id, trimOfficialMap(compactTerrace, 'terrace-v2')],
  [compactRotor.id, trimOfficialMap(compactRotor, 'rotor-v2')],
  [archimedeanMaps[3].id, trimOfficialMap(archimedeanMaps[3], 'star-ring-v2')],
]);

const crossingMap = createMap({
  id: 'three-crossings',
  name: '三路竞渡',
  subtitle: '单排中桥 · 双排侧桥',
  description: '中路两槽格容易发动，侧路有更多空间蓄能。三条桥都能把连锁送过河，也能把能量送回对岸。',
  rows: 9,
  cols: 11,
  kind: 'expanded',
  difficulty: '进阶',
  recommended: '2–4 人',
  accent: '#58cadd',
  activeAt: (row, col) => col < 4 || col > 6 || [1, 2, 4, 6, 7].includes(row),
});

function createThreeCoreMap(): GameMap {
  const base = createEditorMap(13, 13, undefined, '3.3.3.3.6');
  const hubKeys = new Set([keyFor(3, 20), keyFor(5, 32), keyFor(9, 14)]);
  const hubs = base.cells.filter((cell) => hubKeys.has(cell.id)).map((cell) => cell.geometry!);
  const includes = ({ geometry }: GameCell) => {
    const { centerX: x, centerY: y } = geometry!;
    return hubs.some((hub, index) => {
      const offsetX = x - hub.centerX;
      const offsetY = y - hub.centerY;
      if (Math.hypot(offsetX, offsetY) <= 2.1) return true;
      const next = hubs[(index + 1) % hubs.length];
      const dx = next.centerX - hub.centerX;
      const dy = next.centerY - hub.centerY;
      const along = (offsetX * dx + offsetY * dy) / (dx * dx + dy * dy);
      return along >= 0 && along <= 1
        && Math.hypot(offsetX - along * dx, offsetY - along * dy) <= 1.05;
    });
  };
  return trimOfficialMap({
    ...base,
    name: '三核共振',
    subtitle: '预充能六边枢纽 · 三角环带',
    description: '三枚六槽枢纽各预充两点，需要从周围三角格发动连锁才能解锁。夺下一核后，可以沿环带争夺第二核。',
    kind: 'mixed',
    difficulty: '进阶',
    recommended: '2–4 人',
    accent: '#cc9bfa',
    cells: base.cells.map((cell) => hubKeys.has(cell.id) ? { ...cell, initialEnergy: 2 } : cell),
  }, 'three-core', includes);
}

const crookedBayMap = createMap({
  id: 'crooked-bay',
  name: '歧湾战场',
  subtitle: '不对称海湾 · 两条跨湾通路',
  description: '西岸短小，北端有低容量岬角。东岸沿南北展开，藏有两枚预充能晶体。上方宽口便于蓄能，下方窄道容易接起连锁。',
  rows: 9,
  cols: 10,
  kind: 'expanded',
  difficulty: '进阶',
  recommended: '2–4 人',
  accent: '#65c6a8',
  activeAt: (row, col) => {
    if (col < 4) return (row >= 2 && row <= 6) || (row < 2 && (col === 1 || col === 2));
    if (col < 6) return row === 2 || row === 3 || row === 5;
    return row > 0 || col < 8;
  },
  customize: ({ row, col }) => ({
    initialEnergy: (row === 2 && col === 7) || (row === 6 && col === 8) ? 2 : 0,
  }),
});

function createRefractionMap(): GameMap {
  const base = createEditorMap(4, 4, undefined, '3.4.6.4');
  const routes = new Map([
    ['0:15', '0:11'],
    ['2:9', '2:4'],
  ]);
  const valves = new Set(routes.values());
  const charged = new Set(['1:7', '2:1']);
  const specs = base.cells.map((cell): CellSpec => {
    const valveId = routes.get(cell.id);
    if (valveId) {
      const valve = base.cells.find((target) => target.id === valveId)!;
      // Use the shared edge of the rotated tile, not a compass direction.
      return { ...cell, autoCapacity: false, capacity: 5, boostDirections: [directionForNeighbor(cell, valve)] };
    }
    if (valves.has(cell.id)) return { ...cell, autoCapacity: false, capacity: 2 };
    if (charged.has(cell.id)) return { ...cell, initialEnergy: cell.capacity - 1 };
    return cell;
  });
  return {
    ...base,
    ...compileCells(specs, base.topology),
    id: 'refraction-valves',
    name: '折光阀阵',
    subtitle: '3.4.6.4 · 定向增幅与被动阀',
    description: '五槽方格沿金边送出两点，足以打开相邻的二槽三角阀。阀门会把能量分给周围格子，还能点燃临界的预充能方格。',
    kind: 'mixed',
    difficulty: '专家',
    recommended: '2–4 人',
    accent: '#ffad7c',
  };
}

const quickCourtyard = createMap({
  id: 'quick-courtyard',
  name: '方寸庭',
  subtitle: '双人短局 · 中央留空',
  description: '四个切角压缩开局空间，中央空格把传播引向两侧。适合两人打一场短局。',
  rows: 5,
  cols: 5,
  kind: 'expanded',
  difficulty: '入门',
  recommended: '2 人',
  accent: '#d3db75',
  activeAt: (row, col) => Math.abs(row - 2) + Math.abs(col - 2) <= 3 && (row !== 2 || col !== 2),
});

const doubleRing = createMap({
  id: 'double-ring',
  name: '双环回路',
  subtitle: '两层环带 · 四处接口',
  description: '沿外环铺开，或经四处接口把攻势转入内环。接口两端都能蓄能，抢先发动时也要留意对侧的反击。',
  rows: 12,
  cols: 12,
  kind: 'expanded',
  difficulty: '进阶',
  recommended: '3–6 人',
  accent: '#82c4ef',
  activeAt: (row, col) => {
    const rim = Math.min(row, col, 11 - row, 11 - col);
    const inInnerRing = rim === 4;
    const onConnector = [5, 6].includes(row) || [5, 6].includes(col);
    return rim < 2 || inInnerRing || (rim < 4 && onConnector);
  },
});

const crookedDistricts = createMap({
  id: 'three-districts',
  name: '错岸三城',
  subtitle: '不对称三区 · 单槽被动闸',
  description: '西北小城与东北长城之间有一枚单槽被动闸。南部开口更宽，从那里可以绕开金闸，把连锁送往两座北城。',
  rows: 10,
  cols: 11,
  kind: 'expanded',
  difficulty: '专家',
  recommended: '3–5 人',
  accent: '#ef879b',
  activeAt: (row, col) => {
    if (row < 4) return col < 4 || col >= 5 || (row === 1 && col === 4);
    if (row === 4) return col >= 6;
    if (row === 5) return [1, 2, 7, 8].includes(col);
    if (row === 6) return col >= 1 && col <= 8;
    return col >= 1 && col <= 9;
  },
  customize: ({ row, col }) => {
    if (row === 1 && col === 4) return { autoCapacity: false, capacity: 1 };
    if (row === 8 && col === 6) return { initialEnergy: 2 };
    return {};
  },
});

function addOfficialSpecialCells(
  map: GameMap,
  settings: Record<string, { capacity?: number; initialEnergy?: number; boostTo?: string[] }>,
): GameMap {
  const specs = map.cells.map((cell): CellSpec => {
    const setting = settings[cell.id];
    if (!setting) return cell;
    const boostDirections = setting.boostTo?.map((id) => {
      const neighbor = cell.neighbors.map((index) => map.cells[index]).find((candidate) => candidate.id === id);
      if (!neighbor) throw new Error(`Invalid official map boost: ${map.id} ${cell.id} → ${id}`);
      return directionForNeighbor(cell, neighbor);
    });
    return {
      ...cell,
      autoCapacity: setting.capacity === undefined && cell.autoCapacity,
      capacity: setting.capacity ?? cell.capacity,
      initialEnergy: setting.initialEnergy ?? cell.initialEnergy,
      boostDirections: boostDirections ?? cell.boostDirections,
    };
  });
  return { ...map, ...compileCells(specs, map.topology) };
}

const crossCurrent = addOfficialSpecialCells(trimOfficialMap(createMixedMap('3.3.3.4.4', {
  id: 'cross-current',
  name: '横潮梯',
  subtitle: '3.3.3.4.4 · 反向强化带',
  description: '上方两枚五槽方格向右强化，下方两枚向左强化。沿方格带推进，也可以借中间的三角格换排，从另一侧接续连锁。',
  rows: 4, cols: 5, difficulty: '进阶', recommended: '2–4 人', accent: '#80c3d7',
}), 'cross-current'), {
  '1:3': { capacity: 5, boostTo: ['1:6'] },
  '1:6': { capacity: 5, boostTo: ['1:9'] },
  '3:6': { capacity: 5, boostTo: ['3:3'] },
  '3:9': { capacity: 5, boostTo: ['3:6'] },
});

const confluenceChamber = addOfficialSpecialCells(trimOfficialMap(createMixedMap('3.3.4.3.4', {
  id: 'confluence-chamber',
  name: '合流闸室',
  subtitle: '3.3.4.3.4 · 双路触发',
  description: '两座空的二槽三角阀连接各自两侧的旋转方格。普通爆炸一次只送一点，阀要等两股能量汇合才会打开。先送进一点，也可能给对手留下机会。',
  rows: 4, cols: 5, difficulty: '专家', recommended: '2–4 人', accent: '#e9ab68',
}), 'confluence-chamber'), {
  '1:9': { capacity: 2 },
  '2:23': { capacity: 2 },
});

const offCenterFurnace = addOfficialSpecialCells(trimOfficialMap(createMixedMap('3.3.3.3.6', {
  id: 'off-center-furnace',
  name: '偏心炉',
  subtitle: '3.3.3.3.6 · 单核双向增幅',
  description: '偏向右侧的八槽大炉开局已蓄四点，两条金边分别对着不同的三角格。先从外围解锁，才有机会用一次爆炸同时带起两路攻势。',
  rows: 7, cols: 8, difficulty: '专家', recommended: '2–4 人', accent: '#f39472',
}), 'off-center-furnace'), {
  '3:20': { capacity: 8, initialEnergy: 4, boostTo: ['2:21', '4:15'] },
  '2:21': { initialEnergy: 1 },
  '4:15': { initialEnergy: 1 },
});

export const MAP_LIBRARY: GameMap[] = [
  ...originalOfficialMaps.slice(0, 3),
  crossingMap,
  createThreeCoreMap(),
  crookedBayMap,
  createRefractionMap(),
  quickCourtyard,
  doubleRing,
  crookedDistricts,
  crossCurrent,
  confluenceChamber,
  offCenterFurnace,
  ...originalOfficialMaps.slice(3).map((map) => revisedOfficialMaps.get(map.id) ?? map),
];

export function findOfficialMap(id: string): GameMap | undefined {
  return MAP_LIBRARY.find((map) => map.id === id) ?? originalOfficialMaps.find((map) => map.id === id);
}

export function validateMap(map: GameMap, playerCount = 2) {
  const warnings: string[] = [];
  const active = map.cells.filter((cell) => cell.active);
  const isolated = active.filter((cell) => cell.neighbors.length === 0);
  const seededAtLimit = active.filter((cell) => cell.initialEnergy >= cell.capacity);
  const openNeutral = active.filter((cell) => cell.initialEnergy === 0 && !isPassiveSpecialCell(cell)).length;
  const invalidBoosts = active.filter((cell) => {
    if (cell.capacity <= cell.neighbors.length || cell.neighbors.length === 0) return false;
    const remainder = cell.capacity % cell.neighbors.length;
    return remainder > 0 && cell.boosted.length !== remainder;
  });
  if (active.length < 4) warnings.push('至少需要 4 个可用格子');
  if (openNeutral < playerCount) warnings.push(`至少需要 ${playerCount} 个全空中立格，确保每位玩家都能入场`);
  if (isolated.length) warnings.push(`${isolated.length} 个格子没有任何相邻连接`);
  if (active.length > 0) {
    const visited = new Set<number>();
    const pending = [active[0].index];
    while (pending.length > 0) {
      const index = pending.pop()!;
      if (visited.has(index)) continue;
      visited.add(index);
      for (const neighbor of map.cells[index].neighbors) if (!visited.has(neighbor)) pending.push(neighbor);
    }
    if (visited.size !== active.length) warnings.push(`地图被分成多个互不相邻的区域（${visited.size}/${active.length} 格连通）`);
  }
  if (seededAtLimit.length) warnings.push(`${seededAtLimit.length} 个预充能格已达到爆炸上限`);
  if (invalidBoosts.length) warnings.push(`${invalidBoosts.length} 个特殊格的强化边数量与余数能量不一致`);
  return warnings;
}
