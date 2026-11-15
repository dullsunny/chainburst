import type { MatchSnapshot, TurnResolved } from '@/lib/match-engine';
import type { GameModeId } from '@/lib/game-modes';
import type { CustomMapSnapshot } from '@/lib/explosion-game';

export type OnlineRoomPhase = 'waiting' | 'playing' | 'finished' | 'draw';

export interface OnlineSeat {
  id: string;
  seat: number;
  name: string;
  ready: boolean;
  isHost: boolean;
}

export interface OnlineTurnEvent extends Omit<TurnResolved, 'next'> {
  readyAt: number;
}

export interface OnlineAbortProposal {
  id: string;
  proposerSeatId: string;
  proposerName: string;
  approvals: string[];
  createdAt: number;
  expiresAt: number;
}

export interface OnlineRoomView {
  code: string;
  phase: OnlineRoomPhase;
  targetPlayers: number;
  mapId: string;
  mapName: string;
  customMap: CustomMapSnapshot | null;
  mode: GameModeId;
  previewEnabled: boolean;
  revision: number;
  seats: OnlineSeat[];
  meSeat: number;
  isHost: boolean;
  match: MatchSnapshot | null;
  lastTurn: OnlineTurnEvent | null;
  abortProposal: OnlineAbortProposal | null;
  updatedAt: number;
}

export interface OnlineSuccess {
  ok: true;
  room: OnlineRoomView;
  token?: string;
}

export interface OnlineFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    retryAt?: number;
  };
}

export type OnlineResponse = OnlineSuccess | OnlineFailure;
