import type { GameCell, GameMap, Transfer } from './explosion-game.ts';
import {
  countTerritory,
  explodeWave,
  findNextPlayablePlayer,
  findWinner,
  freshCells,
  isLegalMove,
  maxStableEnergy,
  stateKey,
} from './explosion-game.ts';
import { DOMINION_PERCENT, getDominionTarget, type GameModeId } from './game-modes.ts';

export type MatchPhase = 'playing' | 'finished' | 'draw';
export type MatchWinReason = 'classic' | 'dominion' | 'singularity' | 'stalemate' | null;

export interface DynamicCell {
  owner: number | null;
  energy: number;
}

export interface MatchSnapshot {
  rulesVersion: 2;
  revision: number;
  phase: MatchPhase;
  mapId: string;
  mode: GameModeId;
  dominionPercent?: number;
  playerCount: number;
  currentPlayer: number;
  moves: number;
  turnNumber: number;
  turnStep: 1 | 2;
  firstMoveIndex: number | null;
  hasEntered: boolean[];
  cells: DynamicCell[];
  winner: number | null;
  winReason: MatchWinReason;
}

export interface WaveEvent {
  exploding: number[];
  transfers: Transfer[];
}

export interface TurnResolved {
  revision: number;
  actor: number;
  cellIndex: number;
  amount: 1 | 2;
  turnNumber: number;
  turnStep: 1 | 2;
  waves: WaveEvent[];
  next: MatchSnapshot;
}

export type ResolveTurnError = 'MATCH_FINISHED' | 'NOT_YOUR_TURN' | 'CELL_NOT_FOUND' | 'ILLEGAL_MOVE' | 'CELL_ALREADY_USED';
export type ResolveTurnResult = { ok: true; value: TurnResolved } | { ok: false; error: ResolveTurnError };

export const MATCH_LIMITS = { maxWaves: 1024, maxTransfers: 20_000 } as const;

type LegacyMatchSnapshot = Omit<MatchSnapshot, 'rulesVersion' | 'turnNumber' | 'turnStep' | 'firstMoveIndex'> & { rulesVersion: 1 };

// Existing rooms adopt the two-placement rule at their next turn boundary.
// Historical lastTurn.amount remains untouched so old animations still replay.
export function normalizeMatchSnapshot(snapshot: MatchSnapshot | LegacyMatchSnapshot): MatchSnapshot {
  const current: MatchSnapshot = snapshot.rulesVersion === 2 ? snapshot : {
    ...snapshot, rulesVersion: 2, turnNumber: snapshot.moves + (snapshot.phase === 'playing' ? 1 : 0), turnStep: 1, firstMoveIndex: null,
  };
  // Saved matches opened before the per-match threshold used 60%.
  if (current.mode === 'dominion' && current.dominionPercent === undefined) return { ...current, dominionPercent: 60 };
  return current;
}

export function isMatchLegalMove(cell: GameCell | undefined, snapshot: MatchSnapshot): boolean {
  return !!cell && snapshot.phase === 'playing'
    && !(snapshot.mode === 'surge' && snapshot.turnStep === 2 && snapshot.firstMoveIndex === cell.index)
    && isLegalMove(cell, snapshot.currentPlayer);
}

export function createMatchSnapshot(map: GameMap, mode: GameModeId, playerCount: number, firstPlayer: number, revision: number): MatchSnapshot {
  return {
    rulesVersion: 2,
    revision,
    phase: 'playing',
    mapId: map.id,
    mode,
    ...(mode === 'dominion' ? { dominionPercent: DOMINION_PERCENT } : {}),
    playerCount,
    currentPlayer: firstPlayer,
    moves: 0,
    turnNumber: 1,
    turnStep: 1,
    firstMoveIndex: null,
    hasEntered: Array(playerCount).fill(false),
    cells: freshCells(map).map(({ owner, energy }) => ({ owner, energy })),
    winner: null,
    winReason: null,
  };
}

export function hydrateMatchCells(map: GameMap, snapshot: MatchSnapshot): GameCell[] {
  const base = freshCells(map);
  return base.map((cell, index) => ({
    ...cell,
    owner: snapshot.cells[index]?.owner ?? null,
    energy: Math.max(0, snapshot.cells[index]?.energy ?? cell.initialEnergy),
  }));
}

export function resolveTurn(map: GameMap, state: MatchSnapshot | LegacyMatchSnapshot, actor: number, cellIndex: number): ResolveTurnResult {
  const snapshot = normalizeMatchSnapshot(state);
  if (snapshot.phase !== 'playing') return { ok: false, error: 'MATCH_FINISHED' };
  if (snapshot.currentPlayer !== actor) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!Number.isInteger(cellIndex) || !map.cells[cellIndex]) return { ok: false, error: 'CELL_NOT_FOUND' };
  if (snapshot.mode === 'surge' && snapshot.turnStep === 2 && snapshot.firstMoveIndex === cellIndex) return { ok: false, error: 'CELL_ALREADY_USED' };

  let cells: GameCell[] = hydrateMatchCells(map, snapshot);
  if (!isLegalMove(cells[cellIndex], actor)) return { ok: false, error: 'ILLEGAL_MOVE' };

  const amount = 1;
  cells = cells.map((cell, index) => index === cellIndex
    ? { ...cell, owner: actor, energy: cell.energy + amount }
    : { ...cell });

  const hasEntered = [...snapshot.hasEntered];
  hasEntered[actor] = true;
  const waves: WaveEvent[] = [];
  const seen = new Set<string>();
  let transferCount = 0;
  let singularity = false;

  while (true) {
    const result = explodeWave(cells, actor);
    if (!result) break;

    const key = stateKey(cells);
    if (seen.has(key) || waves.length >= MATCH_LIMITS.maxWaves || transferCount + result.transfers.length > MATCH_LIMITS.maxTransfers) {
      singularity = true;
      break;
    }

    seen.add(key);
    transferCount += result.transfers.length;
    waves.push({ exploding: result.exploding, transfers: result.transfers });
    cells = result.afterTransfer;

    if (cells.reduce((sum, cell) => sum + cell.energy, 0) > maxStableEnergy(cells)) {
      singularity = true;
      break;
    }
  }

  let phase: MatchPhase = 'playing';
  let winner: number | null = null;
  let winReason: MatchWinReason = null;

  if (singularity) {
    phase = 'finished';
    winner = actor;
    winReason = 'singularity';
  } else if (snapshot.mode === 'dominion') {
    const target = getDominionTarget(cells.filter((cell) => cell.active).length, snapshot.dominionPercent);
    const result = countTerritory(cells, snapshot.playerCount).findIndex((count) => count >= target);
    if (result >= 0) {
      phase = 'finished';
      winner = result;
      winReason = 'dominion';
    }
  } else {
    winner = findWinner(cells, snapshot.playerCount);
    if (winner !== null) {
      phase = 'finished';
      winReason = 'classic';
    }
  }

  let currentPlayer = actor;
  let turnNumber = snapshot.turnNumber;
  let turnStep: 1 | 2 = 1;
  let firstMoveIndex: number | null = null;
  if (phase === 'playing') {
    if (snapshot.mode === 'surge' && snapshot.turnStep === 1 && cells.some((cell) => cell.index !== cellIndex && isLegalMove(cell, actor))) {
      turnStep = 2;
      firstMoveIndex = cellIndex;
    } else {
      const next = findNextPlayablePlayer(cells, actor, snapshot.playerCount);
      if (next === null) {
        phase = 'draw';
        winReason = 'stalemate';
      } else {
        currentPlayer = next;
        turnNumber += 1;
      }
    }
  }

  const next: MatchSnapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    phase,
    currentPlayer,
    turnNumber,
    turnStep,
    firstMoveIndex,
    moves: snapshot.moves + 1,
    hasEntered,
    cells: cells.map(({ owner, energy }) => ({ owner, energy })),
    winner,
    winReason,
  };

  return {
    ok: true,
    value: {
      revision: next.revision,
      actor,
      cellIndex,
      amount,
      turnNumber: snapshot.turnNumber,
      turnStep: snapshot.turnStep,
      waves,
      next,
    },
  };
}
