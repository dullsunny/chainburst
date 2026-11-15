// Direct regression against the immediately preceding v14 AI (66b879b).
// npm run test:ai-benchmark [-- --multiplayer] [-- --time=200] [-- --levels]
// Time-bounded results vary with CPU speed; report losses and unfinished games.
import { MAP_LIBRARY } from '../lib/explosion-game.ts';
import { createMatchSnapshot, resolveTurn } from '../lib/match-engine.ts';
import { AI_TIME_BUDGETS, chooseAiMove } from '../lib/game-ai.ts';
import { chooseAiMove as choosePreviousMove } from '../tests/fixtures/ai-v14.ts';
import { appendFileSync } from 'node:fs';

const output = process.argv.find((argument) => argument.startsWith('--output='))?.slice(9);
const log = (row) => { const line = JSON.stringify(row); console.log(line); if (output) appendFileSync(output, line + '\n'); };

const multiplayer = process.argv.includes('--multiplayer');
const levels = process.argv.includes('--levels');
const production = process.argv.includes('--production');
const scaleArgument = process.argv.find((argument) => argument.startsWith('--scale='));
const scale = scaleArgument ? Number(scaleArgument.slice(8)) : 1;
if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw new Error('Scale must be in (0, 1]');
const mapFilter = process.argv.find((argument) => argument.startsWith('--map='))?.slice(6);
const timeArgument = process.argv.find((argument) => argument.startsWith('--time='));
const timeMs = timeArgument ? Number(timeArgument.slice('--time='.length)) : 200;
if (!Number.isFinite(timeMs) || timeMs < 10 || timeMs > 10_000) throw new Error('Time must be 10–10000 milliseconds');
const scenarios = multiplayer ? [
  { mapId: 'classic-6', mode: 'classic' },
  { mapId: 'classic-6', mode: 'dominion' },
  { mapId: 'classic-6', mode: 'surge' },
] : [
  { mapId: 'classic-6', mode: 'classic' },
  { mapId: 'classic-6', mode: 'dominion' },
  { mapId: 'triangle-8-v2', mode: 'classic' },
  { mapId: 'hex-7', mode: 'dominion' },
  { mapId: 'classic-6', mode: 'surge' },
];
const playerCount = multiplayer ? 3 : 2;
const rows = [];
for (const scenario of scenarios) {
 if (mapFilter && scenario.mapId !== mapFilter) continue;
 for (const opponent of levels ? ['easy', 'normal', 'hard'] : ['master']) {
  const upgradedLevel = levels ? { easy: 'normal', normal: 'hard', hard: 'master' }[opponent] : 'master';
  for (let upgradedSeat = 0; upgradedSeat < playerCount; upgradedSeat += 1) {
    const map = MAP_LIBRARY.find((item) => item.id === scenario.mapId);
    let snapshot = createMatchSnapshot(map, scenario.mode, playerCount, 0, 0);
    const totals = Array.from({ length: playerCount }, () => ({ depth: 0, nodes: 0, moves: 0, times: [] }));
    let seed = 20261114;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    while (snapshot.phase === 'playing' && snapshot.moves < 500) {
      const actor = snapshot.currentPlayer;
      const upgraded = actor === upgradedSeat;
      const started = performance.now();
      const level = upgraded ? upgradedLevel : opponent;
      const budget = production || levels ? (upgraded || levels ? AI_TIME_BUDGETS[level] : 4500) * scale : timeMs;
      const decision = (upgraded || levels ? chooseAiMove : choosePreviousMove)(map, snapshot, level, { timeMs: budget, random });
      totals[actor].depth += decision.depth;
      totals[actor].nodes += decision.nodes;
      totals[actor].moves += 1;
      totals[actor].times.push(performance.now() - started);
      const turn = resolveTurn(map, snapshot, actor, decision.cellIndex);
      if (!turn.ok) throw new Error('Illegal decision: ' + JSON.stringify(decision));
      snapshot = turn.value.next;
    }
    const row = {
      ...scenario, playerCount, budget: production || levels ? `production x ${scale}` : timeMs, upgradedLevel, opponent: levels ? opponent : 'v14-master', upgradedSeat, firstPlayer: 0,
      upgradedWon: snapshot.winner === upgradedSeat, winner: snapshot.winner,
      moves: snapshot.moves, winReason: snapshot.winReason,
      averages: totals.map((seat) => ({
        depth: Number((seat.depth / Math.max(1, seat.moves)).toFixed(2)),
        nodes: Math.round(seat.nodes / Math.max(1, seat.moves)),
        meanMs: Number((seat.times.reduce((sum, time) => sum + time, 0) / Math.max(1, seat.moves)).toFixed(2)),
        p95Ms: Number(seat.times.sort((a, b) => a - b)[Math.min(seat.moves - 1, Math.floor(seat.moves * .95))]?.toFixed(2)),
      })),
    };
    rows.push(row);
    log(row);
  }
 }
}
log({
  games: rows.length, budget: production || levels ? `production x ${scale}` : timeMs,
  upgradedWins: rows.filter((row) => row.upgradedWon).length,
  opponentWins: rows.filter((row) => row.winner !== null && !row.upgradedWon).length,
  drawsOrUnfinished: rows.filter((row) => row.winner === null).length,
});
