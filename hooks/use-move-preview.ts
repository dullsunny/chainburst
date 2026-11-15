'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMap } from '@/lib/explosion-game';
import type { MatchSnapshot } from '@/lib/match-engine';
import type { MovePreview } from '@/lib/move-preview';
import MovePreviewWorker from '@/workers/move-preview.worker?worker';

interface PreviewView { index: number | null; result: MovePreview | null; pending: boolean; failed: boolean }
const empty: PreviewView = { index: null, result: null, pending: false, failed: false };

export function useMovePreview(map: GameMap, snapshot: MatchSnapshot | undefined, enabled: boolean) {
  const [view, setView] = useState<PreviewView>(empty);
  const generation = useRef(0);
  const active = useRef<number | null>(null);
  const queued = useRef<number | null>(null);
  const busy = useRef(false);
  const cache = useRef(new Map<number, MovePreview>());
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(snapshot);
  current.current = snapshot;
  const key = snapshot ? `${snapshot.mapId}:${snapshot.mode}:${snapshot.dominionPercent}:${snapshot.playerCount}:${snapshot.revision}:${snapshot.phase}:${snapshot.currentPlayer}:${snapshot.turnStep}:${snapshot.firstMoveIndex}` : '';
  const contextKey = useRef('');
  const desiredKey = `${enabled}:${key}`;

  const clear = useCallback(() => {
    active.current = null;
    queued.current = null;
    if (timer.current) clearTimeout(timer.current);
    setView(empty);
  }, []);

  useEffect(() => {
    const id = ++generation.current;
    contextKey.current = desiredKey;
    clear();
    cache.current.clear();
    busy.current = false;
    if (!enabled || !current.current) return;
    let instance: Worker | undefined;
    try {
      instance = new MovePreviewWorker();
      worker.current = instance;
      instance.postMessage({ type: 'init', generation: id, map, snapshot: current.current });
      instance.onmessage = ({ data }: MessageEvent<{ generation: number; index: number; result: MovePreview | null; error?: boolean }>) => {
        if (id !== generation.current || data.generation !== id) return;
        busy.current = false;
        if (data.result) {
          if (cache.current.size >= 32) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(data.index, data.result);
        }
        if (active.current === data.index) setView({ index: data.index, result: data.result, pending: false, failed: !!data.error });
        const next = queued.current;
        queued.current = null;
        if (next !== null && next === active.current && !cache.current.has(next)) {
          busy.current = true;
          instance?.postMessage({ type: 'preview', generation: id, index: next });
        }
      };
      instance.onerror = (event) => {
        console.warn('落子预览线程未能启动', event.message);
        if (id !== generation.current) return;
        instance?.terminate();
        worker.current = null;
        queued.current = null;
        busy.current = false;
        setView({ index: active.current, result: null, pending: false, failed: true });
      };
    } catch (error) {
      console.warn('落子预览暂不可用', error);
      instance?.terminate();
      worker.current = null;
      setView({ index: active.current, result: null, pending: false, failed: true });
    }
    return () => {
      generation.current += 1;
      instance?.terminate();
      worker.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [map, desiredKey, enabled, clear]);

  const show = useCallback((index: number, immediate = false) => {
    if (!enabled || contextKey.current !== desiredKey) return;
    active.current = index;
    if (timer.current) clearTimeout(timer.current);
    const cached = cache.current.get(index);
    setView({ index, result: cached ?? null, pending: !cached && !!worker.current, failed: !worker.current });
    if (cached) return;
    timer.current = setTimeout(() => {
      if (active.current !== index || !worker.current) return;
      if (busy.current) { queued.current = index; return; }
      busy.current = true;
      worker.current.postMessage({ type: 'preview', generation: generation.current, index });
    }, immediate ? 0 : 35);
  }, [enabled, desiredKey]);

  // An obsolete response can never flash during the render before effect cleanup.
  return { ...(enabled && contextKey.current === desiredKey ? view : empty), show, clear };
}
