'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bolt, Bot, BookOpen, Gauge, GraduationCap, Grid3X3, PencilRuler, RotateCcw, Settings2, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { GameBoard } from '@/components/game-board';
import type { LastMove } from '@/components/last-move-mark';
import { LearningCenter } from '@/components/learning-center';
import { GameLobby } from '@/components/game-lobby';
import { MapEditor } from '@/components/map-editor';
import { OnlinePlay } from '@/components/online-play';
import { ENERGY_DISPLAY_LABELS, isEnergyDisplayMode, type EnergyDisplayMode } from '@/lib/energy-display';
import { DOMINION_PERCENT, GAME_MODES, getDominionTarget, type GameModeId } from '@/lib/game-modes';
import { chooseAiMove, controllerName, type AiDecision, type PlayerController } from '@/lib/game-ai';
import GameAiWorker from '@/workers/game-ai.worker?worker';
import { hydrateMatchCells, isMatchLegalMove, resolveTurn, type MatchSnapshot, type MatchWinReason } from '@/lib/match-engine';
import {
  GameCell,
  GameMap,
  CUSTOM_MAP_SLOT_COUNT,
  MAP_LIBRARY,
  PLAYER_STYLES,
  Transfer,
  countTerritory,
  createCustomMap,
  deserializeCustomMap,
  freshCells,
  isLegalMove,
  migrateLegacyCustomMap,
  serializeCustomMap,
  validateMap,
} from '@/lib/explosion-game';

type Screen = 'lobby' | 'game' | 'editor' | 'online';
const onlineAvailable = typeof __CHAINBURST_OFFLINE__ === 'undefined' || !__CHAINBURST_OFFLINE__;
type WinReason = MatchWinReason;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const CUSTOM_MAPS_KEY = 'chainburst-custom-maps-v2';
const LEGACY_CUSTOM_MAP_KEY = 'chainburst-custom-map';
const ENERGY_DISPLAY_KEY = 'chainburst-energy-display';

function persistCustomMaps(maps: Array<GameMap | null>) {
  try {
    window.localStorage.setItem(CUSTOM_MAPS_KEY, JSON.stringify({
      version: 2,
      slots: maps.map((map) => map ? serializeCustomMap(map) : null),
    }));
  } catch {
    // Local saving is optional; the maps remain available for this tab.
  }
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('lobby');
  const [playerCount, setPlayerCount] = useState(2);
  const [matchPlayerCount, setMatchPlayerCount] = useState(2);
  const [controllers, setControllers] = useState<PlayerController[]>(Array(6).fill('human'));
  const [matchControllers, setMatchControllers] = useState<PlayerController[]>(Array(6).fill('human'));
  const [mode, setMode] = useState<GameModeId>('classic');
  const [matchMode, setMatchMode] = useState<GameModeId>('classic');
  const [selectedMapId, setSelectedMapId] = useState(MAP_LIBRARY[0].id);
  const [customMaps, setCustomMaps] = useState<Array<GameMap | null>>(() => (
    Array.from({ length: CUSTOM_MAP_SLOT_COUNT }, (_, index) => index === 0 ? createCustomMap(0) : null)
  ));
  const [editorSlot, setEditorSlot] = useState(0);
  const [currentMap, setCurrentMap] = useState<GameMap>(MAP_LIBRARY[0]);
  const [cells, setCells] = useState<GameCell[]>(() => freshCells(MAP_LIBRARY[0]));
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [moves, setMoves] = useState(0);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [turnNumber, setTurnNumber] = useState(1);
  const [turnStep, setTurnStep] = useState<1 | 2>(1);
  const [firstMoveIndex, setFirstMoveIndex] = useState<number | null>(null);
  const [hasEntered, setHasEntered] = useState<boolean[]>(Array(6).fill(false));
  const [winner, setWinner] = useState<number | null>(null);
  const [draw, setDraw] = useState(false);
  const [winReason, setWinReason] = useState<WinReason>(null);
  const [resolving, setResolving] = useState(false);
  const [waveNumber, setWaveNumber] = useState(0);
  const [exploding, setExploding] = useState<number[]>([]);
  const [receiving, setReceiving] = useState<number[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [energyDisplayMode, setEnergyDisplayMode] = useState<EnergyDisplayMode>('auto');
  const [learningView, setLearningView] = useState<'rules' | 'tutorial' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const matchSession = useRef(0);
  const resolutionToken = useRef(0);
  const moveLock = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const audioBus = useRef<{ compressor: DynamicsCompressorNode; master: GainNode; sfx: GainNode; music: GainNode } | null>(null);
  const soundEnabledRef = useRef(true);
  const musicEnabledRef = useRef(true);
  const musicTimer = useRef<number | null>(null);
  const musicStep = useRef(0);
  const musicSession = useRef(0);

  const maps = useMemo(() => [...MAP_LIBRARY, ...customMaps.filter((map): map is GameMap => map !== null)], [customMaps]);
  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? maps[0];
  const counts = useMemo(() => countTerritory(cells, matchPlayerCount), [cells, matchPlayerCount]);
  const canMove = useMemo(() => Array.from({ length: matchPlayerCount }, (_, player) => cells.some((cell) => isLegalMove(cell, player))), [cells, matchPlayerCount]);
  const activeCellCount = useMemo(() => cells.filter((cell) => cell.active).length, [cells]);
  const currentController = matchControllers[currentPlayer] ?? 'human';
  const isAiTurn = currentController !== 'human';
  const hasAi = matchControllers.slice(0, matchPlayerCount).some((controller) => controller !== 'human');

  useEffect(() => {
    try {
      const storage = window.localStorage;
      setPreviewEnabled(storage.getItem('chainburst-preview-enabled') !== 'false');
      const displayMode = storage.getItem(ENERGY_DISPLAY_KEY);
      if (isEnergyDisplayMode(displayMode)) setEnergyDisplayMode(displayMode);
    } catch {
      // Preferences remain usable for this tab if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    let restoredCurrent = false;
    try {
      const saved = window.localStorage.getItem(CUSTOM_MAPS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { version?: number; slots?: unknown[] };
        if (parsed.version === 2 && Array.isArray(parsed.slots)) {
          const restored = Array.from({ length: CUSTOM_MAP_SLOT_COUNT }, (_, index) => {
            const value = parsed.slots?.[index];
            return value == null ? null : deserializeCustomMap(value, index);
          });
          setCustomMaps(restored);
          restoredCurrent = true;
        }
      }
    } catch {
      // Try the legacy single-slot save below.
    }

    if (restoredCurrent) return;

    try {
      const legacy = window.localStorage.getItem(LEGACY_CUSTOM_MAP_KEY);
      if (legacy) {
        const restored = migrateLegacyCustomMap(JSON.parse(legacy), 0);
        if (restored) {
          const migrated = [restored, null, null, null];
          setCustomMaps(migrated);
          persistCustomMaps(migrated);
        }
      }
    } catch {
      // A malformed legacy draft should never block the game.
    }
  }, []);

  useEffect(() => {
    if (!onlineAvailable) return;
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (roomCode) setScreen('online');
  }, []);

  useEffect(() => {
    if (screen === 'game' && window.matchMedia('(min-width: 901px)').matches) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [screen]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    const bus = audioBus.current;
    const context = audioContext.current;
    if (!bus || !context) return;
    bus.sfx.gain.cancelScheduledValues(context.currentTime);
    bus.sfx.gain.setTargetAtTime(soundEnabled ? 1 : .0001, context.currentTime, .012);
  }, [soundEnabled]);

  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = audioContext.current ?? new AudioContextClass();
    audioContext.current = context;
    if (!audioBus.current) {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 7;
      compressor.attack.value = .003;
      compressor.release.value = .16;
      const master = context.createGain();
      const sfx = context.createGain();
      const music = context.createGain();
      master.gain.value = .92;
      sfx.gain.value = soundEnabledRef.current ? 1 : .0001;
      music.gain.value = .0001;
      sfx.connect(compressor);
      music.connect(compressor);
      compressor.connect(master).connect(context.destination);
      audioBus.current = { compressor, master, sfx, music };
    }
    return { context, bus: audioBus.current };
  }, []);

  const stopMusic = useCallback(() => {
    musicSession.current += 1;
    if (musicTimer.current !== null) {
      window.clearInterval(musicTimer.current);
      musicTimer.current = null;
    }
    const context = audioContext.current;
    const bus = audioBus.current;
    if (!context || !bus) return;
    bus.music.gain.cancelScheduledValues(context.currentTime);
    bus.music.gain.setTargetAtTime(.0001, context.currentTime, .08);
  }, []);

  const startMusic = useCallback(() => {
    if (!musicEnabledRef.current || musicTimer.current !== null) return;
    try {
      const audio = ensureAudio();
      if (!audio) return;
      const { context, bus } = audio;
      const session = musicSession.current;
      const begin = () => {
        if (session !== musicSession.current || !musicEnabledRef.current || musicTimer.current !== null || context.state !== 'running') return;
        bus.music.gain.cancelScheduledValues(context.currentTime);
        bus.music.gain.setTargetAtTime(.24, context.currentTime, .12);
        musicStep.current = 0;
        const melody = [220, 261.63, 329.63, 293.66, 196, 246.94, 329.63, 392, 220, 293.66, 349.23, 329.63, 196, 261.63, 293.66, 246.94];
        const bass = [110, 98, 130.81, 87.31];
        const scheduleVoice = (frequency: number, type: OscillatorType, duration: number, peak: number, delay = 0) => {
          const start = context.currentTime + delay;
          const oscillator = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          oscillator.type = type;
          oscillator.frequency.value = frequency;
          filter.type = 'lowpass';
          filter.frequency.value = type === 'sine' ? 620 : 1450;
          gain.gain.setValueAtTime(.0001, start);
          gain.gain.exponentialRampToValueAtTime(peak, start + .035);
          gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
          oscillator.connect(filter).connect(gain).connect(bus.music);
          oscillator.start(start);
          oscillator.stop(start + duration + .02);
          oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
        };
        const tick = () => {
          if (!musicEnabledRef.current || session !== musicSession.current) return;
          const step = musicStep.current;
          scheduleVoice(melody[step % melody.length], 'triangle', .38, .055);
          if (step % 4 === 0) scheduleVoice(bass[Math.floor(step / 4) % bass.length], 'sine', 1.15, .085, .015);
          if (step % 8 === 6) scheduleVoice(melody[(step + 4) % melody.length] * 2, 'sine', .28, .025, .08);
          musicStep.current += 1;
        };
        tick();
        musicTimer.current = window.setInterval(tick, 410);
      };
      if (context.state === 'running') begin();
      else void context.resume().then(begin).catch(() => undefined);
    } catch {
      // Browsers may keep Web Audio locked until another explicit interaction.
    }
  }, [ensureAudio]);

  useEffect(() => {
    musicEnabledRef.current = musicEnabled;
    if (!musicEnabled || !['game', 'online'].includes(screen) || (screen === 'game' && (winner !== null || draw))) stopMusic();
    else if (audioContext.current) startMusic();
  }, [draw, musicEnabled, screen, startMusic, stopMusic, winner]);

  useEffect(() => () => {
    if (musicTimer.current !== null) window.clearInterval(musicTimer.current);
    void audioContext.current?.close();
  }, []);

  const playSound = useCallback((kind: 'place' | 'burst' | 'win', player = 0, burstCount = 1, accelerated = false) => {
    if (!soundEnabledRef.current || typeof window === 'undefined') return;
    try {
      const audio = ensureAudio();
      if (!audio) return;
      const { context, bus } = audio;
      if (context.state === 'suspended') void context.resume();
      const now = context.currentTime;
      const eventGain = context.createGain();
      const impact = kind === 'burst' ? Math.min(1.7, .78 + Math.log2(burstCount + 1) * .24) : 1;
      eventGain.gain.value = impact;
      eventGain.connect(bus.sfx);

      if (kind === 'burst' && musicEnabledRef.current) {
        bus.music.gain.cancelScheduledValues(now);
        bus.music.gain.setTargetAtTime(.075, now, .012);
        bus.music.gain.setTargetAtTime(.24, now + .12, .18);
      }

      const tone = (type: OscillatorType, from: number, to: number, delay: number, duration: number, peak: number) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + delay;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, to), start + duration);
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + .004);
        gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(gain).connect(eventGain);
        oscillator.start(start);
        oscillator.stop(start + duration + .015);
      };

      if (kind === 'place') {
        const base = 280 + player * 38;
        tone('sine', base, base * 1.5, 0, .11, .18);
        tone('triangle', base * 2, base * 1.2, 0, .065, .07);
      } else if (kind === 'burst') {
        const duration = accelerated ? .11 : .22;
        tone('sine', 145, 52, 0, duration, .5);
        tone('sawtooth', 430, 105, 0, Math.min(.125, duration), .22);
        const noiseLength = Math.floor(context.sampleRate * (accelerated ? .035 : .055));
        const buffer = context.createBuffer(1, noiseLength, context.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let sample = 0; sample < channel.length; sample += 1) channel[sample] = Math.random() * 2 - 1;
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const noiseGain = context.createGain();
        filter.type = 'bandpass';
        filter.frequency.value = 920;
        filter.Q.value = .75;
        noiseGain.gain.setValueAtTime(.34, now);
        noiseGain.gain.exponentialRampToValueAtTime(.0001, now + noiseLength / context.sampleRate);
        source.buffer = buffer;
        source.connect(filter).connect(noiseGain).connect(eventGain);
        source.start(now);
      } else {
        [523.25, 659.25, 783.99].forEach((frequency, index) => tone('triangle', frequency, frequency * 1.03, index * .085, .42, .2));
        tone('sine', 261.63, 392, 0, .62, .19);
      }
    } catch {
      // Audio is enhancement-only and may be blocked by browser policy.
    }
  }, [ensureAudio]);

  const startGame = useCallback((map: GameMap, players = playerCount, selectedMode = mode, seats = controllers) => {
    matchSession.current += 1;
    resolutionToken.current += 1;
    moveLock.current = false;
    const firstPlayer = Math.floor(Math.random() * players);
    setPlayerCount(players);
    setMatchPlayerCount(players);
    setMatchControllers([...seats]);
    setMode(selectedMode);
    setMatchMode(selectedMode);
    setCurrentMap(map);
    setCells(freshCells(map));
    setCurrentPlayer(firstPlayer);
    setMoves(0);
    setLastMove(null);
    setTurnNumber(1);
    setTurnStep(1);
    setFirstMoveIndex(null);
    setHasEntered(Array(6).fill(false));
    setWinner(null);
    setDraw(false);
    setAiNotice('');
    setWinReason(null);
    setResolving(false);
    setWaveNumber(0);
    setExploding([]);
    setReceiving([]);
    setTransfers([]);
    setScreen('game');
    stopMusic();
    if (musicEnabledRef.current) startMusic();
  }, [controllers, mode, playerCount, startMusic, stopMusic]);

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: {
        registerTool: (tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
          execute: (input: unknown) => Promise<unknown>;
        }, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const mapIds = maps.map((map) => map.id);
    try {
      void Promise.resolve(context.registerTool({
        name: 'start_explosion_chess_match',
        title: '开始爆炸棋对局',
        description: '选择地图、玩家人数与模式，并在可见界面中开始一局新的爆炸棋。',
        inputSchema: {
          type: 'object',
          properties: {
            mapId: { type: 'string', enum: mapIds },
            players: { type: 'integer', minimum: 2, maximum: 6 },
            mode: { type: 'string', enum: ['classic', 'surge', 'dominion'] },
          },
          required: ['mapId', 'players', 'mode'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const data = input as { mapId?: string; players?: number; mode?: GameModeId };
          const map = maps.find((item) => item.id === data.mapId);
          if (!map || !Number.isInteger(data.players) || (data.players ?? 0) < 2 || (data.players ?? 0) > 6 || !['classic', 'surge', 'dominion'].includes(data.mode ?? '') || validateMap(map, data.players).length > 0) throw new Error('地图、人数或模式无效');
          startGame(map, data.players, data.mode);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          return { status: 'started', map: map.name, players: data.players, mode: data.mode };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {
      // Unsupported WebMCP implementations are safely ignored.
    }
    return () => lifecycle.abort();
  }, [maps, startGame]);

  const snapshot = useMemo<MatchSnapshot>(() => ({
    rulesVersion: 2, revision: moves, phase: winner !== null ? 'finished' : draw ? 'draw' : 'playing',
    mapId: currentMap.id, mode: matchMode, playerCount: matchPlayerCount, currentPlayer, moves, hasEntered,
    dominionPercent: matchMode === 'dominion' ? DOMINION_PERCENT : undefined,
    turnNumber, turnStep, firstMoveIndex,
    cells: cells.map(({ owner, energy }) => ({ owner, energy })), winner, winReason,
  }), [cells, currentMap.id, currentPlayer, draw, hasEntered, matchPlayerCount, matchMode, moves, turnNumber, turnStep, firstMoveIndex, winReason, winner]);

  const placeEnergy = useCallback(async (index: number, byAi = false) => {
    if (screen !== 'game' || moveLock.current || resolving || winner !== null || draw || !cells[index]
      || (isAiTurn !== byAi) || !isMatchLegalMove(cells[index], snapshot)) return;
    const resolved = resolveTurn(currentMap, snapshot, currentPlayer, index);
    if (!resolved.ok) return;
    if (musicEnabledRef.current) startMusic();
    moveLock.current = true;
    const token = resolutionToken.current + 1;
    resolutionToken.current = token;
    const { actor, cellIndex, revision, amount, waves, next: finalSnapshot } = resolved.value;
    let next = cells.map((cell, cellIndex) => cellIndex === index ? { ...cell, owner: currentPlayer, energy: cell.energy + amount } : { ...cell });
    setAiNotice('');
    setCells(next);
    setLastMove({ actor, cellIndex, revision });
    setMoves((value) => value + 1);
    setResolving(true);
    playSound('place', currentPlayer);
    await wait(reducedMotion ? 70 : 130);
    const visibleWaves = waves;
    for (let wave = 0; wave < visibleWaves.length; wave += 1) {
      if (resolutionToken.current !== token) return;
      const event = visibleWaves[wave];
      const accelerated = wave >= 12;
      const duration = reducedMotion ? Math.max(12, Math.min(90, 6_000 / Math.max(1, waves.length)))
        : accelerated ? Math.max(12, Math.min(180, 8_000 / Math.max(1, waves.length - 12))) : 620;
      next = next.map((cell) => ({ ...cell }));
      for (const source of event.exploding) {
        next[source].energy -= next[source].capacity;
        if (next[source].energy === 0) next[source].owner = null;
      }
      setWaveNumber(wave + 1);
      setExploding(event.exploding);
      setReceiving([]);
      setTransfers([]);
      setCells(next);
      playSound('burst', currentPlayer, event.exploding.length, accelerated);
      await wait(duration * .42);
      if (resolutionToken.current !== token) return;
      setExploding([]);
      setTransfers(event.transfers);
      await wait(duration * .28);
      if (resolutionToken.current !== token) return;
      next = next.map((cell) => ({ ...cell }));
      for (const transfer of event.transfers) {
        next[transfer.target].energy += transfer.amount;
        next[transfer.target].owner = currentPlayer;
      }
      setTransfers([]);
      setReceiving([...new Set(event.transfers.map((transfer) => transfer.target))]);
      setCells(next);
      await wait(duration * .3);
    }
    if (resolutionToken.current !== token) return;
    setCells(hydrateMatchCells(currentMap, finalSnapshot));
    setHasEntered(finalSnapshot.hasEntered);
    setCurrentPlayer(finalSnapshot.currentPlayer);
    setTurnNumber(finalSnapshot.turnNumber);
    setTurnStep(finalSnapshot.turnStep);
    setFirstMoveIndex(finalSnapshot.firstMoveIndex);
    setWinner(finalSnapshot.winner);
    setDraw(finalSnapshot.phase === 'draw');
    setWinReason(finalSnapshot.winReason);
    setResolving(false);
    moveLock.current = false;
    setWaveNumber(0);
    setExploding([]);
    setReceiving([]);
    setTransfers([]);
    if (finalSnapshot.winner !== null) playSound('win', finalSnapshot.winner);
  }, [cells, currentMap, currentPlayer, draw, isAiTurn, playSound, reducedMotion, resolving, screen, snapshot, startMusic, winner]);

  useEffect(() => {
    if (screen !== 'game' || resolving || winner !== null || draw || currentController === 'human') return;
    const session = matchSession.current;
    const request = resolutionToken.current;
    let active = true;
    let completed = false;
    let worker: Worker | null = null;
    let watchdog: number | undefined;
    let settleTimer: number | undefined;
    const started = performance.now();
    const accept = (decision: AiDecision) => {
      if (!active || completed || matchSession.current !== session || resolutionToken.current !== request) return;
      completed = true;
      worker?.terminate();
      window.clearTimeout(watchdog);
      const index = decision.cellIndex;
      const fallback = cells.findIndex((cell) => isMatchLegalMove(cell, snapshot));
      const legalIndex = index !== null && isMatchLegalMove(cells[index], snapshot) ? index : fallback;
      if (legalIndex < 0) return;
      settleTimer = window.setTimeout(() => {
        if (active && matchSession.current === session && resolutionToken.current === request) void placeEnergy(legalIndex, true);
      }, Math.max(0, (currentController === 'easy' ? 70 : currentController === 'normal' ? 100 : 140) - (performance.now() - started)));
    };
    const fallback = () => {
      if (!active || completed) return;
      worker?.terminate();
      setAiNotice('人机正在使用快速思考');
      accept(chooseAiMove(currentMap, snapshot, currentController, { timeMs: 60 }));
    };
    const launch = window.setTimeout(() => {
      try {
        worker = new GameAiWorker();
        worker.onmessage = (event: MessageEvent<{ id: number; decision?: AiDecision }>) => {
          if (event.data.id !== request) return;
          if (event.data.decision) accept(event.data.decision); else fallback();
        };
        worker.onerror = fallback;
        worker.postMessage({ id: request, map: currentMap, snapshot, difficulty: currentController });
        watchdog = window.setTimeout(fallback, 12_000);
      } catch { fallback(); }
    }, 0);
    return () => {
      active = false;
      worker?.terminate();
      window.clearTimeout(launch);
      window.clearTimeout(watchdog);
      window.clearTimeout(settleTimer);
    };
  }, [cells, currentController, currentMap, currentPlayer, draw, placeEnergy, resolving, screen, snapshot, winner]);

  const updateCustomMap = (map: GameMap) => {
    setCustomMaps((current) => current.map((item, index) => index === editorSlot ? map : item));
  };

  const saveCustomMap = (map: GameMap) => {
    setCustomMaps((current) => {
      const next = current.map((item, index) => index === editorSlot ? map : item);
      persistCustomMaps(next);
      return next;
    });
  };

  const openEditor = (slotIndex?: number) => {
    if (screen === 'game' && resolving) return;
    const selectedSlot = slotIndex ?? (() => {
      const selected = customMaps.findIndex((map) => map?.id === selectedMapId);
      if (selected >= 0) return selected;
      const existing = customMaps.findIndex(Boolean);
      return existing >= 0 ? existing : 0;
    })();
    if (!customMaps[selectedSlot]) {
      const created = createCustomMap(selectedSlot);
      setCustomMaps((current) => {
        const next = current.map((map, index) => index === selectedSlot ? created : map);
        persistCustomMaps(next);
        return next;
      });
      setSelectedMapId(created.id);
    }
    setEditorSlot(selectedSlot);
    resolutionToken.current += 1;
    setScreen('editor');
  };

  const deleteCustomMap = (slotIndex: number) => {
    setCustomMaps((current) => {
      const deletedId = current[slotIndex]?.id;
      const next = current.map((map, index) => index === slotIndex ? null : map);
      persistCustomMaps(next);
      if (deletedId && selectedMapId === deletedId) setSelectedMapId(MAP_LIBRARY[0].id);
      return next;
    });
  };

  const goLobby = () => {
    if (screen === 'game' && resolving) return;
    matchSession.current += 1;
    resolutionToken.current += 1;
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setScreen('lobby');
  };

  const modeName = GAME_MODES.find((item) => item.id === mode)?.name ?? '经典模式';
  const matchModeName = GAME_MODES.find((item) => item.id === matchMode)?.name ?? '经典模式';

  return (
    <main className={`game-shell ${reducedMotion ? 'reduce-motion' : ''}`}>
      <header className="topbar">
        <button type="button" className="brand" onClick={goLobby} disabled={resolving && screen === 'game'} aria-label="返回爆炸棋地图选择">
          <span className="brand-mark"><Bolt aria-hidden="true" /></span>
          <span className="brand-copy"><strong>爆炸棋</strong><small>CHAINBURST</small></span>
        </button>
        <div className="match-pill"><span className="live-dot" />{screen === 'game' ? currentMap.name : screen === 'editor' ? '地图工坊' : screen === 'online' ? '线上联机' : '选择战场'} {screen === 'game' && <b>{matchModeName}</b>}</div>
        <nav className="header-actions" aria-label="游戏工具">
          {screen === 'game' && <Button variant="ghost" size="lg" onClick={goLobby} disabled={resolving}><Grid3X3 />地图</Button>}
          {screen === 'lobby' && moves > 0 && winner === null && !draw && <Button variant="ghost" size="lg" onClick={() => setScreen('game')}><Bolt />继续对局</Button>}
          {screen !== 'editor' && <Button variant="ghost" size="icon-lg" onClick={() => setSoundEnabled((value) => !value)} aria-label={soundEnabled ? '关闭音效' : '开启音效'}>{soundEnabled ? <Volume2 /> : <VolumeX />}</Button>}
          <Button variant="outline" size="lg" aria-label="规则书" onClick={() => setLearningView('rules')}><BookOpen />规则书</Button>
          <Button variant="outline" size="lg" className="tutorial-button" aria-label="教程" onClick={() => setLearningView('tutorial')}><GraduationCap />教程</Button>
          {screen === 'game' && <Button className="new-game-button" size="lg" onClick={() => startGame(currentMap, matchPlayerCount, matchMode, matchControllers)}><RotateCcw />重新开局</Button>}
          {screen !== 'editor' && <Button variant="outline" size="icon-lg" onClick={() => setSettingsOpen(true)} aria-label="辅助设置"><Settings2 /></Button>}
        </nav>
      </header>

      {screen === 'lobby' && (
        <GameLobby
          maps={maps}
          selectedMapId={selectedMapId}
          playerCount={playerCount}
          mode={mode}
          controllers={controllers}
          onControllers={setControllers}
          onSelectMap={setSelectedMapId}
          onPlayerCount={setPlayerCount}
          onMode={setMode}
          onStart={() => startGame(selectedMap)}
          onOnline={onlineAvailable ? () => { startMusic(); setScreen('online'); } : undefined}
          customMaps={customMaps}
          onEditor={() => openEditor()}
          onCreateCustom={openEditor}
          onEditCustom={openEditor}
          onDeleteCustom={deleteCustomMap}
        />
      )}

      {onlineAvailable && screen === 'online' && (
        <OnlinePlay
          defaultMapId={selectedMap.id}
          availableMaps={maps}
          defaultPlayers={playerCount}
          defaultMode={mode}
          reducedMotion={reducedMotion}
          energyDisplayMode={energyDisplayMode}
          previewSuspended={settingsOpen || learningView !== null}
          onBack={goLobby}
          onSound={playSound}
          onUserGesture={startMusic}
        />
      )}

      {screen === 'editor' && (
        <MapEditor
          map={customMaps[editorSlot] ?? createCustomMap(editorSlot)}
          slotNumber={editorSlot + 1}
          onMapChange={updateCustomMap}
          onSave={saveCustomMap}
          onBack={goLobby}
          onPlay={(map) => { saveCustomMap(map); startGame(map); }}
          playerCount={playerCount}
          modeName={modeName}
        />
      )}

      {screen === 'game' && (
        <section className="arena-layout">
          <div className="board-panel">
            <div className="board-heading">
              <div>
                <span className="eyebrow">{hasAi ? '人机对战' : '本地同屏'} · {matchPlayerCount} 方 · {matchModeName}</span>
                <h1><i style={{ background: PLAYER_STYLES[currentPlayer].color }} />{resolving ? `第 ${waveNumber || 1} 波反应` : isAiTurn ? `${PLAYER_STYLES[currentPlayer].name}正在思考` : `轮到${PLAYER_STYLES[currentPlayer].name}`}</h1>
              </div>
              <div className="move-counter"><span className={matchMode === 'surge' ? 'double-step-label' : undefined}>{matchMode === 'surge' ? `回合 · 第 ${turnStep}/2 步` : '回合'}</span><strong>{String(turnNumber).padStart(2, '0')}</strong></div>
            </div>

            <div className={`board-frame ${resolving ? 'is-resolving' : ''} ${waveNumber > 24 ? 'is-accelerated' : ''}`}>
              <div className="board-corner-meta"><span>{currentMap.rows} × {currentMap.cols}</span><span>{activeCellCount} 格</span></div>
              <GameBoard map={currentMap} cells={cells} snapshot={snapshot} previewEnabled={previewEnabled && !settingsOpen && !learningView} energyDisplayMode={energyDisplayMode} currentPlayer={currentPlayer} blockedIndex={matchMode === 'surge' && turnStep === 2 ? firstMoveIndex : null} disabled={resolving || isAiTurn || winner !== null || draw} exploding={exploding} receiving={receiving} transfers={transfers} lastMove={lastMove} onCell={(index) => void placeEnergy(index)} />
            </div>

            <div className={`board-hint ${resolving ? 'is-live' : ''}`}>
              {resolving ? <Gauge aria-hidden="true" /> : isAiTurn ? <Bot aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              <span>{resolving ? '连锁结算中 · 同波同时爆炸，深层连锁会加速回放' : isAiTurn ? aiNotice || `${controllerName(currentController)}正在预判连锁与反击，请稍候。` : matchMode === 'surge' ? turnStep === 2 ? '还有第二步：选择另一个合法格注入 1 点能量，虚线格本回合已使用。' : '每回合两步：在两个不同的合法格各注入 1 点能量，第一步结算后继续。' : '选择全空中立格或己方格注能；带锁中立格与低容量金边格只能被爆炸点燃。'}</span>
            </div>
          </div>

          <aside className="status-panel">
            <section className="turn-card" style={{ '--active-rgb': PLAYER_STYLES[currentPlayer].rgb } as React.CSSProperties}>
              <span className="section-label">{resolving ? '能量反应' : isAiTurn ? '人机思考中' : '当前行动'}</span>
              <div className="turn-player">
                <span className="player-token" style={{ background: PLAYER_STYLES[currentPlayer].color }}>{PLAYER_STYLES[currentPlayer].symbol}</span>
                <div><strong>{PLAYER_STYLES[currentPlayer].name}<span className="controller-badge">{controllerName(currentController)}</span></strong><small>{resolving ? `正在传播第 ${waveNumber || 1} 波能量` : matchMode === 'surge' ? `第 ${turnStep}/2 步 · 每步注入 1 点` : isAiTurn ? '正在推演下一步' : '每次注入 1 点能量'}</small></div>
              </div>
              <div className={`turn-progress ${resolving || isAiTurn ? 'is-busy' : ''}`}><i /></div>
            </section>

            <section className="score-card">
              <div className="section-title"><span className="section-label">势力分布</span><small>{counts.reduce((sum, count) => sum + count, 0)} / {activeCellCount} 已占领</small></div>
              {snapshot.dominionPercent !== undefined && <p className="dominion-target">胜利目标 · 占领 {getDominionTarget(activeCellCount, snapshot.dominionPercent)} 格（{snapshot.dominionPercent}%）</p>}
              <div className="score-bar">
                {counts.map((count, index) => <i key={index} style={{ width: `${(count / activeCellCount) * 100}%`, background: PLAYER_STYLES[index].color }} />)}
              </div>
              {PLAYER_STYLES.slice(0, matchPlayerCount).map((player, index) => (
                <div className={`player-row ${currentPlayer === index ? 'active' : ''}`} key={player.name}>
                  <span className="mini-token" style={{ background: player.color }}>{player.symbol}</span>
                  <span className="player-name">{player.name}<small className="score-controller">{controllerName(matchControllers[index] ?? 'human')}</small>{currentPlayer === index ? <em>行动中</em> : !hasEntered[index] ? <em>待入场</em> : counts[index] === 0 ? <em>{canMove[index] ? '可重新入场' : '等待空位'}</em> : null}</span>
                  <strong>{counts[index]}<small> 格</small></strong>
                </div>
              ))}
            </section>

            <section className="danger-card">
              <div className="danger-icon"><Bolt /></div>
              <div><strong>{currentMap.kind === 'classic' ? '临界能量' : '地图特性'}</strong><p>{currentMap.kind === 'classic' ? '角落 2 格、边缘 3 格、中央 4 格。蓄满后向所有相邻边扩散。' : currentMap.description}</p></div>
            </section>

            <Button variant="ghost" className="editor-shortcut" onClick={() => openEditor()} disabled={resolving}><PencilRuler />打开地图工坊</Button>
          </aside>
        </section>
      )}

      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {screen === 'game' ? resolving ? `正在结算第 ${waveNumber || 1} 波爆炸` : winner !== null ? `${PLAYER_STYLES[winner].name}获胜` : draw ? '本局平局' : isAiTurn ? `${controllerName(currentController)}正在思考` : `轮到${PLAYER_STYLES[currentPlayer].name}` : ''}
      </output>

      <LearningCenter view={learningView} onViewChange={setLearningView} reducedMotion={reducedMotion} />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="settings-dialog">
          <DialogHeader><DialogTitle>辅助设置</DialogTitle><DialogDescription>偏好只影响这台设备上的游玩体验。</DialogDescription></DialogHeader>
          <div className="settings-row"><span><strong>游戏音效</strong><small>落子、爆炸和胜利提示音</small></span><Switch aria-label="游戏音效" checked={soundEnabled} onCheckedChange={setSoundEnabled} /></div>
          <div className="settings-row"><span><strong>背景音乐</strong><small>原创程序化电子配乐；爆炸时会自动降低音量</small></span><Switch aria-label="背景音乐" checked={musicEnabled} onCheckedChange={(checked) => { musicEnabledRef.current = checked; setMusicEnabled(checked); if (checked && (screen === 'online' || (screen === 'game' && winner === null && !draw))) startMusic(); else stopMusic(); }} /></div>
          <div className="settings-row"><span><strong>减少动态效果</strong><small>保留波次停顿，缩短位移与闪烁</small></span><Switch aria-label="减少动态效果" checked={reducedMotion} onCheckedChange={setReducedMotion} /></div>
          <div className="settings-row">
            <span><strong>棋子显示</strong><small>自动模式随地图大小和缩放切换</small></span>
            <Select value={energyDisplayMode} onValueChange={(value) => {
              if (!isEnergyDisplayMode(value)) return;
              setEnergyDisplayMode(value);
              try { window.localStorage.setItem(ENERGY_DISPLAY_KEY, value); } catch { /* optional preference */ }
            }}>
              <SelectTrigger aria-label="棋子显示"><SelectValue>{ENERGY_DISPLAY_LABELS[energyDisplayMode]}</SelectValue></SelectTrigger>
              <SelectContent>
                {Object.entries(ENERGY_DISPLAY_LABELS).map(([mode, label]) => <SelectItem key={mode} value={mode}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="settings-row"><span><strong>本地落子预览</strong><small>{screen === 'online' ? '联机对局由房主在房间设置中统一控制' : '悬停查看结果；触屏接触预览后确认落子'}</small></span><Switch aria-label="本地落子预览" checked={previewEnabled} disabled={screen === 'online'} onCheckedChange={(checked) => { setPreviewEnabled(checked); try { window.localStorage.setItem('chainburst-preview-enabled', String(checked)); } catch { /* optional preference */ } }} /></div>
        </DialogContent>
      </Dialog>

      <Dialog open={screen === 'game' && (winner !== null || draw)} onOpenChange={() => undefined}>
        <DialogContent className="winner-dialog" showCloseButton={false}>
          {winner !== null && <>
            <div className="winner-burst" style={{ '--winner-rgb': PLAYER_STYLES[winner].rgb, '--winner-color': PLAYER_STYLES[winner].color } as React.CSSProperties}><Bolt /><i /><i /><i /></div>
            <DialogHeader><DialogTitle>{PLAYER_STYLES[winner].name}获胜</DialogTitle><DialogDescription>{winReason === 'singularity' ? '能量超过地图稳定上限，形成不可阻挡的能量奇点。' : winReason === 'dominion' ? `已控制至少 ${DOMINION_PERCENT}% 的有效格，取得疆域胜利。` : '成为场上唯一颜色，并控制了超过一半的有效格。'}</DialogDescription></DialogHeader>
            <div className="winner-stats"><span><small>占领</small><strong>{counts[winner]} / {activeCellCount}</strong></span><span><small>总步数</small><strong>{moves}</strong></span><span><small>地图</small><strong>{currentMap.name}</strong></span></div>
            <DialogFooter><Button variant="outline" onClick={goLobby}><ArrowLeft />返回地图</Button><Button onClick={() => startGame(currentMap, matchPlayerCount, matchMode, matchControllers)}><RotateCcw />再来一局</Button></DialogFooter>
          </>}
          {draw && <><DialogHeader><DialogTitle>本局平局</DialogTitle><DialogDescription>所有玩家都已没有合法落点。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={goLobby}>返回地图</Button><Button onClick={() => startGame(currentMap, matchPlayerCount, matchMode, matchControllers)}>再来一局</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
