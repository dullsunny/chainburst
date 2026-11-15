import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { MAP_LIBRARY, createCustomMap } from '../lib/explosion-game.ts';
import { createMatchSnapshot, hydrateMatchCells, isMatchLegalMove } from '../lib/match-engine.ts';
import { MIXED_TILINGS } from '../lib/mixed-tilings.ts';
import { calculateMovePreview } from '../lib/move-preview.ts';

const topologies = ['square', 'triangle', 'hex', 'trihex', ...MIXED_TILINGS];
const maps = [...MAP_LIBRARY, ...topologies.map((topology) => createCustomMap(0, 20, 20, undefined, topology, `工坊 ${topology}`))];

test('所有内置地图和各类最大自制图的预览/人机消息均能结构化克隆', () => {
  for (const map of maps) {
    for (const callback of ['shapeAt', 'activeAt', 'customize']) assert.equal(callback in map, false, `${map.name}: construction callback leaked`);
    const snapshot = createMatchSnapshot(map, 'surge', 6, 0, 0);
    const preview = structuredClone({ type: 'init', generation: 1, map, snapshot });
    const ai = structuredClone({ id: 1, map, snapshot, difficulty: 'master' });
    assert.deepEqual(preview.map, map);
    assert.deepEqual(ai.snapshot, snapshot);
  }
});

// Run the real browser-worker entrypoints behind a small Node message bridge.
// Unlike direct function tests, postMessage exercises the same clone boundary.
async function openWorker(path) {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    import(${JSON.stringify(new URL(path, import.meta.url).href)}).then(() => {
      parentPort.on('message', (data) => globalThis.onmessage({ data }));
      parentPort.postMessage({ ready: true });
    }).catch((error) => { throw error; });
  `, { eval: true });
  const [ready] = await once(worker, 'message');
  assert.equal(ready.ready, true);
  return worker;
}

test('真实预览线程在全部地图上初始化、接收候选并返回正确结果', { timeout: 15_000 }, async () => {
  const worker = await openWorker('../workers/move-preview.worker.ts');
  try {
    for (const [generation, map] of maps.entries()) {
      const snapshot = createMatchSnapshot(map, 'surge', 3, 0, 0);
      const index = hydrateMatchCells(map, snapshot).find((cell) => isMatchLegalMove(cell, snapshot)).index;
      const response = once(worker, 'message');
      worker.postMessage({ type: 'init', generation, map, snapshot });
      worker.postMessage({ type: 'preview', generation, index });
      const [message] = await response;
      assert.equal(message.error, undefined, map.name);
      assert.equal(message.generation, generation);
      assert.deepEqual(message.result, calculateMovePreview(map, snapshot, index), map.name);
    }
  } finally { await worker.terminate(); }
});

test('真实人机线程在所有非经典内置地图上均返回合法落子', { timeout: 15_000 }, async () => {
  const worker = await openWorker('../workers/game-ai.worker.ts');
  try {
    for (const map of MAP_LIBRARY.filter((map) => map.kind !== 'classic')) {
      const snapshot = createMatchSnapshot(map, 'classic', 2, 0, 0);
      const response = once(worker, 'message');
      worker.postMessage({ id: map.id, map, snapshot, difficulty: 'easy' });
      const [message] = await response;
      assert.equal(message.error, undefined, map.id);
      assert.ok(isMatchLegalMove(hydrateMatchCells(map, snapshot)[message.decision.cellIndex], snapshot), map.id);
    }
  } finally { await worker.terminate(); }
});
