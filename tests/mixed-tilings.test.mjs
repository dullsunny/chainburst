import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAP_LIBRARY,
  createCustomMap,
  deserializeCustomMap,
  directionForNeighbor,
  explodeWave,
  freshCells,
  getTransferPlan,
  normalizedTransferRoute,
  resizeEditorMap,
  serializeCustomMap,
  sharedEdgeSegment,
  updateEditorCell,
  validateMap,
} from '../lib/explosion-game.ts';
import { MIXED_TILINGS } from '../lib/mixed-tilings.ts';

function vertexKey([x, y]) {
  return [x, y].map((coordinate) => Math.round(coordinate * 100_000_000)).join(',');
}

function matchesCycle(actual, expected) {
  return actual.length === expected.length && expected.some((_, start) =>
    actual.every((sides, index) => sides === expected[(start + index) % expected.length])
    || actual.every((sides, index) => sides === expected[(start - index + expected.length) % expected.length]));
}

function checkGeometry(map) {
  const edges = new Map();
  const vertices = new Map();
  for (const cell of map.cells) {
    const points = cell.geometry.vertices;
    assert.equal(cell.capacity, cell.neighbors.length, cell.id);
    assert.ok(cell.capacity > 0, cell.id);
    assert.equal(new Set(cell.neighborEdges).size, cell.neighbors.length, cell.id);
    for (const [index, point] of points.entries()) {
      const next = points[(index + 1) % points.length];
      assert.ok(Math.abs(Math.hypot(next[0] - point[0], next[1] - point[1]) - 1) < 1e-9, cell.id);
      const firstKey = vertexKey(point);
      const nextKey = vertexKey(next);
      const key = [firstKey, nextKey].sort().join('|');
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ cell, index, firstKey, nextKey });
      if (!vertices.has(firstKey)) vertices.set(firstKey, { point, cells: [] });
      vertices.get(firstKey).cells.push(cell);
    }
  }

  const boundary = new Set();
  const physicalAdjacency = map.cells.map(() => []);
  for (const [key, owners] of edges) {
    assert.ok(owners.length <= 2, key);
    if (owners.length === 1) {
      boundary.add(owners[0].firstKey);
      boundary.add(owners[0].nextKey);
      continue;
    }
    const [first, second] = owners;
    physicalAdjacency[first.cell.index].push(second.cell.index);
    physicalAdjacency[second.cell.index].push(first.cell.index);
    assert.equal(directionForNeighbor(first.cell, second.cell), `E${first.index + 1}`);
    assert.equal(directionForNeighbor(second.cell, first.cell), `E${second.index + 1}`);
  }
  for (const cell of map.cells) {
    assert.deepEqual(cell.neighbors, physicalAdjacency[cell.index].sort((a, b) => a - b), cell.id);
  }

  let interiorCount = 0;
  const expected = map.topology.split('.').map(Number);
  for (const [key, { point: [x, y], cells }] of vertices) {
    if (boundary.has(key)) continue;
    const angle = ({ geometry }) => Math.atan2(geometry.centerY - y, geometry.centerX - x);
    const actual = cells.sort((a, b) => angle(a) - angle(b)).map((cell) => cell.geometry.vertices.length);
    assert.ok(matchesCycle(actual, expected), `${key}: ${actual.join('.')}`);
    interiorCount += 1;
  }
  assert.ok(interiorCount > 10, 'finite sample must contain interior vertices');

  const connected = new Set([0]);
  for (const index of connected) {
    for (const neighbor of map.cells[index].neighbors) connected.add(neighbor);
  }
  assert.equal(connected.size, map.cells.length, 'all tiles must connect through shared edges');
}

for (const topology of MIXED_TILINGS) {
  test(`${topology} 有可开局的官图，动画途经每条传递共边的中点`, () => {
    const map = MAP_LIBRARY.find((item) => item.topology === topology);
    assert.ok(map);
    assert.deepEqual(validateMap(map, 6), []);
    for (const cell of map.cells) {
      for (const index of cell.neighbors) {
        const neighbor = map.cells[index];
        const [[x1, y1], [x2, y2]] = sharedEdgeSegment(cell, neighbor);
        const { midpoint } = normalizedTransferRoute(map, cell, neighbor);
        assert.ok(Math.abs(midpoint.x * map.geometry.width - (x1 + x2) / 2) < 1e-9);
        assert.ok(Math.abs(midpoint.y * map.geometry.height - (y1 + y2) / 2) < 1e-9);
      }
    }
  });

  test(`${topology} 在非方尺寸和 20×20 均按真实共边连通，内部顶点排列正确`, () => {
    for (const [rows, cols] of [[6, 7], [20, 20]]) {
      checkGeometry(createCustomMap(0, rows, cols, undefined, topology));
    }
  });

  test(`${topology} 的斜向加强边在存档、扩图和爆炸时指向同一共边`, () => {
    const base = createCustomMap(0, 7, 7, undefined, topology);
    const diagonalTarget = (cell) => cell.neighbors.find((index) => {
      const [[x1, y1], [x2, y2]] = sharedEdgeSegment(cell, base.cells[index]);
      return Math.abs(x1 - x2) > 1e-9 && Math.abs(y1 - y2) > 1e-9;
    });
    const interior = base.cells.filter((cell) => cell.neighbors.length === cell.geometry.vertices.length);
    const source = interior.find((cell) => cell.shape === 'square' && diagonalTarget(cell) !== undefined)
      ?? interior.find((cell) => diagonalTarget(cell) !== undefined);
    assert.ok(source);
    const diagonal = diagonalTarget(source);
    const targets = [diagonal, source.neighbors.find((index) => index !== diagonal)];
    const directions = targets.map((index) => directionForNeighbor(source, base.cells[index]));
    assert.notEqual(directions[0], directions[1]);
    const edited = updateEditorCell(base, source.index, {
      autoCapacity: false,
      capacity: source.capacity + 2,
      initialEnergy: 1,
      boostDirections: directions,
    });
    const serialized = JSON.parse(JSON.stringify(serializeCustomMap(edited)));
    assert.deepEqual(serialized.cells[0].boostDirections, directions);
    const restored = deserializeCustomMap(serialized);
    assert.ok(restored);
    const cells = freshCells(restored);
    const restoredSource = cells[source.index];
    assert.equal(restoredSource.energy, 1);
    restoredSource.energy = restoredSource.capacity;
    const wave = explodeWave(cells, 1);
    assert.deepEqual(wave.exploding, [source.index]);
    for (const { source: from, target, amount } of wave.transfers) {
      assert.equal(from, source.index);
      assert.ok(sharedEdgeSegment(cells[from], cells[target]));
      assert.equal(amount, targets.includes(target) ? 2 : 1);
      assert.equal(wave.afterTransfer[target].energy, amount);
    }
    assert.equal(wave.transfers.length, source.neighbors.length);

    const resized = resizeEditorMap(restored, 8, 9);
    const resizedSource = resized.cells.find((cell) => cell.id === source.id);
    assert.deepEqual(resizedSource.boostDirections, directions);
    const enlargedTargets = getTransferPlan(resizedSource)
      .filter(({ amount }) => amount === 2).map(({ target }) => resized.cells[target].id).sort();
    assert.deepEqual(enlargedTargets, targets.map((index) => base.cells[index].id).sort());

    const holed = updateEditorCell(restored, diagonal, { active: false });
    const holedSource = holed.cells[source.index];
    assert.ok(!holedSource.neighbors.includes(diagonal));
    assert.ok(!holedSource.boostDirections.includes(directions[0]));
    assert.equal(directionForNeighbor(holedSource, holed.cells[targets[1]]), directions[1]);
    assert.equal(deserializeCustomMap({
      ...serialized,
      cells: [{ ...serialized.cells[0], boostDirections: ['E7'] }],
    }), null);
  });
}
