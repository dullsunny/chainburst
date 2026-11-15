import type { GameMap } from './explosion-game.ts';
import { resolveTurn, type DynamicCell, type MatchSnapshot, type MatchWinReason } from './match-engine.ts';

export interface MovePreview {
  cellIndex: number;
  cells: DynamicCell[];
  winner: number | null;
  winReason: MatchWinReason;
  waveCount: number;
}

// The real rule engine is the only source of preview outcomes. Nothing in this
// result is ever written back into a live match or sent as an online move.
export function calculateMovePreview(map: GameMap, snapshot: MatchSnapshot, cellIndex: number): MovePreview | null {
  const result = resolveTurn(map, snapshot, snapshot.currentPlayer, cellIndex);
  if (!result.ok) return null;
  const { next, waves } = result.value;
  return { cellIndex, cells: next.cells, winner: next.winner, winReason: next.winReason, waveCount: waves.length };
}

export function compactEnergyView(map: GameMap, zoom: number, fittedWidth: number): boolean {
  const dense = Math.max(map.rows, map.cols) > 12 || map.cells.length > 180;
  if (!dense) return false;
  const smallestWidth = Math.min(...map.cells.filter((cell) => cell.active).map((cell) => cell.geometry?.width ?? 1));
  return zoom < 1.6 || smallestWidth / map.geometry.width * fittedWidth * zoom < 23;
}
