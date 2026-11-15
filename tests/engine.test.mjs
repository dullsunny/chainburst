import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_LIBRARY,
  cellOrientation,
  createCustomMap,
  createClassicMap,
  createEditorMap,
  createMap,
  deserializeCustomMap,
  explodeWave,
  findOfficialMap,
  findNextPlayablePlayer,
  findWinner,
  formatCellCoordinate,
  freshCells,
  getTransferPlan,
  isLegalMove,
  isPassiveSpecialCell,
  maxStableEnergy,
  migrateLegacyCustomMap,
  resetEditorCellToDefault,
  resetEditorMapToDefault,
  retileEditorMap,
  serializeCustomMap,
  sharedEdgeLength,
  updateEditorCell,
  validateMap,
} from '../lib/explosion-game.ts';
import { createMatchSnapshot, hydrateMatchCells, isMatchLegalMove, normalizeMatchSnapshot, resolveTurn } from '../lib/match-engine.ts';

test('经典方阵按实际邻接数设置容量', () => {
  const map = createClassicMap(6);
  assert.equal(map.cells[0].capacity, 2);
  assert.equal(map.cells[1].capacity, 3);
  assert.equal(map.cells[7].capacity, 4);
});

test('只有全空中立格或己方格允许落子', () => {
  const map = createClassicMap(6);
  const cells = freshCells(map);
  assert.equal(isLegalMove(cells[0], 0), true);
  cells[0].energy = 1;
  assert.equal(isLegalMove(cells[0], 0), false);
  cells[0].owner = 0;
  assert.equal(isLegalMove(cells[0], 0), true);
  assert.equal(isLegalMove(cells[0], 1), false);
});

test('超限格每波只爆一次并保留余量与颜色', () => {
  const cells = freshCells(createClassicMap(6));
  cells[7].energy = 9;
  cells[7].owner = 0;
  const first = explodeWave(cells, 0);
  assert.ok(first);
  assert.equal(first.afterTransfer[7].energy, 5);
  assert.equal(first.afterTransfer[7].owner, 0);
  const second = explodeWave(first.afterTransfer, 0);
  assert.ok(second);
  assert.equal(second.afterTransfer[7].energy, 1);
  assert.equal(second.afterTransfer[7].owner, 0);
});

test('同一波先统一爆炸，再聚合相互传递', () => {
  const cells = freshCells(createClassicMap(6));
  for (const index of [7, 8]) {
    cells[index].energy = 4;
    cells[index].owner = 0;
  }
  const wave = explodeWave(cells, 0);
  assert.ok(wave);
  assert.deepEqual(wave.exploding, [7, 8]);
  assert.equal(wave.afterBurst[7].energy, 0);
  assert.equal(wave.afterBurst[8].energy, 0);
  assert.equal(wave.afterTransfer[7].energy, 1);
  assert.equal(wave.afterTransfer[8].energy, 1);
});

test('特殊槽位按容量与强化边分配能量', () => {
  const map = MAP_LIBRARY.find((item) => item.id === 'forge-8');
  assert.ok(map);
  let cells = freshCells(map);
  const high = cells.find((cell) => cell.row === 1 && cell.col === 1);
  assert.ok(high);
  high.energy = 6;
  high.owner = 0;
  let wave = explodeWave(cells, 0);
  assert.ok(wave);
  assert.equal(wave.transfers.reduce((sum, item) => sum + item.amount, 0), 6);
  assert.equal(wave.transfers.filter((item) => item.amount === 2).length, 2);
  assert.deepEqual(getTransferPlan(high).map((item) => item.amount).sort(), [1, 1, 2, 2]);

  cells = freshCells(map);
  const low = cells.find((cell) => cell.row === 2 && cell.col === 4);
  assert.ok(low);
  assert.equal(isPassiveSpecialCell(low), true);
  assert.equal(isLegalMove(low, 0), false);
  low.owner = 0;
  assert.equal(isLegalMove(low, 0), false);
  low.energy = 2;
  wave = explodeWave(cells, 0);
  assert.ok(wave);
  assert.equal(wave.transfers.reduce((sum, item) => sum + item.amount, 0), 4);
});

test('失去全部格子的玩家可从全空中立格重新入场', () => {
  const cells = freshCells(createClassicMap(6));
  cells[0].owner = 0;
  cells[0].energy = 1;
  assert.equal(cells.some((cell) => cell.owner === 1), false);
  assert.equal(findNextPlayablePlayer(cells, 0, 2), 1);
  const reentry = cells.find((cell) => isLegalMove(cell, 1));
  assert.ok(reentry);
  assert.equal(reentry.owner, null);
  assert.equal(reentry.energy, 0);
});

test('偏流熔炉中央不再布置四枚对角金边格', () => {
  const map = MAP_LIBRARY.find((item) => item.id === 'forge-8');
  assert.ok(map);
  const center = map.cells.filter((cell) => [3, 4].includes(cell.row) && [3, 4].includes(cell.col));
  assert.ok(center.every((cell) => cell.autoCapacity));
  const passive = map.cells.filter(isPassiveSpecialCell);
  assert.equal(passive.length, 4);
  assert.ok(passive.every((cell) => cell.neighbors.every((neighbor) => !isPassiveSpecialCell(map.cells[neighbor]))));
});

test('经典胜利必须是唯一颜色且严格超过有效格一半', () => {
  const map = createClassicMap(6);
  const cells = freshCells(map);
  for (let index = 0; index < 18; index += 1) cells[index].owner = 0;
  assert.equal(findWinner(cells, 2), null);
  cells[18].owner = 0;
  assert.equal(findWinner(cells, 2), 0);
  cells[35].owner = 1;
  assert.equal(findWinner(cells, 2), null);
});

test('洞格不计入稳定容量与胜利分母', () => {
  const map = MAP_LIBRARY.find((item) => item.id === 'rift-9');
  assert.ok(map);
  const cells = freshCells(map);
  const active = cells.filter((cell) => cell.active);
  assert.equal(active.length, 72);
  active.slice(0, 37).forEach((cell) => { cell.owner = 0; });
  assert.equal(findWinner(cells, 3), 0);
  assert.ok(maxStableEnergy(cells) > 0);
});

test('三角形与六边形地图只把完整共边格视为相邻', () => {
  for (const [id, expectedEdges] of [['triangle-8-v2', 82], ['hex-7', 120]]) {
    const map = MAP_LIBRARY.find((item) => item.id === id);
    assert.ok(map);
    const edgeCount = map.cells.reduce((sum, cell) => sum + cell.neighbors.length, 0) / 2;
    assert.equal(edgeCount, expectedEdges);
    for (const cell of map.cells) {
      for (const neighbor of cell.neighbors) {
        assert.ok(sharedEdgeLength(cell, map.cells[neighbor]) > 0);
        assert.ok(map.cells[neighbor].neighbors.includes(cell.index));
      }
      for (const other of map.cells) {
        if (other.index === cell.index) continue;
        assert.equal(sharedEdgeLength(cell, other) > 0, cell.neighbors.includes(other.index));
      }
    }
  }
  const triangles = MAP_LIBRARY.find((item) => item.id === 'triangle-8-v2');
  const hexagons = MAP_LIBRARY.find((item) => item.id === 'hex-7');
  assert.ok(triangles && hexagons);
  assert.equal(triangles.cells[1].geometry.x - triangles.cells[0].geometry.x, .5);
  assert.equal(hexagons.cells[7].geometry.x - hexagons.cells[0].geometry.x, .5);
  assert.ok(Math.abs(hexagons.cells[7].geometry.y - hexagons.cells[0].geometry.y - Math.sqrt(3) / 2) < 1e-9);
});

test('非方形格从真实顶点识别朝向并统一坐标标注', () => {
  const triangles = MAP_LIBRARY.find((item) => item.id === 'triangle-8-v2');
  const hexagons = MAP_LIBRARY.find((item) => item.id === 'hex-7');
  const mixed = MAP_LIBRARY.find((item) => item.id === 'prism-7-v2');
  assert.ok(triangles && hexagons && mixed);
  assert.equal(cellOrientation(triangles.cells[0]), 'up');
  assert.equal(cellOrientation(triangles.cells[1]), 'down');
  assert.equal(cellOrientation(hexagons.cells[0]), 'pointy');
  const mixedHex = mixed.cells.find((cell) => cell.shape === 'hex');
  assert.ok(mixedHex);
  assert.equal(cellOrientation(mixedHex), 'flat');
  assert.equal(formatCellCoordinate(mixed, mixedHex), `晶${mixedHex.index + 1}`);
});

test('三六角混合地图使用真实共边密铺', () => {
  const map = MAP_LIBRARY.find((item) => item.id === 'prism-7-v2');
  assert.ok(map);
  assert.equal(map.topology, 'trihex');
  assert.ok(map.cells.some((cell) => cell.shape === 'triangle'));
  assert.ok(map.cells.some((cell) => cell.shape === 'hex'));
  for (const cell of map.cells) {
    for (const neighbor of cell.neighbors) assert.ok(sharedEdgeLength(cell, map.cells[neighbor]) > 0);
  }
});

test('新增地图具有差异化结构且全部通过结构校验', () => {
  const ids = ['triangle-tide-10-v2', 'hex-ring-9', 'quadrant-gates-11', 'prism-pulse-6-v2', 'three-crossings', 'three-core'];
  for (const id of ids) {
    const map = MAP_LIBRARY.find((item) => item.id === id);
    assert.ok(map);
    assert.deepEqual(validateMap(map, 6), []);
  }
  assert.ok(MAP_LIBRARY.find((item) => item.id === 'triangle-tide-10-v2').cells.some((cell) => !cell.active));
  assert.ok(MAP_LIBRARY.find((item) => item.id === 'hex-ring-9').cells.some((cell) => cell.initialEnergy > 0));
  assert.ok(MAP_LIBRARY.find((item) => item.id === 'quadrant-gates-11').cells.some(isPassiveSpecialCell));
  assert.equal(MAP_LIBRARY.find((item) => item.id === 'prism-pulse-6-v2').topology, 'trihex');
});

test('可选官图没有可直接注能的单槽格，旧布局仍可按房间地图 ID 恢复', () => {
  for (const map of MAP_LIBRARY) {
    assert.deepEqual(validateMap(map, 6), [], map.id);
    assert.ok(map.cells.every((cell) => !cell.active || cell.capacity !== 1 || isPassiveSpecialCell(cell)), map.id);
  }
  const gates = findOfficialMap('quadrant-gates-11').cells.filter((cell) => cell.active && cell.capacity === 1);
  assert.equal(gates.length, 4);
  assert.ok(gates.every((cell) => !isLegalMove(cell, 0)));
  const legacy = findOfficialMap('triangle-8');
  assert.equal(legacy.cells.length, 64);
  assert.equal(legacy.cells[7].capacity, 1);
  assert.equal(findOfficialMap('triangle-8-v2').cells.length, 62);
});

test('折光阀阵的两条强化边均能驱动被动阀及下游预充能格', () => {
  const map = findOfficialMap('refraction-valves');
  for (const [sourceId, valveId, chargedId] of [['0:15', '0:11', '1:7'], ['2:9', '2:4', '2:1']]) {
    const source = map.cells.find((cell) => cell.id === sourceId);
    const valve = map.cells.find((cell) => cell.id === valveId);
    assert.ok(source.boosted.includes(valve.index));
    assert.equal(isLegalMove(valve, 0), false);
    const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
    snapshot.cells[source.index] = { owner: 0, energy: 4 };
    const turn = resolveTurn(map, snapshot, 0, source.index);
    assert.ok(turn.ok);
    assert.deepEqual(turn.value.waves.map((wave) => wave.exploding.map((index) => map.cells[index].id)),
      [[sourceId], [valveId], [chargedId]]);
  }
});

test('合流闸室的阀先存一点，再归最后触发爆炸的一方', () => {
  const map = findOfficialMap('confluence-chamber');
  const valve = map.cells.find((cell) => cell.id === '1:9');
  const feeders = ['1:6', '1:13'].map((id) => map.cells.find((cell) => cell.id === id));
  const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
  feeders.forEach((cell, player) => { snapshot.cells[cell.index] = { owner: player, energy: cell.capacity - 1 }; });
  const first = resolveTurn(map, snapshot, 0, feeders[0].index);
  assert.ok(first.ok);
  assert.equal(first.value.next.cells[valve.index].energy, 1);
  assert.ok(first.value.waves.every((wave) => !wave.exploding.includes(valve.index)));
  const second = resolveTurn(map, first.value.next, 1, feeders[1].index);
  assert.ok(second.ok);
  assert.ok(second.value.waves[1].exploding.includes(valve.index));
  const downstream = map.cells.find((cell) => cell.id === '1:17');
  assert.equal(second.value.next.cells[downstream.index].owner, 1);
});

test('地图工坊切换密铺后按真实边重新计算槽位', () => {
  let map = createEditorMap(6, 6);
  map = retileEditorMap(map, 'triangle');
  assert.equal(map.topology, 'triangle');
  assert.equal(map.cells.find((cell) => cell.row === 2 && cell.col === 2)?.capacity, 3);
  map = retileEditorMap(map, 'hex');
  assert.equal(map.topology, 'hex');
  assert.equal(map.cells.find((cell) => cell.row === 2 && cell.col === 2)?.capacity, 6);
});

test('容量恢复为自动邻接数或整数倍时清除强化边', () => {
  let map = createEditorMap(6, 6);
  const index = 7;
  map = updateEditorCell(map, index, { autoCapacity: false, capacity: 6, boostDirections: ['U', 'D'] });
  assert.equal(map.cells[index].boostDirections.length, 2);
  assert.equal(map.cells[index].boosted.length, 2);
  map = updateEditorCell(map, index, { capacity: 4 });
  assert.deepEqual(map.cells[index].boostDirections, []);
  assert.deepEqual(map.cells[index].boosted, []);
  map = updateEditorCell(map, index, { capacity: 8, boostDirections: ['U', 'D'] });
  assert.deepEqual(map.cells[index].boostDirections, []);
  assert.deepEqual(map.cells[index].boosted, []);
});

test('地图工坊可恢复单格或保留尺寸密铺地恢复全部', () => {
  let map = createEditorMap(7, 9);
  map = updateEditorCell(map, 10, { autoCapacity: false, capacity: 6, initialEnergy: 1, boostDirections: ['U', 'D'] });
  map = updateEditorCell(map, 11, { active: false, initialEnergy: 0 });
  const one = resetEditorCellToDefault(map, 10);
  assert.equal(one.cells[10].active, true);
  assert.equal(one.cells[10].autoCapacity, true);
  assert.equal(one.cells[10].initialEnergy, 0);
  assert.deepEqual(one.cells[10].boostDirections, []);
  assert.equal(one.cells[11].active, false);
  assert.equal(resetEditorCellToDefault(one, -1), one);
  assert.equal(resetEditorCellToDefault(one, one.cells.length), one);

  const all = resetEditorMapToDefault(map);
  assert.equal(all.rows, 7);
  assert.equal(all.cols, 9);
  assert.equal(all.topology, 'square');
  assert.ok(all.cells.every((cell) => cell.active && cell.autoCapacity && cell.initialEnergy === 0 && cell.boostDirections.length === 0));
});

test('四个自制地图槽位拥有稳定身份且编辑时不会串槽', () => {
  let map = createCustomMap(1, 6, 6, undefined, 'square', '岔路试验场');
  assert.equal(map.id, 'custom-map-2');
  map = updateEditorCell(map, 7, { autoCapacity: false, capacity: 6, boostDirections: ['U', 'D'] });
  assert.equal(map.id, 'custom-map-2');
  assert.equal(map.name, '岔路试验场');
  map = retileEditorMap(map, 'hex');
  assert.equal(map.id, 'custom-map-2');
  assert.equal(map.name, '岔路试验场');
  const reset = resetEditorMapToDefault(map);
  assert.equal(reset.id, 'custom-map-2');
  assert.equal(reset.name, '岔路试验场');
});

test('自制地图快照仅保存源数据并由接收端重建邻接关系', () => {
  let map = createCustomMap(2, 6, 6, undefined, 'square', '联机试验场');
  map = updateEditorCell(map, 7, { autoCapacity: false, capacity: 6, boostDirections: ['U', 'D'], initialEnergy: 2 });
  map = updateEditorCell(map, 35, { active: false, initialEnergy: 0 });
  const snapshot = serializeCustomMap(map);
  assert.equal(snapshot.id, 'custom-map-3');
  assert.equal(snapshot.cells.length, 2);
  assert.equal('neighbors' in snapshot.cells[0], false);
  assert.equal('geometry' in snapshot.cells[0], false);
  const restored = deserializeCustomMap(snapshot, 2);
  assert.ok(restored);
  assert.equal(restored.id, 'custom-map-3');
  assert.equal(restored.name, '联机试验场');
  assert.deepEqual(restored.cells[7].neighbors, map.cells[7].neighbors);
  assert.deepEqual(restored.cells[7].boostDirections, ['U', 'D']);
  assert.equal(restored.cells[7].initialEnergy, 2);
  assert.equal(restored.cells[35].active, false);
});

test('自制地图快照拒绝重复索引、越界容量与伪造强化边', () => {
  const base = serializeCustomMap(createCustomMap(0, 6, 6));
  assert.equal(deserializeCustomMap({ ...base, cells: [{ index: 2 }, { index: 2 }] }, 0), null);
  assert.equal(deserializeCustomMap({ ...base, cells: [{ index: 2, autoCapacity: false, capacity: 9 }] }, 0), null);
  assert.equal(deserializeCustomMap({ ...base, cells: [{ index: 7, autoCapacity: false, capacity: 6, boostDirections: ['UL', 'DR'] }] }, 0), null);
  assert.equal(deserializeCustomMap({ ...base, rows: 21 }, 0), null);
});

test('四类密铺均可通过紧凑快照往返并保留真实共边', () => {
  for (const topology of ['square', 'triangle', 'hex', 'trihex']) {
    const map = createCustomMap(0, 6, 6, undefined, topology, `测试-${topology}`);
    const restored = deserializeCustomMap(serializeCustomMap(map), 0);
    assert.ok(restored);
    assert.equal(restored.topology, topology);
    assert.equal(restored.cells.length, map.cells.length);
    for (const cell of restored.cells) {
      for (const neighbor of cell.neighbors) assert.ok(sharedEdgeLength(cell, restored.cells[neighbor]) > 0);
    }
  }
});

test('旧版单地图存档迁移会限制尺寸并清洗运行时字段', () => {
  const source = createEditorMap(6, 6);
  const legacy = {
    ...source,
    name: '旧地图',
    cells: source.cells.map((cell) => ({ ...cell, neighbors: [999], owner: 5, energy: 999 })),
  };
  const migrated = migrateLegacyCustomMap(legacy, 0);
  assert.ok(migrated);
  assert.equal(migrated.id, 'custom-map-1');
  assert.equal(migrated.name, '旧地图');
  assert.equal(migrated.cells[0].owner, null);
  assert.equal(migrated.cells[0].energy, migrated.cells[0].initialEnergy);
  assert.equal(migrated.cells[0].neighbors.includes(999), false);
  assert.equal(migrateLegacyCustomMap({ ...legacy, rows: 1000 }, 0), null);
  assert.equal(migrateLegacyCustomMap({ ...legacy, topology: 'octagon' }, 0), null);
});

test('联机权威结算校验行动者并推进唯一版本号', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'classic', 2, 0, 7);
  assert.deepEqual(resolveTurn(map, initial, 1, 0), { ok: false, error: 'NOT_YOUR_TURN' });

  const result = resolveTurn(map, initial, 0, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value.next.revision, 8);
  assert.equal(result.value.next.moves, 1);
  assert.equal(result.value.next.currentPlayer, 1);
  assert.equal(result.value.next.cells[0].owner, 0);
  assert.equal(result.value.next.cells[0].energy, 1);
  assert.equal(initial.cells[0].energy, 0);
});

test('联机权威结算返回可重放的完整爆炸波次', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'classic', 2, 0, 12);
  initial.cells[0] = { owner: 0, energy: 1 };
  const result = resolveTurn(map, initial, 0, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value.waves.length, 1);
  assert.deepEqual(result.value.waves[0].exploding, [0]);
  assert.equal(result.value.waves[0].transfers.length, 2);
  const hydrated = hydrateMatchCells(map, result.value.next);
  assert.equal(hydrated[0].energy, 0);
  assert.equal(hydrated[1].owner, 0);
  assert.equal(hydrated[6].owner, 0);
});

test('双脉冲分两步在不同格各注入一点，第二步完成后才换玩家', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'surge', 3, 2, 3);
  const result = resolveTurn(map, initial, 2, 7);
  assert.equal(result.ok, true);
  assert.equal(result.value.amount, 1);
  assert.equal(result.value.next.cells[7].owner, 2);
  assert.equal(result.value.next.cells[7].energy, 1);
  assert.equal(result.value.next.currentPlayer, 2);
  assert.equal(result.value.next.turnStep, 2);
  assert.equal(result.value.next.firstMoveIndex, 7);
  assert.equal(result.value.next.turnNumber, 1);
  assert.equal(isMatchLegalMove(hydrateMatchCells(map, result.value.next)[7], result.value.next), false);
  assert.deepEqual(resolveTurn(map, result.value.next, 2, 7), { ok: false, error: 'CELL_ALREADY_USED' });
  assert.deepEqual(resolveTurn(map, result.value.next, 0, 8), { ok: false, error: 'NOT_YOUR_TURN' });
  // Serialization/reconnection must preserve the pending second placement.
  const restored = normalizeMatchSnapshot(JSON.parse(JSON.stringify(result.value.next)));
  const second = resolveTurn(map, restored, 2, 8);
  assert.equal(second.ok, true);
  assert.equal(second.value.next.currentPlayer, 0);
  assert.equal(second.value.next.turnStep, 1);
  assert.equal(second.value.next.firstMoveIndex, null);
  assert.equal(second.value.next.turnNumber, 2);
  assert.equal(second.value.next.moves, 2);
  assert.equal(second.value.next.revision, 5);
  assert.equal(second.value.next.cells[8].energy, 1);
});

test('双脉冲首步爆炸清空原格后，仍禁止第二步重复该格', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'surge', 2, 0, 0);
  initial.cells[0] = { owner: 0, energy: 1 };
  const first = resolveTurn(map, initial, 0, 0).value;
  assert.equal(first.waves.length, 1);
  assert.equal(first.next.cells[0].energy, 0);
  assert.equal(first.next.currentPlayer, 0);
  assert.deepEqual(resolveTurn(map, first.next, 0, 0), { ok: false, error: 'CELL_ALREADY_USED' });
  assert.equal(resolveTurn(map, first.next, 0, 1).ok, true);
});

test('没有其他合法格时自动结束双步回合，同一玩家再次行动也重置禁选格', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'surge', 2, 0, 0);
  initial.cells = initial.cells.map((_, index) => ({ owner: index === 0 ? null : 1, energy: index === 0 ? 0 : 1 }));
  const first = resolveTurn(map, initial, 0, 0).value.next;
  assert.equal(first.currentPlayer, 1);
  assert.equal(first.turnStep, 1);
  assert.equal(first.firstMoveIndex, null);
  assert.equal(first.turnNumber, 2);

  const passiveMap = { ...map, cells: map.cells.map((cell, index) => ({ ...cell, autoCapacity: false, capacity: index === 0 ? 3 : 1 })) };
  const onlyPlayer = resolveTurn(passiveMap, createMatchSnapshot(passiveMap, 'surge', 2, 0, 0), 0, 0).value.next;
  assert.equal(onlyPlayer.currentPlayer, 0);
  assert.equal(onlyPlayer.turnStep, 1);
  assert.equal(onlyPlayer.firstMoveIndex, null);
  assert.equal(onlyPlayer.turnNumber, 2);
  assert.equal(isMatchLegalMove(hydrateMatchCells(passiveMap, onlyPlayer)[0], onlyPlayer), true);
});

test('双脉冲首步达成胜利立即结束，旧房间从下一次落子采用双步规则', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'surge', 2, 0, 0);
  for (const index of [0, ...Array.from({ length: 17 }, (_, i) => i + 12)]) initial.cells[index] = { owner: 0, energy: 1 };
  initial.cells[1] = { owner: 1, energy: 1 };
  const won = resolveTurn(map, initial, 0, 0).value.next;
  assert.equal(won.phase, 'finished');
  assert.equal(won.winner, 0);
  assert.equal(won.moves, 1);
  assert.equal(won.turnNumber, 1);
  assert.equal(won.firstMoveIndex, null);

  const legacy = { ...createMatchSnapshot(map, 'surge', 2, 0, 8), rulesVersion: 1, moves: 6 };
  delete legacy.turnStep; delete legacy.firstMoveIndex; delete legacy.turnNumber;
  const migrated = normalizeMatchSnapshot(legacy);
  assert.equal(migrated.turnNumber, 7);
  assert.equal(migrated.turnStep, 1);
  const next = resolveTurn(map, legacy, 0, 7).value.next;
  assert.equal(next.rulesVersion, 2);
  assert.equal(next.turnStep, 2);
  assert.equal(next.currentPlayer, 0);
  assert.equal(next.cells[7].energy, 1);
});

test('疆域赛新局用 65% 向上取整，旧联机快照继续用开局时的 60%', () => {
  const map = createClassicMap(6);
  const initial = createMatchSnapshot(map, 'dominion', 2, 0, 7);
  assert.equal(initial.dominionPercent, 65);
  for (let index = 0; index < 21; index += 1) initial.cells[index] = { owner: 0, energy: 1 };
  initial.cells[35] = { owner: 1, energy: 1 };

  const olderRoom = JSON.parse(JSON.stringify(initial));
  delete olderRoom.dominionPercent;
  assert.equal(normalizeMatchSnapshot(olderRoom).dominionPercent, 60);
  const oldResult = resolveTurn(map, olderRoom, 0, 21).value.next;
  assert.equal(oldResult.phase, 'finished');
  assert.equal(oldResult.winReason, 'dominion');
  assert.equal(oldResult.dominionPercent, 60);

  let next = resolveTurn(map, initial, 0, 21).value.next;
  assert.equal(next.phase, 'playing');
  next = resolveTurn(map, next, 1, 34).value.next;
  next = resolveTurn(map, next, 0, 22).value.next;
  assert.equal(next.phase, 'playing');
  next = resolveTurn(map, next, 1, 33).value.next;
  next = resolveTurn(map, next, 0, 23).value.next;
  assert.equal(next.phase, 'finished');
  assert.equal(next.winner, 0);
  assert.equal(next.winReason, 'dominion');
  assert.equal(next.cells.filter(({ owner }) => owner === 0).length, 24);
  assert.equal(next.cells.filter(({ owner }) => owner === 1).length, 3);
});

test('疆域赛门槛只统计有效地图格', () => {
  const map = createMap({
    ...createClassicMap(6),
    topology: 'square',
    customize: ({ row, col }) => row === 5 && col <= 2 ? { active: false } : {},
  });
  const initial = createMatchSnapshot(map, 'dominion', 2, 0, 0);
  assert.equal(map.cells.filter(({ active }) => active).length, 33);
  for (let index = 0; index < 21; index += 1) initial.cells[index] = { owner: 0, energy: 1 };
  initial.cells[35] = { owner: 1, energy: 1 };
  const next = resolveTurn(map, initial, 0, 21).value.next;
  assert.equal(next.phase, 'finished');
  assert.equal(next.winReason, 'dominion');
});
