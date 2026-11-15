// Frozen pre-upgrade AI from 66b879b (production v14 rules), imports only relocated.
import { getTransferPlan, isPassiveSpecialCell, type GameMap } from '../../lib/explosion-game.ts';
import type { GameModeId } from '../../lib/game-modes.ts';
import { MATCH_LIMITS, normalizeMatchSnapshot, type MatchSnapshot } from '../../lib/match-engine.ts';

export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'master';
export type PlayerController = 'human' | AiDifficulty;
export const AI_LEVELS: { id: AiDifficulty; name: string; description: string }[] = [
  { id: 'easy', name: '入门', description: '以探索和简单扩张为主，适合熟悉规则。' },
  { id: 'normal', name: '标准', description: '计算完整连锁与反击，积累可发动的据点。' },
  { id: 'hard', name: '困难', description: '深入推演攻防，避免安静防守和反杀陷阱。' },
  { id: 'master', name: '大师', description: '完整检查防守，深入搜索临界链和终局胜机。' },
];

export function controllerName(controller: PlayerController) {
  return controller === 'human' ? '真人' : `${AI_LEVELS.find((level) => level.id === controller)?.name ?? '标准'}人机`;
}

export interface AiPosition {
  owners: Int8Array;
  energy: Uint16Array;
  currentPlayer: number;
  turnStep: 1 | 2;
  firstMoveIndex: number | null;
  winner: number | null;
  draw: boolean;
  hashA?: number;
  hashB?: number;
  totalEnergy?: number;
}

export interface AiBoard {
  active: number[];
  capacity: number[];
  passive: boolean[];
  neighbors: number[][];
  transfers: { target: number; amount: number }[][];
  stableEnergy: number;
  playerCount: number;
  mode: GameModeId;
  amount: number;
  incoming: { source: number; amount: number }[][];
}

export interface AiDecision {
  cellIndex: number | null;
  depth: number;
  nodes: number;
  elapsedMs: number;
  score: number;
  search?: 'full-width';
}

export function createAiBoard(map: GameMap, snapshot: MatchSnapshot): AiBoard {
  const transfers = map.cells.map(getTransferPlan);
  const incoming = map.cells.map((): { source: number; amount: number }[] => []);
  transfers.forEach((plan, source) => plan.forEach(({ target, amount }) => incoming[target].push({ source, amount })));
  return {
    active: map.cells.filter((cell) => cell.active).map((cell) => cell.index),
    capacity: map.cells.map((cell) => cell.capacity),
    passive: map.cells.map(isPassiveSpecialCell),
    neighbors: map.cells.map((cell) => cell.neighbors),
    transfers,
    incoming,
    stableEnergy: map.cells.reduce((sum, cell) => sum + (cell.active ? Math.max(0, cell.capacity - 1) : 0), 0),
    playerCount: snapshot.playerCount,
    mode: snapshot.mode,
    amount: 1,
  };
}

export function createAiPosition(snapshot: MatchSnapshot): AiPosition {
  snapshot = normalizeMatchSnapshot(snapshot);
  const position: AiPosition = {
    owners: Int8Array.from(snapshot.cells, (cell) => cell.owner ?? -1),
    energy: Uint16Array.from(snapshot.cells, (cell) => cell.energy),
    currentPlayer: snapshot.currentPlayer,
    turnStep: snapshot.turnStep,
    firstMoveIndex: snapshot.firstMoveIndex,
    winner: snapshot.winner,
    draw: snapshot.phase === 'draw',
  };
  const [hashA, hashB] = hashPosition(position);
  return { ...position, hashA, hashB };
}

function mix(value: number) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function cellHash(index: number, owner: number, energy: number, salt: number) {
  return mix(Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(owner + 2, 0x85ebca6b) ^ Math.imul(energy + 1, 0xc2b2ae35) ^ salt);
}

function hashPosition(position: AiPosition): [number, number] {
  let a = 0, b = 0;
  for (let index = 0; index < position.owners.length; index += 1) {
    a ^= cellHash(index, position.owners[index], position.energy[index], 0x1234abcd);
    b ^= cellHash(index, position.owners[index], position.energy[index], 0x98fedcba);
  }
  return [a >>> 0, b >>> 0];
}

function positionKey(position: AiPosition) {
  if (position.hashA === undefined || position.hashB === undefined) [position.hashA, position.hashB] = hashPosition(position);
  return `${position.currentPlayer}:${position.turnStep}:${position.firstMoveIndex ?? '-'}:${position.hashA}:${position.hashB}`;
}

export function aiLegalMoves(board: AiBoard, position: AiPosition, actor = position.currentPlayer) {
  return board.active.filter((index) => !board.passive[index]
    && !(board.mode === 'surge' && actor === position.currentPlayer && position.turnStep === 2 && position.firstMoveIndex === index)
    && (position.owners[index] === actor || (position.owners[index] === -1 && position.energy[index] === 0)));
}

// This compact simulator uses exactly the authoritative engine's synchronous
// waves, retained overflow, ownership, terminal checks and resource limits.
// Geometry and animation events are immutable and unnecessary in a search tree.
export function simulateAiMove(board: AiBoard, position: AiPosition, index: number, checkpoint?: () => void): AiPosition {
  const actor = position.currentPlayer;
  const owners = position.owners.slice();
  const energy = position.energy.slice();
  owners[index] = actor;
  energy[index] += board.amount;
  const affected = new Set<number>([index]);
  let totalEnergy = (position.totalEnergy ?? board.active.reduce((sum, cell) => sum + position.energy[cell], 0)) + board.amount;
  const seen = new Set<string>();
  let waveCount = 0;
  let transferCount = 0;
  let singularity = false;
  while (true) {
    checkpoint?.();
    const exploding = board.active.filter((cell) => energy[cell] >= board.capacity[cell]);
    if (!exploding.length) break;
    const key = board.active.map((cell) => `${owners[cell]}:${energy[cell]}`).join('|');
    const nextTransfers = exploding.reduce((sum, cell) => sum + board.transfers[cell].length, 0);
    if (seen.has(key) || waveCount >= MATCH_LIMITS.maxWaves || transferCount + nextTransfers > MATCH_LIMITS.maxTransfers) {
      singularity = true;
      break;
    }
    seen.add(key);
    waveCount += 1;
    transferCount += nextTransfers;
    for (const source of exploding) {
      affected.add(source);
      energy[source] -= board.capacity[source];
      totalEnergy += board.transfers[source].reduce((sum, transfer) => sum + transfer.amount, 0) - board.capacity[source];
      if (energy[source] === 0) owners[source] = -1;
    }
    for (const source of exploding) {
      for (const transfer of board.transfers[source]) {
        affected.add(transfer.target);
        energy[transfer.target] += transfer.amount;
        owners[transfer.target] = actor;
      }
    }
    if (totalEnergy > board.stableEnergy) {
      singularity = true;
      break;
    }
  }
  const counts = Array<number>(board.playerCount).fill(0);
  for (const cell of board.active) if (owners[cell] >= 0) counts[owners[cell]] += 1;
  let winner: number | null = null;
  if (singularity) winner = actor;
  else if (board.mode === 'dominion') {
    const found = counts.findIndex((count) => count >= Math.ceil(board.active.length * .6));
    if (found >= 0) winner = found;
  } else {
    const occupied = counts.flatMap((count, player) => count > 0 ? [player] : []);
    if (occupied.length === 1 && counts[occupied[0]] > board.active.length / 2) winner = occupied[0];
  }
  let [hashA, hashB] = position.hashA === undefined || position.hashB === undefined ? hashPosition(position) : [position.hashA, position.hashB];
  for (const cell of affected) {
    hashA ^= cellHash(cell, position.owners[cell], position.energy[cell], 0x1234abcd) ^ cellHash(cell, owners[cell], energy[cell], 0x1234abcd);
    hashB ^= cellHash(cell, position.owners[cell], position.energy[cell], 0x98fedcba) ^ cellHash(cell, owners[cell], energy[cell], 0x98fedcba);
  }
  const result: AiPosition = { owners, energy, currentPlayer: actor, turnStep: 1, firstMoveIndex: null, winner, draw: false, hashA: hashA >>> 0, hashB: hashB >>> 0, totalEnergy };
  if (winner === null) {
    if (board.mode === 'surge' && position.turnStep === 1 && aiLegalMoves(board, result, actor).some((cell) => cell !== index)) {
      result.turnStep = 2;
      result.firstMoveIndex = index;
      return result;
    }
    let next: number | null = null;
    for (let offset = 1; offset <= board.playerCount; offset += 1) {
      const candidate = (actor + offset) % board.playerCount;
      if (aiLegalMoves(board, result, candidate).length) { next = candidate; break; }
    }
    if (next === null) result.draw = true;
    else result.currentPlayer = next;
  }
  return result;
}

const WIN = 10_000_000;
const MATE_THRESHOLD = WIN - 1_000;

function evaluate(board: AiBoard, position: AiPosition): number[] {
  if (position.winner !== null) return Array.from({ length: board.playerCount }, (_, player) => position.winner === player ? WIN : -WIN);
  if (position.draw) return Array<number>(board.playerCount).fill(0);
  const value = Array<number>(board.playerCount).fill(0);
  const counts = Array<number>(board.playerCount).fill(0);
  const playable = Array<number>(board.playerCount).fill(0);
  const order = (player: number) => (player - position.currentPlayer + board.playerCount) % board.playerCount;
  let empty = 0;
  for (const cell of board.active) {
    const owner = position.owners[cell];
    const energy = position.energy[cell];
    if (owner < 0) {
      if (energy === 0 && !board.passive[cell]) empty += 1;
      continue;
    }
    counts[owner] += 1;
    if (!board.passive[cell]) playable[owner] += 1;
    const capacity = board.capacity[cell];
    const gap = capacity - energy;
    const readiness = energy / capacity;
    // Classic needs mature launch sites, not a carpet of isolated one-orb cells.
    value[owner] += (board.mode === 'dominion' ? 66 : 28) + energy * 17 + readiness * readiness * 19;
    if (!board.passive[cell]) {
      value[owner] += 10 / Math.max(1, gap) + 9 / capacity;
      if (gap <= board.amount) value[owner] += 22;
    } else value[owner] -= 9;
    for (const incoming of board.incoming[cell]) {
      const source = incoming.source;
      const sourceOwner = position.owners[source];
      const sourceGap = board.capacity[source] - position.energy[source];
      if (sourceOwner === owner) {
        value[owner] += position.energy[source] > 0 ? 2.5 : 0;
      } else if (sourceOwner >= 0 && !board.passive[source]) {
        if (sourceGap <= board.amount) {
          const sooner = order(sourceOwner) < order(owner);
          value[owner] -= (16 + energy * 10 + (gap <= incoming.amount ? 26 : 0)) * (sooner ? 1 : .35);
        } else if (sourceGap <= 2 * board.amount && gap <= incoming.amount) value[owner] -= 5 + energy * 2;
      }
    }
    if (!board.passive[cell]) {
      for (const transfer of board.transfers[cell]) {
        const target = transfer.target;
        const targetOwner = position.owners[target];
        const targetGap = board.capacity[target] - position.energy[target];
        if (targetOwner >= 0 && targetOwner !== owner) {
          // Charging an attack that can reach the enemy's threshold is useful.
          value[owner] += (gap <= board.amount ? 10 : 4) + (targetGap <= transfer.amount ? 16 : 0) / Math.max(1, gap);
        } else if (targetOwner < 0) value[owner] += (position.energy[target] ? 6 : 2) / Math.max(1, gap);
      }
    }
  }

  // Critical components may contain multiple colours. Credit the player who
  // can activate first, not every owner for energy that can be stolen at once.
  const seen = new Uint8Array(position.energy.length);
  for (const seed of board.active) {
    if (seen[seed] || position.energy[seed] < board.capacity[seed] - 1 || position.energy[seed] === 0) continue;
    const component: number[] = [];
    const queue = [seed];
    seen[seed] = 1;
    while (queue.length) {
      const cell = queue.pop()!;
      component.push(cell);
      for (const next of board.neighbors[cell]) {
        if (!seen[next] && position.energy[next] > 0 && position.energy[next] >= board.capacity[next] - 1) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    if (component.length < 2) continue;
    let controller = -1;
    let earliest = Infinity;
    let potential = 0;
    const held = Array<number>(board.playerCount).fill(0);
    for (const cell of component) {
      const owner = position.owners[cell];
      const weight = 11 + position.energy[cell] * 4;
      potential += weight;
      if (owner >= 0) held[owner] += weight;
      const consider = (source: number) => {
        const player = position.owners[source];
        if (player < 0 || board.passive[source] || position.energy[source] + board.amount < board.capacity[source]) return;
        if (order(player) < earliest) { earliest = order(player); controller = player; }
      };
      consider(cell);
      for (const incoming of board.incoming[cell]) if (incoming.amount >= board.capacity[cell] - position.energy[cell]) consider(incoming.source);
    }
    if (controller >= 0) {
      value[controller] += (potential - held[controller]) * .8 + Math.min(30, component.length * 5);
      for (let player = 0; player < board.playerCount; player += 1) if (player !== controller) value[player] -= held[player] * .7;
    }
  }
  for (let player = 0; player < board.playerCount; player += 1) {
    value[player] += Math.sqrt(playable[player]) * 8;
    if (counts[player] === 0) value[player] -= empty > 0 ? 45 : 300;
    if (playable[player] === 0 && empty === 0) value[player] -= 160;
  }
  return value.map((own, player) => {
    const rivals = value.filter((_, other) => other !== player);
    return Math.round(own - (board.playerCount === 2 ? rivals[0] : Math.max(...rivals) * .8 + rivals.reduce((sum, item) => sum + item, 0) / rivals.length * .2));
  });
}

interface TableEntry { depth: number; score: number; flag: 'exact' | 'lower' | 'upper'; best: number }
export interface AiSearchOptions {
  timeMs?: number;
  maxDepth?: number;
  random?: () => number;
  now?: () => number;
}

export function chooseAiMove(map: GameMap, snapshot: MatchSnapshot, difficulty: AiDifficulty, options: AiSearchOptions = {}): AiDecision {
  const now = options.now ?? (() => performance.now());
  const random = options.random ?? Math.random;
  const start = now();
  const board = createAiBoard(map, snapshot);
  const initial = createAiPosition(snapshot);
  const root = initial.currentPlayer;
  const legal = aiLegalMoves(board, initial);
  const result: AiDecision = { cellIndex: legal[0] ?? null, depth: 0, nodes: 0, elapsedMs: 0, score: 0, search: 'full-width' };
  if (snapshot.phase !== 'playing' || !legal.length) return { ...result, cellIndex: null };
  const budget = options.timeMs ?? ({ easy: 80, normal: 350, hard: 1_200, master: 4_500 }[difficulty]);
  const deadline = start + Math.max(10, budget);
  const timeout = Symbol('search deadline');
  let nodes = 0;
  const checkpoint = () => { if (now() >= deadline) throw timeout; };
  const table = new Map<string, TableEntry>();
  const children = new Map<string, AiPosition>();
  const evaluations = new WeakMap<AiPosition, number[]>();
  const childLimit = Math.max(128, Math.floor(800_000 / Math.max(1, map.cells.length)));
  const killers: number[][] = Array.from({ length: 64 }, () => []);
  const history = Array.from({ length: board.playerCount }, () => new Float64Array(map.cells.length));
  const values = (position: AiPosition) => {
    let cached = evaluations.get(position);
    if (!cached) { cached = evaluate(board, position); evaluations.set(position, cached); }
    return cached;
  };
  const transition = (position: AiPosition, index: number): AiPosition => {
    checkpoint();
    const key = positionKey(position) + '/' + index;
    const cached = children.get(key);
    if (cached) return cached;
    nodes += 1;
    const next = simulateAiMove(board, position, index, checkpoint);
    if (children.size >= childLimit) children.delete(children.keys().next().value!);
    children.set(key, next);
    return next;
  };
  const movePriority = (position: AiPosition, index: number, ply: number, preferred: number) => {
    if (index === preferred) return 1e12;
    const actor = position.currentPlayer;
    const energy = position.energy[index];
    const gap = board.capacity[index] - energy;
    const exploding = gap <= board.amount;
    let score = exploding ? 2_000 : 100 + energy * 18 + 80 / Math.max(1, gap);
    if (position.owners[index] === -1) score += 35 + 14 / board.capacity[index];
    for (const transfer of board.transfers[index]) {
      const target = transfer.target;
      const owner = position.owners[target];
      const targetGap = board.capacity[target] - position.energy[target];
      if (owner >= 0 && owner !== actor) {
        score += (exploding ? 250 : 22) + position.energy[target] * (exploding ? 35 : 3);
        if (targetGap <= transfer.amount) score += exploding ? 600 : 85;
      } else if (owner < 0) score += exploding ? 35 + position.energy[target] * 18 : 3;
    }
    if (!exploding) for (const incoming of board.incoming[index]) {
      const other = position.owners[incoming.source];
      if (other >= 0 && other !== actor && !board.passive[incoming.source]
        && position.energy[incoming.source] + board.amount >= board.capacity[incoming.source]) score -= 300;
    }
    if (killers[ply]?.[0] === index) score += 30_000;
    else if (killers[ply]?.[1] === index) score += 20_000;
    return score + Math.min(12_000, history[actor][index]);
  };
  const orderedMoves = (position: AiPosition, ply: number, preferred = -1) => aiLegalMoves(board, position)
    .map((index) => ({ index, priority: movePriority(position, index, ply, preferred) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index).map((item) => item.index);
  const recordCutoff = (position: AiPosition, move: number, ply: number, depth: number) => {
    if (position.energy[move] + board.amount < board.capacity[move]) {
      if (killers[ply][0] !== move) killers[ply] = [move, killers[ply][0]].filter((item) => item !== undefined);
      history[position.currentPlayer][move] += depth * depth * 12;
    }
  };
  const terminalScore = (position: AiPosition, ply: number) => position.winner === root ? WIN - ply : -WIN + ply;
  const storeScore = (score: number, ply: number) => score >= MATE_THRESHOLD ? score + ply : score <= -MATE_THRESHOLD ? score - ply : score;
  const loadScore = (score: number, ply: number) => score >= MATE_THRESHOLD ? score - ply : score <= -MATE_THRESHOLD ? score + ply : score;

  // Full legal-move coverage: a quiet defence must never disappear merely
  // because a static score ranked it outside a beam. Children are simulated
  // only when visited, so alpha-beta can avoid the actual expensive work.
  const search = (position: AiPosition, depth: number, alpha: number, beta: number, ply: number): number => {
    checkpoint();
    if (position.winner !== null) return terminalScore(position, ply);
    if (position.draw) return 0;
    if (depth <= 0) return values(position)[root];
    const key = positionKey(position);
    const cached = table.get(key);
    const originalAlpha = alpha;
    const originalBeta = beta;
    if (cached && cached.depth >= depth) {
      const score = loadScore(cached.score, ply);
      if (cached.flag === 'exact') return score;
      if (cached.flag === 'lower') alpha = Math.max(alpha, score); else beta = Math.min(beta, score);
      if (alpha >= beta) return score;
    }
    const maximizing = position.currentPlayer === root;
    let best = maximizing ? -Infinity : Infinity;
    let bestMove = -1;
    let first = true;
    for (const index of orderedMoves(position, ply, cached?.best)) {
      const child = transition(position, index);
      let score: number;
      if (first) score = search(child, depth - 1, alpha, beta, ply + 1);
      else if (maximizing) {
        score = search(child, depth - 1, alpha, Math.min(beta, alpha + 1), ply + 1);
        if (score > alpha && score < beta) score = search(child, depth - 1, alpha, beta, ply + 1);
      } else {
        score = search(child, depth - 1, Math.max(alpha, beta - 1), beta, ply + 1);
        if (score < beta && score > alpha) score = search(child, depth - 1, alpha, beta, ply + 1);
      }
      first = false;
      if (maximizing ? score > best : score < best) { best = score; bestMove = index; }
      if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
      if (alpha >= beta) { recordCutoff(position, index, ply, depth); break; }
    }
    if (bestMove < 0) return values(position)[root];
    if (table.size >= 80_000) table.clear();
    table.set(key, { depth, score: storeScore(best, ply), best: bestMove,
      flag: best <= originalAlpha ? 'upper' : best >= originalBeta ? 'lower' : 'exact' });
    return best;
  };

  // Max-N lets every rival pursue its own result rather than forming a perfect
  // coalition. Its children are also lazy and never drop quiet legal defences.
  const multiTable = new Map<string, { depth: number; values: number[]; best: number }>();
  const maxN = (position: AiPosition, depth: number, ply: number): number[] => {
    checkpoint();
    if (position.winner !== null) return Array.from({ length: board.playerCount }, (_, player) => position.winner === player ? WIN - ply : -WIN + ply);
    if (depth <= 0 || position.draw) return values(position);
    const key = positionKey(position);
    const cached = multiTable.get(key);
    // Include ply because vector terminal distance belongs to the root.
    const cacheKey = key + '/' + ply;
    const hit = multiTable.get(cacheKey);
    if (hit && hit.depth >= depth) return hit.values;
    const actor = position.currentPlayer;
    let best: number[] | null = null;
    let bestMove = -1;
    for (const index of orderedMoves(position, ply, cached?.best)) {
      const child = transition(position, index);
      const scores = maxN(child, depth - 1, ply + 1);
      if (!best || scores[actor] > best[actor] || (scores[actor] === best[actor] && scores[root] < best[root])) {
        best = scores; bestMove = index;
      }
      if (scores[actor] >= WIN - ply - 1) break;
    }
    const answer = best ?? values(position);
    if (multiTable.size > 35_000) multiTable.clear();
    multiTable.set(cacheKey, { depth, values: answer, best: bestMove });
    multiTable.set(key, { depth: -1, values: answer, best: bestMove });
    return answer;
  };


  try {
    const roots: { index: number; position: AiPosition; score: number; safe: boolean }[] = [];
    let bestStatic = -Infinity;
    for (const index of orderedMoves(initial, 0)) {
      const next = transition(initial, index);
      const score = values(next)[root];
      roots.push({ index, position: next, score, safe: true });
      if (score > bestStatic) { bestStatic = score; result.cellIndex = index; result.score = score; }
      if (next.winner === root) {
        result.cellIndex = index; result.score = WIN - 1; result.depth = 1;
        result.nodes = nodes; result.elapsedMs = Math.round(now() - start); return result;
      }
    }
    roots.sort((a, b) => b.score - a.score || a.index - b.index);
    result.depth = 1;
    if (difficulty === 'easy') {
      const pool = random() < .7 ? roots : roots.slice(0, Math.max(2, Math.ceil(roots.length / 4)));
      const chosen = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
      result.cellIndex = chosen.index; result.score = chosen.score;
    } else {
      // Before deeper search, finish cheap immediate-win checks for each root.
      // Preserve the best fully checked safe move even if the budget expires.
      let safeBest = -Infinity;
      for (const move of roots) {
        const reply = move.position;
        let worst = move.score;
        if (reply.currentPlayer !== root && !reply.draw) {
          const opponent = reply.currentPlayer;
          let opponentCount = 0, otherColours = false;
          for (const cell of board.active) {
            if (reply.owners[cell] === opponent) opponentCount += 1;
            else if (reply.owners[cell] >= 0) otherColours = true;
          }
          const quietCanWin = board.mode === 'dominion' ? opponentCount + 1 >= Math.ceil(board.active.length * .6)
            : !otherColours && opponentCount + 1 > board.active.length / 2;
          for (const index of orderedMoves(reply, 1)) {
            if (reply.energy[index] + board.amount < board.capacity[index] && !quietCanWin) continue;
            const next = transition(reply, index);
            if (next.winner === opponent) { move.safe = false; break; }
            worst = Math.min(worst, values(next)[root]);
          }
        }
        if (move.safe && worst > safeBest) {
          safeBest = worst; result.cellIndex = move.index; result.score = worst;
        }
      }
      const hasSafe = roots.some((move) => move.safe);
      const retained = hasSafe ? roots.filter((move) => move.safe) : roots;
      const left = Math.ceil((board.stableEnergy - board.active.reduce((sum, index) => sum + initial.energy[index], 0)) / board.amount) + 1;
      const defaultDepth = difficulty === 'master' ? Math.max(16, left <= 18 ? left + 1 : 0) : difficulty === 'hard' ? 9 : board.mode === 'surge' ? 4 : 3;
      const maxDepth = Math.min(40, options.maxDepth ?? defaultDepth);
      let previousBest = result.cellIndex;
      const previousScores = new Map<number, number>();
      for (let depth = 2; depth <= maxDepth; depth += 1) {
        retained.sort((a, b) => Number(b.index === previousBest) - Number(a.index === previousBest)
          || (previousScores.get(b.index) ?? b.score) - (previousScores.get(a.index) ?? a.score));
        let best = -Infinity;
        let bestMove = retained[0].index;
        let alpha = -Infinity;
        const completedScores = new Map<number, number>();
        for (const move of retained) {
          const score = board.playerCount === 2 ? search(move.position, depth - 1, alpha, Infinity, 1)
            : maxN(move.position, depth - 1, 1)[root];
          completedScores.set(move.index, score);
          if (score > best) { best = score; bestMove = move.index; }
          alpha = Math.max(alpha, best);
        }
        // No beam/late-move reductions: this terminal result covers every legal
        // defence, including quiet moves. Only finished iterations replace it.
        result.cellIndex = bestMove; result.score = best; result.depth = depth;
        previousBest = bestMove;
        for (const [index, score] of completedScores) previousScores.set(index, score);
        if (Math.abs(best) >= MATE_THRESHOLD) break;
      }
    }
  } catch (error) {
    if (error !== timeout) throw error;
  }
  result.nodes = nodes;
  result.elapsedMs = Math.round(now() - start);
  return result;
}
