// Same reachable positions, native budgets, alternating old/new call order.
// node --experimental-strip-types scripts/benchmark-ai-latency.mjs [--output=work/latency.jsonl]
import { appendFileSync } from 'node:fs';
import { MAP_LIBRARY, createCustomMap } from '../lib/explosion-game.ts';
import { createMatchSnapshot, resolveTurn } from '../lib/match-engine.ts';
import { aiLegalMoves, createAiBoard, createAiPosition, chooseAiMove } from '../lib/game-ai.ts';
import { chooseAiMove as previous } from '../tests/fixtures/ai-v14.ts';

const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
const log = (row) => { const line = JSON.stringify(row); console.log(line); if (output) appendFileSync(output, line + '\n'); };
let seed = 20261114;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const samples = [];
for (const map of [MAP_LIBRARY[0], MAP_LIBRARY.find((map) => map.id === 'triangle-8-v2'), createCustomMap(0, 20, 20)]) {
  for (const mode of ['classic', 'surge', 'dominion']) {
    let snapshot = createMatchSnapshot(map, mode, 2, 0, 0);
    for (let step = 0; step <= 24 && snapshot.phase === 'playing'; step++) {
      if (step % 12 === 0) samples.push({ map, snapshot });
      const position = createAiPosition(snapshot);
      const legal = aiLegalMoves(createAiBoard(map, snapshot), position);
      const charged = legal.filter((index) => position.energy[index] > 0);
      const pool = charged.length && random() < .7 ? charged : legal;
      snapshot = resolveTurn(map, snapshot, snapshot.currentPlayer, pool[Math.floor(random() * pool.length)]).value.next;
    }
  }
}
// Warm both implementations before collecting wall time.
for (const choose of [previous, chooseAiMove]) choose(samples[0].map, samples[0].snapshot, 'normal', { timeMs: 20 });
for (const level of ['easy', 'normal', 'hard', 'master']) {
  const selected = level === 'easy' || level === 'normal' ? samples : samples.filter((_, index) => index % 5 === 2);
  const stats = { previous: [], upgraded: [] };
  for (const [index, { map, snapshot }] of selected.entries()) {
    const order = index % 2 ? [['upgraded', chooseAiMove], ['previous', previous]] : [['previous', previous], ['upgraded', chooseAiMove]];
    for (const [name, choose] of order) {
      const start = performance.now();
      const decision = choose(map, snapshot, level, { random: () => .42 });
      const elapsed = performance.now() - start;
      if (!resolveTurn(map, snapshot, snapshot.currentPlayer, decision.cellIndex).ok) throw new Error('Illegal benchmark decision');
      stats[name].push(elapsed);
    }
  }
  log({ level, samples: selected.length, ...Object.fromEntries(Object.entries(stats).map(([name, times]) => {
    times.sort((a, b) => a - b);
    return [name, { meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
      p50Ms: +times[Math.floor(times.length * .5)].toFixed(2), p95Ms: +times[Math.min(times.length - 1, Math.floor(times.length * .95))].toFixed(2) }];
  })) });
}
