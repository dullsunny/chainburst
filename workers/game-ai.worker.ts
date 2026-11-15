import { chooseAiMove, type AiDifficulty } from '../lib/game-ai.ts';
import type { GameMap } from '../lib/explosion-game.ts';
import type { MatchSnapshot } from '../lib/match-engine.ts';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; map: GameMap; snapshot: MatchSnapshot; difficulty: AiDifficulty }>) => void) | null;
  postMessage: (message: unknown) => void;
};
worker.onmessage = ({ data }) => {
  try {
    worker.postMessage({ id: data.id, decision: chooseAiMove(data.map, data.snapshot, data.difficulty) });
  } catch {
    worker.postMessage({ id: data.id, error: 'AI_SEARCH_FAILED' });
  }
};
