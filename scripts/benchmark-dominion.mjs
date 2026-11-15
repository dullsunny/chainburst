import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const variants = [60, 65, 70, 75, 80, 'classic'];
const seeds = [17231, 18181, 22097, 32933, 37691, 42379];
const matchups = ['ai', 'one-expansion-player', 'all-expansion-players'];
const scenarios = [
  ['classic-6', 2],
  ['classic-6', 3],
  ['triangle-8-v2', 2],
  ['hex-7', 3],
  ['cross-current', 4],
  ['forge-8', 2],
  ['refraction-valves', 3],
  ['quick-courtyard', 2],
];
const modules = ['explosion-game.ts', 'game-modes.ts', 'mixed-tilings.ts', 'match-engine.ts', 'game-ai.ts'];
const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const source = join(scriptDirectory, '..', 'lib');

function createVariant(root, variant) {
  const directory = join(root, String(variant));
  mkdirSync(directory);
  for (const filename of modules) {
    cpSync(join(source, filename), join(directory, filename));
  }
  if (variant !== 'classic') {
    const filename = join(directory, 'game-modes.ts');
    const original = readFileSync(filename, 'utf8');
    const threshold = /export const DOMINION_PERCENT = \d+;/;
    if (!threshold.test(original)) throw new Error('Cannot locate the shared dominion threshold');
    writeFileSync(filename, original.replace(threshold, 'export const DOMINION_PERCENT = ' + variant + ';'));
  }
  return directory;
}

function rng(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function activeDistances(map) {
  return map.cells.map((cell) => {
    if (!cell.active) return null;
    const distance = new Int16Array(map.cells.length).fill(1024);
    distance[cell.index] = 0;
    const queue = [cell.index];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      for (const neighbor of map.cells[index].neighbors) {
        if (distance[neighbor] !== 1024) continue;
        distance[neighbor] = distance[index] + 1;
        queue.push(neighbor);
      }
    }
    return distance;
  });
}

function chooseExpansionCell(map, cells, active, distance, emptyCells, actor, random) {
  const enemies = active.filter((index) => cells[index].owner !== null && cells[index].owner !== actor);
  const imminent = enemies.filter((index) => cells[index].energy >= map.cells[index].capacity - 1);
  let best = -Infinity;
  let bestIndex = -1;
  for (const index of emptyCells) {
    const distances = distance[index];
    const nearestEnemy = enemies.length ? enemies.reduce((low, enemy) => Math.min(low, distances[enemy]), 1024) : 0;
    const threat = imminent.reduce((total, enemy) => total + Math.max(0, 3 - distances[enemy]) ** 2, 0);
    const score = nearestEnemy * 7 - threat * 6 + map.cells[index].neighbors.length + random() * 4;
    if (score > best) {
      best = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function play(game, options, setup) {
  const { createMatchSnapshot, resolveTurn, chooseAiMove } = game;
  const { variant, maxDepth } = options;
  const { map, active, legalNeutral, distance, playerCount, firstPlayer, seed, matchup, expander } = setup;
  const openingRandom = rng(seed ^ 0xcdee5a);
  const neutralRandom = rng(seed ^ 0x1b2354);
  const aiRandom = rng(seed ^ 0xaec374);
  const mode = variant === 'classic' ? 'classic' : 'dominion';
  let snapshot = createMatchSnapshot(map, mode, playerCount, firstPlayer, 0);
  let emptyPlacements = 0;
  let captureTurns = 0;
  let firstCapture = null;
  let expanderPlacements = 0;
  let expanderNeutral = 0;
  let endQuiet = false;
  let waves = 0;
  let winnerTerritory = null;
  let enemyTerritory = null;

  while (snapshot.phase === 'playing' && snapshot.moves < 1200) {
    const actor = snapshot.currentPlayer;
    const emptyCells = legalNeutral.filter((index) => snapshot.cells[index].owner === null && snapshot.cells[index].energy === 0);
    const expanding = matchup === 'all-expansion-players' || expander === actor;
    let index;
    if (snapshot.moves < playerCount) {
      index = emptyCells[Math.floor(openingRandom() * emptyCells.length)];
    } else if (expanding && emptyCells.length) {
      index = chooseExpansionCell(map, snapshot.cells, active, distance, emptyCells, actor, neutralRandom);
    } else {
      // Replace wall time with a deterministic checkpoint budget.
      let checks = 0;
      const checksPerTick = maxDepth === 1 ? 300 : 650;
      index = chooseAiMove(map, snapshot, 'normal', {
        now: () => Math.floor(checks++ / checksPerTick),
        timeMs: 12,
        maxDepth,
        random: aiRandom,
      }).cellIndex;
    }
    if (index == null) throw new Error(map.id + ' has no move at step ' + snapshot.moves);
    const placed = snapshot.cells[index];
    const quiet = placed.owner === null && placed.energy === 0;
    emptyPlacements += Number(quiet);
    if (actor === expander) {
      expanderPlacements += 1;
      expanderNeutral += Number(quiet);
    }
    const move = resolveTurn(map, snapshot, actor, index);
    if (!move.ok) {
      throw new Error(JSON.stringify({ variant, maxDepth, map: map.id, seed, matchup, moves: snapshot.moves, index, error: move.error }));
    }
    const captured = move.value.waves.some((wave) => wave.transfers.some(({ target }) => {
      const priorOwner = snapshot.cells[target].owner;
      return priorOwner !== null && priorOwner !== actor;
    }));
    snapshot = move.value.next;
    waves += move.value.waves.length;
    if (captured) {
      firstCapture ??= snapshot.moves;
      captureTurns += 1;
    }
    if (snapshot.phase !== 'playing') {
      endQuiet = quiet && move.value.waves.length === 0;
      const occupied = snapshot.cells.filter((cell) => cell.owner !== null);
      winnerTerritory = occupied.filter((cell) => cell.owner === snapshot.winner).length;
      enemyTerritory = occupied.length - winnerTerritory;
    }
  }
  return {
    variant, maxDepth, map: map.id, active: active.length, playerCount, firstPlayer, seed, matchup, expander,
    moves: snapshot.moves, winner: snapshot.winner, reason: snapshot.winReason,
    emptyPlacements, captureTurns, firstCapture, endQuiet, waves, expanderPlacements, expanderNeutral,
    winnerTerritory, enemyTerritory,
  };
}

async function runVariant(options) {
  const { directory, sampleCount } = options;
  const load = (filename) => import(pathToFileURL(join(directory, filename)).href);
  const { MAP_LIBRARY, isPassiveSpecialCell } = await load('explosion-game.ts');
  const { createMatchSnapshot, resolveTurn } = await load('match-engine.ts');
  const { chooseAiMove } = await load('game-ai.ts');
  const game = { createMatchSnapshot, resolveTurn, chooseAiMove };
  const rows = [];
  for (const [mapId, playerCount] of scenarios) {
    const map = MAP_LIBRARY.find(({ id }) => id === mapId);
    if (!map) throw new Error('Missing map ' + mapId);
    const active = map.cells.filter((cell) => cell.active).map((cell) => cell.index);
    const legalNeutral = active.filter((index) => !isPassiveSpecialCell(map.cells[index]));
    const distance = activeDistances(map);
    for (const [sample, seed] of seeds.slice(0, sampleCount).entries()) {
      const firstPlayer = sample % playerCount;
      const expander = (sample + Math.floor(sample / playerCount)) % playerCount;
      for (const matchup of matchups) {
        rows.push(play(game, options, {
          map, active, legalNeutral, distance, playerCount, firstPlayer, seed, matchup,
          expander: matchup === 'one-expansion-player' ? expander : -1,
        }));
      }
    }
  }
  return rows;
}

function runWorker(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: options });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code) reject(new Error('Benchmark worker exited with code ' + code));
    });
  });
}

function summarize(rows, classicRows, variant) {
  const sum = (items, key) => items.reduce((total, row) => total + row[key], 0);
  const round = (number) => Number.isFinite(number) ? Number(number.toFixed(1)) : null;
  const mean = (items, key) => round(sum(items, key) / items.length);
  return {
    variant, games: rows.length, steps: mean(rows, 'moves'),
    fewerStepsPercent: round(100 * (1 - sum(rows, 'moves') / sum(classicRows, 'moves'))),
    neutralPercent: round(100 * sum(rows, 'emptyPlacements') / sum(rows, 'moves')),
    captureTurns: mean(rows, 'captureTurns'),
    firstCapture: mean(rows.filter(({ firstCapture }) => firstCapture !== null), 'firstCapture'),
    waves: mean(rows, 'waves'),
    quietEnds: rows.filter((row) => row.endQuiet).length,
    thresholdWinsWithEnemy: rows.filter((row) => row.reason === 'dominion' && row.enemyTerritory > 0).length,
    singularities: rows.filter((row) => row.reason === 'singularity').length,
    expanderNeutral: round(100 * sum(rows, 'expanderNeutral') / sum(rows, 'expanderPlacements')),
    expanderWins: rows.filter((row) => row.expander === row.winner).length,
    unfinished: rows.filter((row) => row.reason === null).length,
  };
}

async function main() {
  const depthArg = process.argv.find((arg) => arg.startsWith('--depth='));
  const depths = depthArg ? [Number(depthArg.slice('--depth='.length))] : [1, 2];
  const sampleArg = process.argv.find((arg) => arg.startsWith('--samples='));
  const sampleCount = sampleArg ? Number(sampleArg.slice('--samples='.length)) : seeds.length;
  const json = process.argv.includes('--json');
  if (!depths.every((depth) => depth === 1 || depth === 2)) throw new Error('Use --depth=1 or --depth=2');
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > seeds.length) throw new Error('Use --samples=1 to --samples=6');

  const work = join(scriptDirectory, '..', 'work');
  mkdirSync(work, { recursive: true });
  const temporary = mkdtempSync(join(work, 'dominion-benchmark-'));
  try {
    const directories = variants.map((variant) => createVariant(temporary, variant));
    for (const maxDepth of depths) {
      const outcomes = await Promise.allSettled(variants.map((variant, index) =>
        runWorker({ directory: directories[index], variant, maxDepth, sampleCount })));
      const failure = outcomes.find(({ status }) => status === 'rejected');
      if (failure) throw failure.reason;
      const results = outcomes.flatMap(({ value }) => value);
      if (json) {
        for (const row of results) console.log(JSON.stringify(row));
        continue;
      }
      for (const matchup of matchups) {
        const rows = results.filter((row) => row.matchup === matchup);
        const classic = rows.filter((row) => row.variant === 'classic');
        console.log('Search depth ' + maxDepth + ' / ' + matchup);
        console.table(variants.map((variant) => summarize(rows.filter((row) => row.variant === variant), classic, variant)));
      }
    }
  } finally {
    if (dirname(temporary) !== work) throw new Error('Invalid benchmark directory ' + temporary);
    rmSync(temporary, { recursive: true });
  }
}

if (isMainThread) await main(); else parentPort.postMessage(await runVariant(workerData));
