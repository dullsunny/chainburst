import type { GameMap } from '../lib/explosion-game.ts';
import type { MatchSnapshot } from '../lib/match-engine.ts';
import { calculateMovePreview } from '../lib/move-preview.ts';

type PreviewRequest = { type: 'init'; generation: number; map: GameMap; snapshot: MatchSnapshot }
  | { type: 'preview'; generation: number; index: number };
const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null; postMessage: (message: unknown) => void };
let state: Extract<PreviewRequest, { type: 'init' }> | null = null;
worker.onmessage = ({ data }) => {
  if (data.type === 'init') { state = data; return; }
  if (!state || data.generation !== state.generation) return;
  try {
    worker.postMessage({ generation: data.generation, index: data.index, result: calculateMovePreview(state.map, state.snapshot, data.index) });
  } catch {
    worker.postMessage({ generation: data.generation, index: data.index, result: null, error: true });
  }
};
