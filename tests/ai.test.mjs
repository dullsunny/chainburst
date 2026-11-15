import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIBRARY, createCustomMap, createMap, updateEditorCell } from '../lib/explosion-game.ts';
import { createMatchSnapshot, resolveTurn } from '../lib/match-engine.ts';
import { AI_TIME_BUDGETS, aiLegalMoves, chooseAiMove, createAiBoard, createAiPosition, simulateAiMove } from '../lib/game-ai.ts';
import { chooseAiMove as choosePreviousMove } from './fixtures/ai-v14.ts';

function rng(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

test('搜索模拟器与权威引擎在所有内置图、三种模式和2–6人对局中一致', (t) => {
  const random = rng(20261025);
  let checked = 0;
  for (const map of MAP_LIBRARY) {
    for (const mode of ['classic', 'surge', 'dominion']) {
      for (const players of [2, 3, 4, 5, 6]) {
        let snapshot = createMatchSnapshot(map, mode, players, 0, 0);
        const board = createAiBoard(map, snapshot);
        for (let turn = 0; turn < Math.min(130, map.cells.length * 3) && snapshot.phase === 'playing'; turn += 1) {
          const position = createAiPosition(snapshot);
          const legal = aiLegalMoves(board, position);
          if (!legal.length) break;
          // Prefer charged moves often enough to exercise deep chain reactions.
          const charged = legal.filter((index) => position.energy[index] > 0);
          const pool = charged.length && random() < .72 ? charged : legal;
          const index = pool[Math.floor(random() * pool.length)];
          const simulated = simulateAiMove(board, position, index);
          const actual = resolveTurn(map, snapshot, snapshot.currentPlayer, index);
          assert.ok(actual.ok);
          assert.deepEqual(Array.from(simulated.owners, (owner) => owner < 0 ? null : owner), actual.value.next.cells.map((cell) => cell.owner), `${map.id}/${mode}/${players}/${turn} owners`);
          assert.deepEqual(Array.from(simulated.energy), actual.value.next.cells.map((cell) => cell.energy));
          assert.equal(simulated.currentPlayer, actual.value.next.currentPlayer);
          assert.equal(simulated.turnStep, actual.value.next.turnStep);
          assert.equal(simulated.firstMoveIndex, actual.value.next.firstMoveIndex);
          assert.equal(simulated.winner, actual.value.next.winner);
          assert.equal(simulated.draw, actual.value.next.phase === 'draw');
          snapshot = actual.value.next;
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 5_000);
  t.diagnostic(`逐步比对 ${checked} 个合法回合`);
});

test('所有难度遵守被动格与预充能锁定，零领地仍能重入', () => {
  let map = createCustomMap(0, 6, 6);
  map = updateEditorCell(map, 7, { autoCapacity: false, capacity: 2 });
  map = updateEditorCell(map, 8, { initialEnergy: 1 });
  const snapshot = createMatchSnapshot(map, 'classic', 3, 1, 0);
  snapshot.cells[7] = { owner: 1, energy: 1 };
  snapshot.cells[0] = { owner: 0, energy: 1 };
  const board = createAiBoard(map, snapshot);
  const legal = aiLegalMoves(board, createAiPosition(snapshot));
  assert.ok(!legal.includes(7) && !legal.includes(8) && !legal.includes(0));
  for (const level of ['easy', 'normal', 'hard', 'master']) {
    const decision = chooseAiMove(map, snapshot, level, { timeMs: 30, random: rng(7) });
    assert.ok(legal.includes(decision.cellIndex));
  }
});

test('大师识别唯一直接经典胜着和高容量强化边胜着', () => {
  const map = MAP_LIBRARY[0];
  const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
  for (const index of [0, ...Array.from({ length: 17 }, (_, i) => i + 12)]) snapshot.cells[index] = { owner: 0, energy: 1 };
  snapshot.cells[1] = { owner: 1, energy: 1 };
  assert.equal(chooseAiMove(map, snapshot, 'master').cellIndex, 0);

  const forge = MAP_LIBRARY.find((item) => item.id === 'forge-8');
  const forged = createMatchSnapshot(forge, 'classic', 2, 0, 0);
  forged.cells = forged.cells.map(() => ({ owner: 0, energy: 1 }));
  forged.cells[9].energy = 5;
  for (const index of [0, 1, 8]) forged.cells[index].owner = 1;
  assert.equal(chooseAiMove(forge, forged, 'master').cellIndex, 9);
});

test('大师拒绝21格贪心并避开对手一手杀', () => {
  const map = MAP_LIBRARY[0];
  const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
  const energies = [1,1,2,1,2,0,2,3,1,1,1,2,2,1,3,1,3,2,2,3,2,2,2,1,1,2,3,2,3,2,0,2,2,1,1,0];
  snapshot.cells = energies.map((energy, index) => ({ energy, owner: energy === 0 ? null : [7, 8, 13, 14].includes(index) ? 0 : 1 }));
  const decision = chooseAiMove(map, snapshot, 'master', { timeMs: 1_000 });
  assert.ok([5, 35].includes(decision.cellIndex), JSON.stringify(decision));
  assert.ok(decision.depth >= 2);
  const next = resolveTurn(map, snapshot, 0, decision.cellIndex).value.next;
  const board = createAiBoard(map, next);
  const replies = aiLegalMoves(board, createAiPosition(next));
  assert.ok(replies.every((index) => resolveTurn(map, next, next.currentPlayer, index).value.next.winner !== 1));
});

test('上限内循环与双脉冲溢出仍与真实终局一致', () => {
  const map = createMap({ id: 'cycle-test', name: 'cycle', subtitle: '', description: '', rows: 2, cols: 2, kind: 'classic', difficulty: '入门', recommended: '', accent: '#fff' });
  for (const mode of ['classic', 'surge']) {
    const snapshot = createMatchSnapshot(map, mode, 2, 0, 0);
    snapshot.cells = [{ owner: 0, energy: 1 }, { owner: 1, energy: 1 }, { owner: 1, energy: 1 }, { owner: null, energy: 0 }];
    const result = simulateAiMove(createAiBoard(map, snapshot), createAiPosition(snapshot), 0);
    assert.equal(result.winner, 0);
    assert.equal(resolveTurn(map, snapshot, 0, 0).value.next.winReason, 'singularity');
    const chosen = chooseAiMove(map, snapshot, 'master').cellIndex;
    assert.equal(resolveTurn(map, snapshot, 0, chosen).value.next.winner, 0);
  }
});

test('完整搜索不得把漏搜安静防守的三层乐观值当成必胜', () => {
  const map = MAP_LIBRARY[0];
  const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
  const owners = [0,1,0,1,0,1,1,1,1,1,1,1,1,0,1,1,1,1,0,1,1,1,1,0,1,1,0,1,1,0,1,0,0,1,1,1];
  const energies = [1,2,2,2,2,1,2,1,2,1,2,1,1,2,1,1,3,1,2,3,3,1,2,2,2,1,1,1,3,2,1,1,2,2,2,1];
  snapshot.cells = owners.map((owner, index) => ({ owner, energy: energies[index] }));
  const decision = chooseAiMove(map, snapshot, 'master', { maxDepth: 3, timeMs: 1_000 });
  assert.equal(decision.depth, 3);
  assert.ok(Math.abs(decision.score) < 9_999_000, JSON.stringify(decision));
  // The old alleged win at 31 is refuted by quiet reply 7.
  const after31 = resolveTurn(map, snapshot, 0, 31).value.next;
  const defended = resolveTurn(map, after31, 1, 7).value.next;
  const legal = aiLegalMoves(createAiBoard(map, defended), createAiPosition(defended));
  assert.ok(legal.every((index) => resolveTurn(map, defended, 0, index).value.next.winner !== 0));
});

test('搜索增量指纹与从动态格重建的指纹一致，缓存不串状态', () => {
  const random = rng(93271);
  for (const map of [MAP_LIBRARY[0], MAP_LIBRARY.find((item) => item.id === 'forge-8')]) {
    const snapshot = createMatchSnapshot(map, 'surge', 3, 0, 0);
    const board = createAiBoard(map, snapshot);
    let position = createAiPosition(snapshot);
    for (let turn = 0; turn < 90 && position.winner === null && !position.draw; turn += 1) {
      const legal = aiLegalMoves(board, position);
      position = simulateAiMove(board, position, legal[Math.floor(random() * legal.length)]);
      const rebuilt = createAiPosition({ ...snapshot, currentPlayer: position.currentPlayer, turnStep: position.turnStep, firstMoveIndex: position.firstMoveIndex, cells: Array.from(position.owners, (owner, index) => ({ owner: owner < 0 ? null : owner, energy: position.energy[index] })) });
      assert.equal(position.hashA, rebuilt.hashA);
      assert.equal(position.hashB, rebuilt.hashB);
      assert.equal(position.totalEnergy, board.active.reduce((sum, index) => sum + position.energy[index], 0));
    }
  }
});

test('搜索超时与终局能可靠返回合法兜底或空决策', () => {
  const map = MAP_LIBRARY[2];
  const snapshot = createMatchSnapshot(map, 'classic', 6, 0, 0);
  let clock = 0;
  const result = chooseAiMove(map, snapshot, 'master', { timeMs: 10, now: () => ++clock });
  assert.ok(aiLegalMoves(createAiBoard(map, snapshot), createAiPosition(snapshot)).includes(result.cellIndex));
  snapshot.phase = 'finished'; snapshot.winner = 0;
  assert.equal(chooseAiMove(map, snapshot, 'master').cellIndex, null);
});

test('多人强档使用真实行动者的完整回复搜索并遵守指定深度', () => {
  const map = MAP_LIBRARY[0];
  const snapshot = createMatchSnapshot(map, 'classic', 3, 0, 0);
  const decision = chooseAiMove(map, snapshot, 'master', { timeMs: 500, maxDepth: 2 });
  assert.equal(decision.search, 'full-width');
  assert.equal(decision.depth, 2);
  assert.ok(resolveTurn(map, snapshot, 0, decision.cellIndex).ok);
});

test('所有难度在双脉冲第二步避开首步格，并计算另一格的即时胜着', () => {
  const map = MAP_LIBRARY[0];
  const first = resolveTurn(map, createMatchSnapshot(map, 'surge', 2, 0, 0), 0, 7).value.next;
  for (const level of ['easy', 'normal', 'hard', 'master']) {
    const chosen = chooseAiMove(map, first, level, { timeMs: 25, random: rng(13) }).cellIndex;
    assert.notEqual(chosen, 7);
    const result = resolveTurn(map, first, 0, chosen);
    assert.equal(result.ok, true);
    assert.equal(result.value.next.currentPlayer, 1);
  }
  const tactical = createMatchSnapshot(map, 'surge', 2, 0, 0);
  tactical.turnStep = 2;
  tactical.firstMoveIndex = 7;
  for (const index of [0, ...Array.from({ length: 17 }, (_, i) => i + 12)]) tactical.cells[index] = { owner: 0, energy: 1 };
  tactical.cells[1] = { owner: 1, energy: 1 };
  const decision = chooseAiMove(map, tactical, 'master', { timeMs: 100 });
  assert.equal(decision.cellIndex, 0);
  assert.equal(resolveTurn(map, tactical, 0, decision.cellIndex).value.next.winner, 0);
});

test('入门在最大空棋盘上无需展开搜索，且随机探索不固定在首格', () => {
  const map = createCustomMap(0, 20, 20);
  const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
  const chosen = new Set();
  for (const value of [.1, .3, .5, .65]) {
    const decision = chooseAiMove(map, snapshot, 'easy', { random: () => value });
    assert.equal(decision.nodes, 0);
    assert.ok(resolveTurn(map, snapshot, 0, decision.cellIndex).ok);
    chosen.add(decision.cellIndex);
  }
  assert.equal(chosen.size, 4);
  assert.ok(AI_TIME_BUDGETS.easy < AI_TIME_BUDGETS.normal && AI_TIME_BUDGETS.normal < AI_TIME_BUDGETS.hard && AI_TIME_BUDGETS.hard < AI_TIME_BUDGETS.master);
});

test('同为两层搜索，新版识别旧版漏掉的三步必胜，权威引擎穷举验证', () => {
  const map = createMap({ id: 'horizon-test', name: 'horizon', subtitle: '', description: '', rows: 3, cols: 3, kind: 'classic', difficulty: '入门', recommended: '', accent: '#fff' });
  const snapshot = createMatchSnapshot(map, 'classic', 2, 1, 0);
  const owners = [1, null, 1, 0, 1, 1, 0, 0, 0];
  const energy = [1, 0, 1, 1, 1, 2, 1, 1, 1];
  snapshot.cells = owners.map((owner, index) => ({ owner, energy: energy[index] }));
  const options = { maxDepth: 2, now: () => 0 };
  const upgraded = chooseAiMove(map, snapshot, 'master', options);
  const previous = choosePreviousMove(map, snapshot, 'master', options);
  assert.equal(upgraded.cellIndex, 2);
  assert.equal(previous.cellIndex, 5);
  assert.ok(upgraded.score >= 9_999_000);
  const solve = (state, depth) => {
    if (state.winner !== null) return state.winner === 1 ? 1 : -1;
    if (depth === 0 || state.phase !== 'playing') return 0;
    const results = map.cells.map((cell) => resolveTurn(map, state, state.currentPlayer, cell.index))
      .filter((turn) => turn.ok).map((turn) => solve(turn.value.next, depth - 1));
    return (state.currentPlayer === 1 ? Math.max : Math.min)(...results);
  };
  assert.equal(solve(resolveTurn(map, snapshot, 1, upgraded.cellIndex).value.next, 3), 1);
  assert.equal(solve(resolveTurn(map, snapshot, 1, previous.cellIndex).value.next, 3), -1);
});

test('连续紧凑模拟保持领地缓存准确且不修改父局面，覆盖自制被动/强化/锁定格', () => {
  const random = rng(15112026);
  for (const topology of ['square', 'triangle', 'hex', 'trihex']) {
    let map = createCustomMap(0, 10, 10, undefined, topology);
    const cells = map.cells.filter((cell) => cell.active && cell.neighbors.length >= 3);
    map = updateEditorCell(map, cells[0].index, { autoCapacity: false, capacity: 2 });
    map = updateEditorCell(map, cells[1].index, { autoCapacity: false, capacity: cells[1].neighbors.length + 1 });
    map = updateEditorCell(map, cells[2].index, { initialEnergy: 1 });
    for (const mode of ['classic', 'surge', 'dominion']) {
      let snapshot = createMatchSnapshot(map, mode, 6, 0, 0);
      const board = createAiBoard(map, snapshot);
      let position = createAiPosition(snapshot);
      for (let step = 0; step < 100 && snapshot.phase === 'playing'; step++) {
        const parent = structuredClone(position);
        const legal = aiLegalMoves(board, position);
        const index = legal[Math.floor(random() * legal.length)];
        const next = simulateAiMove(board, position, index);
        assert.deepEqual(position, parent);
        snapshot = resolveTurn(map, snapshot, snapshot.currentPlayer, index).value.next;
        assert.deepEqual(Array.from(next.energy), snapshot.cells.map((cell) => cell.energy));
        assert.deepEqual(Array.from(next.owners, (owner) => owner < 0 ? null : owner), snapshot.cells.map((cell) => cell.owner));
        assert.deepEqual(next.counts, Array.from({ length: 6 }, (_, player) => snapshot.cells.filter((cell) => cell.owner === player).length));
        assert.equal(next.winner, snapshot.winner);
        assert.equal(next.currentPlayer, snapshot.currentPlayer);
        position = next;
      }
    }
  }
});

test('疆域赛人机模拟按每局记载的占领门槛判断终局', () => {
  const map = MAP_LIBRARY[0];
  const snapshot = createMatchSnapshot(map, 'dominion', 2, 0, 0);
  for (let index = 0; index < 21; index += 1) snapshot.cells[index] = { owner: 0, energy: 1 };
  snapshot.cells[35] = { owner: 1, energy: 1 };

  const newer = simulateAiMove(createAiBoard(map, snapshot), createAiPosition(snapshot), 21);
  assert.equal(newer.winner, null);
  const older = { ...snapshot, dominionPercent: undefined };
  const legacy = simulateAiMove(createAiBoard(map, older), createAiPosition(older), 21);
  assert.equal(legacy.winner, 0);
});
