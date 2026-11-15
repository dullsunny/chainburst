import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIBRARY, createCustomMap } from '../lib/explosion-game.ts';
import { energyOrbLayout, energySlotLayout } from '../lib/energy-layout.ts';

test('184格三六密铺自制地图具备1–8粒完整几何布局，供放大视图显示', () => {
  const map = createCustomMap(1, 9, 8, undefined, 'trihex', '我的地图 2');
  assert.equal(map.cells.length, 184);
  assert.equal(map.cells.filter((cell) => cell.shape === 'hex').length, 72);
  for (const cell of map.cells) {
    for (let energy = 1; energy <= 8; energy += 1) assert.equal(energyOrbLayout({ ...cell, energy }).length, energy);
  }
});

test('槽位跟随实际多边形边缘并保留圆头间隔', () => {
  const cells = MAP_LIBRARY.flatMap((map) => map.cells.filter((cell) => cell.active));
  assert.ok(cells.length > 0);
  for (const cell of cells) {
    const { x, y, centerX, centerY, vertices } = cell.geometry;
    for (const capacity of [1, cell.capacity, 8]) {
      const { strokeWidth, segments } = energySlotLayout({ ...cell, capacity });
      assert.equal(segments.length, capacity);
      assert.ok(strokeWidth > 0);
      for (const [index, { x1, y1, x2, y2 }] of segments.entries()) {
        const followsAnEdge = vertices.some(([ax, ay], edge) => {
          const [bx, by] = vertices[(edge + 1) % vertices.length];
          return Math.abs((x2 - x1) * (by - ay) - (y2 - y1) * (bx - ax)) < 1e-9;
        });
        assert.ok(followsAnEdge, cell.id);
        for (const [px, py] of [[x + x1, y + y1], [x + x2, y + y2]]) {
          for (const [edge, [ax, ay]] of vertices.entries()) {
            const [bx, by] = vertices[(edge + 1) % vertices.length];
            const signed = (pointX, pointY) => (bx - ax) * (pointY - ay) - (by - ay) * (pointX - ax);
            assert.ok(signed(px, py) * signed(centerX, centerY) > 0, cell.id);
            assert.ok(Math.abs(signed(px, py)) / Math.hypot(bx - ax, by - ay) > strokeWidth / 2, cell.id);
          }
        }
        const next = segments[index + 1];
        if (next) assert.ok(Math.hypot(next.x1 - x2, next.y1 - y2) > strokeWidth, cell.id);
      }
    }
  }
});

test('方格槽位靠下，倒三角槽位靠上，倾斜方格的槽位随边倾斜', () => {
  const square = createCustomMap(1, 6, 6, undefined, 'square').cells[0];
  const inverted = createCustomMap(1, 6, 6, undefined, 'triangle').cells[1];
  const tilted = createCustomMap(1, 6, 6, undefined, '3.3.4.3.4').cells.find((cell) =>
    cell.shape === 'square' && cell.geometry.height > 1.1);
  assert.ok(tilted);
  for (const [cell, side] of [[square, 1], [inverted, -1]]) {
    const { segments: [segment] } = energySlotLayout(cell);
    assert.ok(Math.abs(segment.y2 - segment.y1) < 1e-9);
    assert.ok(side * (segment.y1 + cell.geometry.y - cell.geometry.centerY) > 0);
  }
  const { segments: [segment] } = energySlotLayout(tilted);
  assert.ok(Math.abs(segment.y2 - segment.y1) > 1e-3);
});

test('所有形状的1–8粒棋子均为不重叠圆形，并完整处于多边形内', () => {
  const cells = [...MAP_LIBRARY.flatMap((map) => map.cells), ...createCustomMap(1, 9, 8, undefined, 'trihex').cells];
  for (const cell of cells) {
    const g = cell.geometry;
    for (let energy = 1; energy <= 8; energy += 1) {
      const pips = energyOrbLayout({ ...cell, energy }).map((pip) => ({
        x: g.x + pip.left / 100 * g.width,
        y: g.y + pip.top / 100 * g.height,
        r: pip.width / 100 * g.width / 2,
        ry: pip.height / 100 * g.height / 2,
      }));
      for (const [index, pip] of pips.entries()) {
        assert.ok(Math.abs(pip.r - pip.ry) < 1e-9);
        for (let edge = 0; edge < g.vertices.length; edge += 1) {
          const [ax, ay] = g.vertices[edge], [bx, by] = g.vertices[(edge + 1) % g.vertices.length];
          const signed = (x, y) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
          assert.ok(signed(pip.x, pip.y) * signed(g.centerX, g.centerY) > 0);
          const distance = Math.abs(signed(pip.x, pip.y)) / Math.hypot(bx - ax, by - ay);
          assert.ok(distance > pip.r, `${cell.shape}/${energy}: pip crosses edge`);
        }
        for (const other of pips.slice(index + 1)) assert.ok(Math.hypot(pip.x - other.x, pip.y - other.y) > pip.r + other.r - 1e-9);
      }
    }
  }
});
