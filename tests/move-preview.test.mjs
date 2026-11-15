import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIBRARY, createCustomMap, freshCells, isLegalMove } from '../lib/explosion-game.ts';
import { createMatchSnapshot, hydrateMatchCells, resolveTurn } from '../lib/match-engine.ts';
import { calculateMovePreview, compactEnergyView } from '../lib/move-preview.ts';

test('预览完整遵守真实连锁和双步规则，同时绝不改变输入棋局', () => {
  for (const map of MAP_LIBRARY) {
    for (const mode of ['classic', 'surge', 'dominion']) {
      let snapshot = createMatchSnapshot(map, mode, 3, 0, 0);
      for (let step = 0; step < 24 && snapshot.phase === 'playing'; step += 1) {
        const cells = hydrateMatchCells(map, snapshot);
        const candidates = cells.filter((cell) => isLegalMove(cell, snapshot.currentPlayer) && cell.index !== snapshot.firstMoveIndex);
        const index = candidates.sort((a,b) => b.energy - a.energy || a.index - b.index)[0]?.index;
        if (index === undefined) break;
        const before = JSON.stringify(snapshot);
        const preview = calculateMovePreview(map, snapshot, index);
        assert.equal(JSON.stringify(snapshot), before);
        const result = resolveTurn(map, snapshot, snapshot.currentPlayer, index);
        assert.ok(preview);
        assert.deepEqual(preview.cells, result.value.next.cells);
        assert.equal(preview.winner, result.value.next.winner);
        assert.equal(preview.waveCount, result.value.waves.length);
        snapshot = result.value.next;
      }
    }
  }
});

test('预览拒绝被锁定的中立格、被动格、第二步首格和已结束的对局', () => {
  const map = MAP_LIBRARY.find((map) => map.id === 'forge-8');
  const snapshot = createMatchSnapshot(map, 'surge', 2, 0, 0);
  for (const cell of freshCells(map).filter((cell) => !isLegalMove(cell, 0))) assert.equal(calculateMovePreview(map, snapshot, cell.index), null);
  const legal = freshCells(map).find((cell) => isLegalMove(cell, 0)).index;
  const second = resolveTurn(map, snapshot, 0, legal).value.next;
  if (second.turnStep === 2) assert.equal(calculateMovePreview(map, second, legal), null);
  assert.equal(calculateMovePreview(map, { ...snapshot, phase: 'finished', winner: 0 }, legal), null);
});

test('大地图总览聚合数字，放大到足够清晰后使用几何棋子', () => {
  const square = MAP_LIBRARY.find((map) => map.id === 'classic-20');
  const mixed = createCustomMap(1, 9, 8, undefined, 'trihex');
  for (const map of [square, mixed]) {
    assert.equal(compactEnergyView(map, 1, 340), true);
    assert.equal(compactEnergyView(map, 4, 340), false);
  }
  assert.equal(compactEnergyView(MAP_LIBRARY[0], 1, 340), false);
  assert.equal(compactEnergyView(createCustomMap(1, 20, 20, undefined, 'trihex'), 8, 280), false);
});
