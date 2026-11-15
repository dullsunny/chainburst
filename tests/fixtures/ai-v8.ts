// Frozen production v8 baseline (1363672), for equal-budget regression matches.
import { getTransferPlan, isPassiveSpecialCell, type GameMap } from '../../lib/explosion-game.ts';
import type { GameModeId } from '../../lib/game-modes.ts';
import { MATCH_LIMITS, type MatchSnapshot } from '../../lib/match-engine.ts';

export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'master';
export type PlayerController = 'human' | AiDifficulty;
export const AI_LEVELS: { id: AiDifficulty; name: string; description: string }[] = [
  { id: 'easy', name: '入门', description: '以探索和简单扩张为主，适合熟悉规则。' },
  { id: 'normal', name: '标准', description: '判断整条连锁，重视蓄能和领地。' },
  { id: 'hard', name: '困难', description: '预判对手反击，寻找连续进攻。' },
  { id: 'master', name: '大师', description: '更深搜索攻防与临界链，争取终局胜机。' },
];

export function controllerName(controller: PlayerController) {
  return controller === 'human' ? '真人' : `${AI_LEVELS.find((level) => level.id === controller)?.name ?? '标准'}人机`;
}

export interface AiPosition {
  owners: Int8Array;
  energy: Uint16Array;
  currentPlayer: number;
  winner: number | null;
  draw: boolean;
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
}

export interface AiDecision {
  cellIndex: number | null;
  depth: number;
  nodes: number;
  elapsedMs: number;
  score: number;
}

export function createAiBoard(map: GameMap, snapshot: MatchSnapshot): AiBoard {
  return {
    active: map.cells.filter((cell) => cell.active).map((cell) => cell.index),
    capacity: map.cells.map((cell) => cell.capacity),
    passive: map.cells.map(isPassiveSpecialCell),
    neighbors: map.cells.map((cell) => cell.neighbors),
    transfers: map.cells.map(getTransferPlan),
    stableEnergy: map.cells.reduce((sum, cell) => sum + (cell.active ? Math.max(0, cell.capacity - 1) : 0), 0),
    playerCount: snapshot.playerCount,
    mode: snapshot.mode,
    amount: snapshot.mode === 'surge' ? 2 : 1,
  };
}

export function createAiPosition(snapshot: MatchSnapshot): AiPosition {
  return {
    owners: Int8Array.from(snapshot.cells, (cell) => cell.owner ?? -1),
    energy: Uint16Array.from(snapshot.cells, (cell) => cell.energy),
    currentPlayer: snapshot.currentPlayer,
    winner: snapshot.winner,
    draw: snapshot.phase === 'draw',
  };
}

export function aiLegalMoves(board: AiBoard, position: AiPosition, actor = position.currentPlayer) {
  return board.active.filter((index) => !board.passive[index]
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
      energy[source] -= board.capacity[source];
      if (energy[source] === 0) owners[source] = -1;
    }
    for (const source of exploding) {
      for (const transfer of board.transfers[source]) {
        energy[transfer.target] += transfer.amount;
        owners[transfer.target] = actor;
      }
    }
    if (board.active.reduce((sum, cell) => sum + energy[cell], 0) > board.stableEnergy) {
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
  const result: AiPosition = { owners, energy, currentPlayer: actor, winner, draw: false };
  if (winner === null) {
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

function evaluate(board: AiBoard, position: AiPosition): number[] {
  if (position.winner !== null) return Array.from({ length: board.playerCount }, (_, player) => position.winner === player ? WIN : -WIN);
  if (position.draw) return Array<number>(board.playerCount).fill(0);
  const value = Array<number>(board.playerCount).fill(0);
  const counts = Array<number>(board.playerCount).fill(0);
  const legalCounts = Array<number>(board.playerCount).fill(0);
  let empty = 0;
  for (const cell of board.active) {
    const owner = position.owners[cell];
    const energy = position.energy[cell];
    if (owner < 0) {
      if (energy === 0 && !board.passive[cell]) empty += 1;
      continue;
    }
    counts[owner] += 1;
    if (!board.passive[cell]) legalCounts[owner] += 1;
    const capacity = board.capacity[cell];
    const gap = capacity - energy;
    // Territorial control matters more than stored energy. Low-capacity cells
    // develop quickly, but a loaded frontier can become the opponent's weapon.
    value[owner] += 50 + energy * 9 + 12 / capacity;
    if (!board.passive[cell]) value[owner] += 10 / Math.max(1, gap);
    let danger = 0;
    for (const neighbor of board.neighbors[cell]) {
      const neighborOwner = position.owners[neighbor];
      if (neighborOwner === owner) {
        value[owner] += position.energy[neighbor] >= board.capacity[neighbor] - 1 && gap <= 2 ? 2.5 : .8;
      } else if (neighborOwner >= 0) {
        const enemyGap = board.capacity[neighbor] - position.energy[neighbor];
        const incoming = board.transfers[neighbor].find((transfer) => transfer.target === cell)?.amount ?? 1;
        if (!board.passive[neighbor] && enemyGap <= board.amount) {
          danger += 11 + energy * 6 + (gap <= incoming ? 17 : 0);
        } else if (enemyGap <= 2 * board.amount) danger += 2 + energy * 1.1;
        if (!board.passive[cell] && gap <= board.amount) value[owner] += 7 + position.energy[neighbor] * 2;
      } else {
        value[owner] += 1.8 / Math.max(1, board.capacity[neighbor] - position.energy[neighbor]);
        if (position.energy[neighbor] > 0 && gap <= board.amount) value[owner] += 2;
      }
    }
    value[owner] -= danger;
  }
  for (let player = 0; player < board.playerCount; player += 1) {
    // Zero territory is not elimination: an empty neutral cell permits reentry.
    if (counts[player] === 0) value[player] -= empty > 0 ? 28 : 180;
    if (legalCounts[player] === 0 && empty === 0) value[player] -= 100;
    if (board.mode === 'dominion') value[player] += counts[player] * 20;
  }
  return value.map((own, player) => {
    const rivals = value.filter((_, other) => other !== player);
    return own - (board.playerCount === 2 ? rivals[0] : Math.max(...rivals) * .72 + rivals.reduce((sum, item) => sum + item, 0) / rivals.length * .28);
  });
}

interface Candidate { index: number; position: AiPosition; values: number[]; tactical: boolean }
interface TableEntry { depth: number; score: number; flag: 'exact' | 'lower' | 'upper' }
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
  const result: AiDecision = { cellIndex: legal[0] ?? null, depth: 0, nodes: 0, elapsedMs: 0, score: 0 };
  if (snapshot.phase !== 'playing' || !legal.length) return { ...result, cellIndex: null };
  const budget = options.timeMs ?? ({ easy: 70, normal: 160, hard: 650, master: 2_000 }[difficulty]);
  const deadline = start + Math.max(10, budget);
  const timeout = Symbol('search deadline');
  let nodes = 0;
  const checkpoint = () => { if (now() >= deadline) throw timeout; };
  const transition = (position: AiPosition, index: number) => {
    checkpoint();
    nodes += 1;
    return simulateAiMove(board, position, index, checkpoint);
  };
  const candidates = (position: AiPosition, rootScan = false): Candidate[] => {
    const actor = position.currentPlayer;
    const moves: Candidate[] = [];
    for (const index of aiLegalMoves(board, position)) {
      const next = transition(position, index);
      const move = {
        index, position: next, values: evaluate(board, next),
        tactical: position.energy[index] + board.amount >= board.capacity[index],
      };
      moves.push(move);
      if (rootScan && (moves.length === 1 || move.values[root] > result.score)) {
        result.cellIndex = index;
        result.score = move.values[root];
      }
      if (next.winner === actor) break;
    }
    moves.sort((a, b) => b.values[actor] - a.values[actor] || a.index - b.index);
    return moves;
  };
  const keyOf = (position: AiPosition) => `${position.currentPlayer}/${Array.from(position.owners).join(',')}/${Array.from(position.energy).join(',')}`;
  const table = new Map<string, TableEntry>();
  const width = difficulty === 'master' ? 12 : 8;
  const search = (position: AiPosition, depth: number, alpha: number, beta: number, extension: number): number => {
    checkpoint();
    if (position.winner !== null) return position.winner === root ? WIN + depth : -WIN - depth;
    if (position.draw) return 0;
    if (depth <= 0) {
      const noisy = extension > 0 && board.active.some((cell) => position.owners[cell] === position.currentPlayer
        && !board.passive[cell] && position.energy[cell] + board.amount >= board.capacity[cell]
        && board.neighbors[cell].some((neighbor) => position.owners[neighbor] >= 0 && position.owners[neighbor] !== position.currentPlayer));
      if (!noisy) return evaluate(board, position)[root];
      depth = 1;
      extension -= 1;
    }
    const key = `${extension}:${keyOf(position)}`;
    const cached = table.get(key);
    if (cached && cached.depth >= depth) {
      if (cached.flag === 'exact') return cached.score;
      if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
      else beta = Math.min(beta, cached.score);
      if (alpha >= beta) return cached.score;
    }
    const originalAlpha = alpha;
    const originalBeta = beta;
    const maximizing = position.currentPlayer === root;
    let score = maximizing ? -Infinity : Infinity;
    const all = candidates(position);
    // Search every reply at the tactical safety layer. Deeper layers use a
    // ranked beam, retaining immediate wins before quiet development moves.
    const moves = depth === 1 ? all : all.slice(0, width);
    for (const move of moves) {
      const value = search(move.position, depth - 1, alpha, beta, extension);
      score = maximizing ? Math.max(score, value) : Math.min(score, value);
      if (maximizing) alpha = Math.max(alpha, score); else beta = Math.min(beta, score);
      if (alpha >= beta) break;
    }
    if (!moves.length) return evaluate(board, position)[root];
    if (table.size > 35_000) table.clear();
    table.set(key, { depth, score, flag: score <= originalAlpha ? 'upper' : score >= originalBeta ? 'lower' : 'exact' });
    return score;
  };

  // Each rival chooses for itself in multiplayer; treating all rivals as a
  // perfect coalition needlessly sacrifices winning opportunities.
  const maxN = (position: AiPosition, depth: number): number[] => {
    checkpoint();
    if (depth <= 0 || position.winner !== null || position.draw) return evaluate(board, position);
    const actor = position.currentPlayer;
    let best: number[] | null = null;
    const all = candidates(position);
    for (const move of (depth === 1 ? all : all.slice(0, width))) {
      const values = maxN(move.position, depth - 1);
      if (!best || values[actor] > best[actor] || (values[actor] === best[actor] && values[root] < best[root])) best = values;
    }
    return best ?? evaluate(board, position);
  };

  try {
    const roots = candidates(initial, true);
    if (!roots.length) return result;
    const immediateWin = roots.find((move) => move.position.winner === root);
    if (immediateWin) {
      result.cellIndex = immediateWin.index;
      result.score = WIN;
      result.depth = 1;
    } else if (difficulty === 'easy') {
      // A forgiving opponent: usually explore; occasionally prefer expansion.
      const pool = random() < .75 ? roots : roots.slice(0, Math.max(2, Math.ceil(roots.length / 4)));
      const chosen = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
      result.cellIndex = chosen.index;
      result.score = chosen.values[root];
      result.depth = 1;
    } else {
      result.cellIndex = roots[0].index;
      result.score = roots[0].values[root];
      result.depth = 1;
      if (difficulty !== 'normal') {
        // A cheap, exact one-move-loss screen precedes selective deep search.
        // A quiet reply cannot create a cascade: only test it if adding a
        // territory could itself reach the mode's victory condition.
        const safeRoots: Candidate[] = [];
        let bestSafeScore = -Infinity;
        for (const move of roots) {
          const replyPosition = move.position;
          const opponent = replyPosition.currentPlayer;
          let losing = false;
          let worst = move.values[root];
          if (opponent !== root && !replyPosition.draw) {
            const counts = Array<number>(board.playerCount).fill(0);
            for (const cell of board.active) if (replyPosition.owners[cell] >= 0) counts[replyPosition.owners[cell]] += 1;
            const quietCanWin = board.mode === 'dominion'
              ? counts[opponent] + 1 >= Math.ceil(board.active.length * .6)
              : counts.filter((count) => count > 0).length <= 1 && counts[opponent] + 1 > board.active.length / 2;
            for (const reply of aiLegalMoves(board, replyPosition)) {
              if (replyPosition.energy[reply] + board.amount < board.capacity[reply] && !quietCanWin) continue;
              const next = transition(replyPosition, reply);
              if (next.winner === opponent) { losing = true; break; }
              worst = Math.min(worst, evaluate(board, next)[root]);
            }
          }
          if (!losing) {
            safeRoots.push(move);
            if (worst > bestSafeScore) {
              bestSafeScore = worst;
              result.cellIndex = move.index;
              result.score = worst;
            }
          }
        }
        const searchRoots = safeRoots.length ? safeRoots : roots;
        searchRoots.sort((a, b) => Number(b.index === result.cellIndex) - Number(a.index === result.cellIndex));
        const maxDepth = options.maxDepth ?? (difficulty === 'master' ? (board.playerCount === 2 ? 10 : board.playerCount + 2) : 4);
        let previousBest = result.cellIndex ?? searchRoots[0].index;
        for (let depth = 2; depth <= maxDepth; depth += 1) {
          const ordered = [...searchRoots].sort((a, b) => Number(b.index === previousBest) - Number(a.index === previousBest));
          const rootLimit = difficulty === 'master' ? 48 : 24;
          const retained = depth === 2 ? ordered : ordered.filter((move, index) => index < rootLimit || move.tactical);
          let bestScore = -Infinity;
          let bestIndex = previousBest;
          let alpha = -Infinity;
          for (const move of retained) {
            const score = board.playerCount === 2
              ? search(move.position, depth - 1, alpha, Infinity, difficulty === 'master' && depth >= 5 ? 1 : 0)
              : maxN(move.position, depth - 1)[root];
            if (score > bestScore) { bestScore = score; bestIndex = move.index; }
            alpha = Math.max(alpha, bestScore);
          }
          // Only a fully finished iteration can replace the previous decision.
          result.cellIndex = bestIndex;
          result.score = bestScore;
          result.depth = depth;
          previousBest = bestIndex;
          if (Math.abs(bestScore) >= WIN) break;
        }
      }
    }
  } catch (error) {
    if (error !== timeout) throw error;
  }
  result.nodes = nodes;
  result.elapsedMs = Math.round(now() - start);
  return result;
}
