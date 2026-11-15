import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIBRARY, boostEdgeSegments, createCustomMap, insetSharedEdgeSegment, sharedEdgeSegment, updateEditorCell } from '../lib/explosion-game.ts';
import { energySlotLayout } from '../lib/energy-layout.ts';
import { MIXED_TILINGS } from '../lib/mixed-tilings.ts';

function inside(point, geometry) {
  let positive = false, negative = false;
  const [x, y] = [point[0] + geometry.x, point[1] + geometry.y];
  for (let edge = 0; edge < geometry.vertices.length; edge += 1) {
    const a = geometry.vertices[edge], b = geometry.vertices[(edge + 1) % geometry.vertices.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cross > 1e-8) positive = true;
    if (cross < -1e-8) negative = true;
  }
  return !(positive && negative);
}

test('各密铺的双线平行于真实强化边，且槽位在内线的中心侧', () => {
  const topologies = ['square', 'triangle', 'hex', 'trihex', ...MIXED_TILINGS];
  const maps = [...MAP_LIBRARY, ...topologies.map((topology) => createCustomMap(0, 6, 6, undefined, topology))];
  let checked = 0;
  for (const map of maps) {
    for (const cell of map.cells) {
      const slots = energySlotLayout(cell);
      for (const neighbor of cell.neighbors) {
        const marks = boostEdgeSegments(cell, map.cells[neighbor]);
        const original = sharedEdgeSegment(cell, map.cells[neighbor]);
        assert.ok(marks && original);
        const { outer, inner } = marks;
        const ox = original[1][0] - original[0][0], oy = original[1][1] - original[0][1];
        const length = (line) => Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
        const distanceToBoundary = ([x, y]) => {
          return Math.abs(ox * (y + cell.geometry.y - original[0][1])
            - oy * (x + cell.geometry.x - original[0][0])) / Math.hypot(ox, oy);
        };
        for (const line of [outer, inner]) {
          assert.ok(line.every((point) => inside(point, cell.geometry)), `${map.id}/${cell.index}/${neighbor}`);
          const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1];
          assert.ok(Math.abs(dx * oy - dy * ox) < 1e-8);
        }
        assert.ok(length(inner) < length(outer) && length(outer) < length(original));
        const innerDistance = distanceToBoundary(inner[0]);
        const outerDistance = distanceToBoundary(outer[0]);
        assert.ok(innerDistance > outerDistance);
        assert.ok(innerDistance - outerDistance < .12 * Math.min(cell.geometry.width, cell.geometry.height));
        for (const { x1, y1, x2, y2 } of slots.segments) {
          const slotDistance = Math.min(distanceToBoundary([x1, y1]), distanceToBoundary([x2, y2]));
          assert.ok(slotDistance - slots.strokeWidth / 2 > innerDistance, `${map.id}/${cell.index}/${neighbor}`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 600);
});

test('方格六种双强化组合包含左下边，底边不再位于y=100%之外', () => {
  const combinations = [['U','R'],['U','D'],['U','L'],['R','D'],['R','L'],['D','L']];
  for (const directions of combinations) {
    const map = updateEditorCell(createCustomMap(0, 6, 6), 7, { autoCapacity: false, capacity: 6, boostDirections: directions });
    const cell = map.cells[7];
    assert.equal(cell.boosted.length, 2);
    for (const neighbor of cell.boosted) {
      const edge = insetSharedEdgeSegment(cell, map.cells[neighbor]);
      assert.ok(edge.every(([x, y]) => x > 0 && x < cell.geometry.width && y > 0 && y < cell.geometry.height));
    }
  }
});
