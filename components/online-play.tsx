'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPinned,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GameBoard } from '@/components/game-board';
import type { EnergyDisplayMode } from '@/lib/energy-display';
import {
  MAP_LIBRARY,
  PLAYER_STYLES,
  countTerritory,
  deserializeCustomMap,
  findOfficialMap,
  serializeCustomMap,
  type GameCell,
  type GameMap,
  type Transfer,
} from '@/lib/explosion-game';
import { DOMINION_PERCENT, GAME_MODES, getDominionTarget, type GameModeId } from '@/lib/game-modes';
import { hydrateMatchCells, normalizeMatchSnapshot } from '@/lib/match-engine';
import type { OnlineFailure, OnlineRoomView, OnlineSuccess } from '@/lib/online-types';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
type SoundKind = 'place' | 'burst' | 'win';

interface OnlinePlayProps {
  defaultMapId: string;
  availableMaps: GameMap[];
  defaultPlayers: number;
  defaultMode: GameModeId;
  reducedMotion: boolean;
  energyDisplayMode: EnergyDisplayMode;
  previewSuspended?: boolean;
  onBack: () => void;
  onSound?: (kind: SoundKind, player: number, count?: number, accelerated?: boolean) => void;
  onUserGesture?: () => void;
}

interface SavedSession {
  code: string;
  token: string;
}

class OnlineRequestError extends Error {
  code: string;
  retryAt?: number;

  constructor(failure: OnlineFailure) {
    super(failure.error.message);
    this.code = failure.error.code;
    this.retryAt = failure.error.retryAt;
  }
}

const SESSION_KEY = 'chainburst-online-session';
const NAME_KEY = 'chainburst-online-name';
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6);
}

function randomSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function onlineRequest<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/online', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json() as T | OnlineFailure;
  if (!response.ok || (data as OnlineFailure).ok === false) throw new OnlineRequestError(data as OnlineFailure);
  return data as T;
}

function sessionUrl(code?: string) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function resolveOnlineMap(room: OnlineRoomView) {
  if (room.customMap) return deserializeCustomMap(room.customMap);
  return findOfficialMap(room.mapId) ?? null;
}

export function OnlinePlay({ defaultMapId, availableMaps, defaultPlayers, defaultMode, reducedMotion, energyDisplayMode, previewSuspended = false, onBack, onSound, onUserGesture }: OnlinePlayProps) {
  const [name, setName] = useState('玩家');
  const [joinCode, setJoinCode] = useState('');
  const [room, setRoom] = useState<OnlineRoomView | null>(null);
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [displayCells, setDisplayCells] = useState<GameCell[]>([]);
  const [exploding, setExploding] = useState<number[]>([]);
  const [receiving, setReceiving] = useState<number[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [waveNumber, setWaveNumber] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [configPlayers, setConfigPlayers] = useState(defaultPlayers);
  const [configMapKey, setConfigMapKey] = useState(`local:${defaultMapId}`);
  const [configPreviewEnabled, setConfigPreviewEnabled] = useState(true);
  const roomRef = useRef<OnlineRoomView | null>(null);
  const tokenRef = useRef('');
  const animationToken = useRef(0);
  const sessionEpoch = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const pendingJoin = useRef<{ code: string; name: string; token: string } | null>(null);
  const initialized = useRef(false);
  const polling = useRef(false);
  const reconnectFailures = useRef(0);

  const selectedMap = availableMaps.find((map) => map.id === defaultMapId) ?? MAP_LIBRARY[0];
  const modeName = GAME_MODES.find((item) => item.id === (room?.mode ?? defaultMode))?.name ?? '经典模式';
  const roomMapData = room?.customMap ? JSON.stringify(room.customMap) : '';
  const roomMapIdentity = room?.mapId;
  const map = useMemo(() => room ? resolveOnlineMap(room) : null, [roomMapIdentity, roomMapData]);
  const configurableMapOptions = useMemo(() => {
    const options: Array<{ key: string; map: GameMap; label: string }> = [];
    if (map) options.push({ key: `room:${map.id}`, map, label: `${map.name}（房间当前）` });
    for (const item of availableMaps) {
      if (map?.kind !== 'custom' && item.id === map?.id) continue;
      options.push({
        key: `local:${item.id}`,
        map: item,
        label: item.kind === 'custom' ? `${item.name}（本机槽位）` : item.name,
      });
    }
    return options;
  }, [availableMaps, map]);

  const persistSession = useCallback((code: string, sessionToken: string) => {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({ code, token: sessionToken } satisfies SavedSession));
    } catch {
      // Reconnection remains available for the current tab when storage is blocked.
    }
  }, []);

  const clearSession = useCallback(() => {
    sessionEpoch.current += 1;
    pendingJoin.current = null;
    try { window.localStorage.removeItem(SESSION_KEY); } catch { /* optional storage */ }
    tokenRef.current = '';
    roomRef.current = null;
    setToken('');
    setRoom(null);
    setConnection('idle');
    setDisplayCells([]);
    setAnimating(false);
    setExploding([]);
    setReceiving([]);
    setTransfers([]);
    animationToken.current += 1;
    sessionUrl();
  }, []);

  const playTurn = useCallback(async (previous: OnlineRoomView, next: OnlineRoomView) => {
    const event = next.lastTurn;
    const boardMap = resolveOnlineMap(next);
    if (!event || !previous.match || !next.match || !boardMap) return;
    const sequence = animationToken.current + 1;
    animationToken.current = sequence;
    setAnimating(true);
    setWaveNumber(0);
    setExploding([]);
    setReceiving([]);
    setTransfers([]);

    let cells: GameCell[] = hydrateMatchCells(boardMap, previous.match);
    cells = cells.map((cell, index) => index === event.cellIndex
      ? { ...cell, owner: event.actor, energy: cell.energy + event.amount }
      : { ...cell });
    setDisplayCells(cells);
    onSound?.('place', event.actor);
    const placeDelay = reducedMotion ? 35 : 110;
    await wait(placeDelay);

    const visibleWaves = event.waves.slice(0, 24);
    const availableTime = Math.max(0, event.readyAt - Date.now() - 100);
    const waveDuration = reducedMotion
      ? 75
      : Math.max(105, Math.min(620, availableTime / Math.max(1, visibleWaves.length)));

    for (let index = 0; index < visibleWaves.length; index += 1) {
      if (animationToken.current !== sequence) return;
      const wave = visibleWaves[index];
      const afterBurst = cells.map((cell) => ({ ...cell }));
      for (const explodingIndex of wave.exploding) {
        const source = afterBurst[explodingIndex];
        if (!source) continue;
        source.energy -= source.capacity;
        if (source.energy === 0) source.owner = null;
      }
      const afterTransfer = afterBurst.map((cell) => ({ ...cell }));
      for (const transfer of wave.transfers) {
        const target = afterTransfer[transfer.target];
        if (!target) continue;
        target.energy += transfer.amount;
        target.owner = event.actor;
      }
      const accelerated = index >= 12;
      setWaveNumber(index + 1);
      setExploding(wave.exploding);
      setReceiving([]);
      setTransfers([]);
      setDisplayCells(afterBurst);
      onSound?.('burst', event.actor, wave.exploding.length, accelerated);
      await wait(waveDuration * .42);
      if (animationToken.current !== sequence) return;
      setExploding([]);
      setTransfers(wave.transfers);
      await wait(waveDuration * .28);
      if (animationToken.current !== sequence) return;
      cells = afterTransfer;
      setTransfers([]);
      setReceiving([...new Set(wave.transfers.map((transfer) => transfer.target))]);
      setDisplayCells(cells);
      await wait(waveDuration * .3);
    }

    if (animationToken.current !== sequence) return;
    setDisplayCells(hydrateMatchCells(boardMap, next.match));
    setExploding([]);
    setReceiving([]);
    setTransfers([]);
    setAnimating(false);
    setWaveNumber(0);
    if (next.match.winner !== null) onSound?.('win', next.match.winner);
  }, [onSound, reducedMotion]);

  const receiveRoom = useCallback((next: OnlineRoomView, animate = true, allowRoomChange = false) => {
    next = { ...next, previewEnabled: next.previewEnabled !== false };
    if (next.match) next = { ...next, match: normalizeMatchSnapshot(next.match) };
    const previous = roomRef.current;
    if (previous && next.code !== previous.code && !allowRoomChange) return;
    if (previous?.code === next.code && next.revision < previous.revision) return;
    roomRef.current = next;
    setRoom(next);
    setConnection('connected');
    setError('');
    reconnectFailures.current = 0;
    const activeToken = tokenRef.current;
    if (activeToken) persistSession(next.code, activeToken);
    sessionUrl(next.code);

    const boardMap = resolveOnlineMap(next);
    if (!next.match || !boardMap) {
      animationToken.current += 1;
      setAnimating(false);
      setDisplayCells([]);
      setExploding([]);
      setReceiving([]);
      setTransfers([]);
      return;
    }

    if (previous?.revision === next.revision) return;

    const canAnimate = animate
      && previous?.match
      && next.lastTurn
      && next.lastTurn.revision === next.revision
      && next.revision === previous.revision + 1;
    if (canAnimate) {
      void playTurn(previous, next);
    } else {
      animationToken.current += 1;
      setAnimating(false);
      setWaveNumber(0);
      setExploding([]);
      setReceiving([]);
      setTransfers([]);
      setDisplayCells(hydrateMatchCells(boardMap, next.match));
    }
  }, [persistSession, playTurn]);

  const enterRoom = useCallback((result: OnlineSuccess, animate = false) => {
    const nextToken = result.token ?? tokenRef.current;
    if (!nextToken) throw new Error('缺少席位凭证');
    sessionEpoch.current += 1;
    tokenRef.current = nextToken;
    setToken(nextToken);
    receiveRoom(result.room, animate, true);
  }, [receiveRoom]);

  const syncRoom = useCallback(async (quiet = true) => {
    const current = roomRef.current;
    const sessionToken = tokenRef.current;
    if (!current || !sessionToken || polling.current) return;
    const requestEpoch = sessionEpoch.current;
    polling.current = true;
    try {
      const result = await onlineRequest<OnlineSuccess>({ action: 'snapshot', code: current.code, token: sessionToken });
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== current.code || tokenRef.current !== sessionToken) return;
      if (result.room.revision > current.revision || (!!result.room.abortProposal !== !!current.abortProposal)) receiveRoom(result.room, true);
      else {
        setConnection('connected');
        setError('');
        reconnectFailures.current = 0;
      }
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== current.code || tokenRef.current !== sessionToken) return;
      reconnectFailures.current += 1;
      setConnection(reconnectFailures.current >= 3 ? 'offline' : 'reconnecting');
      if (!quiet) setError(cause instanceof Error ? cause.message : '无法连接房间');
      if (cause instanceof OnlineRequestError && (cause.code === 'UNAUTHORIZED' || cause.code === 'ROOM_NOT_FOUND')) clearSession();
    } finally {
      polling.current = false;
    }
  }, [clearSession, receiveRoom]);

  const restoreRoom = useCallback(async (code: string, sessionToken: string) => {
    const requestEpoch = sessionEpoch.current + 1;
    sessionEpoch.current = requestEpoch;
    tokenRef.current = sessionToken;
    setToken(sessionToken);
    setConnection('connecting');
    setError('');
    try {
      const result = await onlineRequest<OnlineSuccess>({ action: 'snapshot', code, token: sessionToken });
      if (requestEpoch !== sessionEpoch.current || tokenRef.current !== sessionToken) return;
      enterRoom(result, false);
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current || tokenRef.current !== sessionToken) return;
      if (cause instanceof OnlineRequestError && (cause.code === 'UNAUTHORIZED' || cause.code === 'ROOM_NOT_FOUND')) {
        clearSession();
        setConnection('idle');
        setError(cause.message);
        return;
      }
      setJoinCode(code);
      setConnection('offline');
      setError('暂时无法恢复房间，你的席位凭证仍保留在此设备');
    }
  }, [clearSession, enterRoom]);

  useEffect(() => {
    if (initialized.current) return;
    const timer = window.setTimeout(() => {
      if (initialized.current) return;
      initialized.current = true;
      const params = new URLSearchParams(window.location.search);
      const invitedCode = normalizeCode(params.get('room') ?? '');
      if (invitedCode) setJoinCode(invitedCode);
      try {
        const savedName = window.localStorage.getItem(NAME_KEY);
        if (savedName) setName(savedName.slice(0, 16));
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as SavedSession;
        if (!saved.code || !saved.token || (invitedCode && invitedCode !== saved.code)) return;
        tokenRef.current = saved.token;
        setToken(saved.token);
        setJoinCode(saved.code);
        void restoreRoom(saved.code, saved.token);
      } catch {
        // A malformed saved session should not block the online entry screen.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [restoreRoom]);

  useEffect(() => () => {
    animationToken.current += 1;
    sessionEpoch.current += 1;
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (!roomRef.current || !token) return;
    const interval = window.setInterval(() => { void syncRoom(true); }, connection === 'offline' ? 3_000 : 1_000);
    return () => window.clearInterval(interval);
  }, [connection, room?.code, syncRoom, token]);

  useEffect(() => {
    if (!room?.match) return;
    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [room?.match]);

  const roomPhase = room?.phase;
  const roomTargetPlayers = room?.targetPlayers;
  const roomMapId = room?.mapId;
  const roomPreviewEnabled = room?.previewEnabled;
  useEffect(() => {
    if (roomPhase !== 'waiting' || roomTargetPlayers === undefined || !roomMapId) return;
    const timer = window.setTimeout(() => {
      setConfigPlayers(roomTargetPlayers);
      setConfigMapKey(`room:${roomMapId}`);
      setConfigPreviewEnabled(roomPreviewEnabled !== false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [roomMapId, roomPhase, roomTargetPlayers, roomPreviewEnabled]);

  const rememberName = () => {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!clean) throw new Error('请输入昵称');
    setName(clean);
    try { window.localStorage.setItem(NAME_KEY, clean); } catch { /* optional storage */ }
    return clean;
  };

  const createRoom = async () => {
    onUserGesture?.();
    const requestEpoch = sessionEpoch.current;
    setWorking('create');
    setError('');
    try {
      const result = await onlineRequest<OnlineSuccess>({
        action: 'create',
        name: rememberName(),
        targetPlayers: defaultPlayers,
        mapId: selectedMap.id,
        customMap: selectedMap.kind === 'custom' ? serializeCustomMap(selectedMap) : null,
        mode: defaultMode,
      });
      if (requestEpoch !== sessionEpoch.current) return;
      enterRoom(result);
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current) return;
      setError(cause instanceof Error ? cause.message : '创建房间失败');
    } finally {
      setWorking('');
    }
  };

  const joinRoom = async () => {
    onUserGesture?.();
    const roomCode = normalizeCode(joinCode);
    let playerName = '';
    let requestEpoch = sessionEpoch.current;
    setWorking('join');
    setError('');
    try {
      playerName = rememberName();
      const pending = pendingJoin.current;
      const claimToken = pending?.code === roomCode && pending.name === playerName ? pending.token : randomSessionToken();
      pendingJoin.current = { code: roomCode, name: playerName, token: claimToken };
      requestEpoch = sessionEpoch.current + 1;
      sessionEpoch.current = requestEpoch;
      tokenRef.current = claimToken;
      setToken(claimToken);
      setConnection('connecting');
      persistSession(roomCode, claimToken);
      const result = await onlineRequest<OnlineSuccess>({ action: 'join', code: roomCode, name: playerName, claimToken });
      if (requestEpoch !== sessionEpoch.current) return;
      pendingJoin.current = null;
      enterRoom(result);
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current) return;
      if (!playerName) {
        setConnection('idle');
        setError(cause instanceof Error ? cause.message : '请输入昵称');
        return;
      }
      const terminal = cause instanceof OnlineRequestError
        && ['INVALID_CODE', 'INVALID_NAME', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'MATCH_ALREADY_STARTED'].includes(cause.code);
      if (terminal) {
        clearSession();
        setError(cause.message);
      } else {
        setConnection('offline');
        setError('加入结果尚未确认，席位凭证已保留；请点击“立即重试”');
      }
    } finally {
      setWorking('');
    }
  };

  const roomAction = async (action: 'configure' | 'ready' | 'start' | 'returnToRoom' | 'proposeAbort' | 'voteAbort' | 'cancelAbort', extra: Record<string, unknown> = {}) => {
    if (!room || !tokenRef.current) return false;
    onUserGesture?.();
    const requestEpoch = sessionEpoch.current;
    const sessionToken = tokenRef.current;
    const roomCode = room.code;
    setWorking(action);
    setError('');
    try {
      const result = await onlineRequest<OnlineSuccess>({ action, code: roomCode, token: sessionToken, expectedRevision: room.revision, ...extra });
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== roomCode || tokenRef.current !== sessionToken) return false;
      receiveRoom(result.room, false);
      return true;
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== roomCode || tokenRef.current !== sessionToken) return false;
      setError(cause instanceof Error ? cause.message : '操作失败');
      void syncRoom(true);
      return false;
    } finally {
      setWorking('');
    }
  };

  const leaveRoom = async (returnToMap = false) => {
    if (!room || !tokenRef.current) return;
    const requestEpoch = sessionEpoch.current;
    const sessionToken = tokenRef.current;
    const roomCode = room.code;
    setWorking('leave');
    setError('');
    try {
      await onlineRequest<{ ok: true; left: true }>({ action: 'leave', code: roomCode, token: sessionToken });
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== roomCode || tokenRef.current !== sessionToken) return;
      clearSession();
      if (returnToMap) onBack();
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== roomCode || tokenRef.current !== sessionToken) return;
      if (cause instanceof OnlineRequestError && (cause.code === 'UNAUTHORIZED' || cause.code === 'ROOM_NOT_FOUND')) {
        clearSession();
        if (returnToMap) onBack();
        return;
      }
      setError(cause instanceof Error ? cause.message : '退出房间失败');
    } finally {
      setWorking('');
    }
  };

  const submitMove = async (cellIndex: number) => {
    const current = roomRef.current;
    if (!current?.match || !tokenRef.current || working || animating) return;
    onUserGesture?.();
    const requestEpoch = sessionEpoch.current;
    const sessionToken = tokenRef.current;
    setWorking('move');
    setError('');
    const commandId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await onlineRequest<OnlineSuccess>({
        action: 'move',
        code: current.code,
        token: sessionToken,
        commandId,
        expectedRevision: current.revision,
        cellIndex,
      });
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== current.code || tokenRef.current !== sessionToken) return;
      receiveRoom(result.room, true);
    } catch (cause) {
      if (requestEpoch !== sessionEpoch.current || roomRef.current?.code !== current.code || tokenRef.current !== sessionToken) return;
      if (cause instanceof OnlineRequestError && cause.code === 'TURN_NOT_READY' && cause.retryAt) {
        setError('上一手棋仍在播放，请稍候');
      } else {
        setError(cause instanceof Error ? cause.message : '落子失败');
      }
      void syncRoom(true);
    } finally {
      setWorking('');
    }
  };

  const applyRoomConfig = async () => {
    const selected = configurableMapOptions.find((item) => item.key === configMapKey);
    if (!selected) {
      setError('所选地图已不在这台设备上，请重新选择');
      return;
    }
    const applied = await roomAction('configure', {
      targetPlayers: configPlayers,
      previewEnabled: configPreviewEnabled,
      mapId: selected.map.id,
      customMap: selected.map.kind === 'custom' ? serializeCustomMap(selected.map) : null,
    });
    if (applied) {
      setConfigMapKey(`room:${selected.map.id}`);
      setNotice('房间设置已更新，所有玩家需要重新准备');
    }
  };

  const copyInvite = async () => {
    if (!room) return;
    const url = new URL(window.location.href);
    url.searchParams.set('room', room.code);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice('邀请链接已复制');
    } catch {
      setNotice(`房间码：${room.code}`);
    }
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2200);
  };

  const goBack = () => {
    sessionUrl();
    onBack();
  };

  if (!room) {
    return (
      <section className="online-page online-entry-page">
        <div className="online-page-heading">
          <Button variant="ghost" onClick={goBack}><ArrowLeft />返回地图</Button>
          <span className="online-kicker"><Radio />线上联机 · 私人房间</span>
          <h1>和朋友进入同一条爆炸链。</h1>
          <p>无需注册账号。创建房间并分享链接，或输入朋友发来的 6 位房间码。</p>
        </div>

        <label className="online-name-field" htmlFor="online-player-name">
          <span>你的昵称</span>
          <Input id="online-player-name" value={name} maxLength={16} autoComplete="nickname" onChange={(event) => setName(event.target.value)} placeholder="输入昵称" />
        </label>

        <div className="online-entry-grid">
          <article className="online-entry-card is-create">
            <span className="online-card-icon"><UserPlus /></span>
            <small>创建新房间</small>
            <h2>我是房主</h2>
            <div className="online-config-summary">
              <span><b>{selectedMap.name}</b><small>地图</small></span>
              <span><b>{defaultPlayers} 人</b><small>人数</small></span>
              <span><b>{GAME_MODES.find((item) => item.id === defaultMode)?.name}</b><small>模式</small></span>
            </div>
            <p>使用地图大厅当前选择的设置。房间满员且所有人准备后即可开局。</p>
            <Button size="lg" onClick={() => void createRoom()} disabled={!!working || !!token || connection === 'connecting'}>
              {working === 'create' ? <LoaderCircle className="spin" /> : <Link2 />}创建并获取邀请链接
            </Button>
          </article>

          <article className="online-entry-card">
            <span className="online-card-icon"><LogIn /></span>
            <small>加入朋友房间</small>
            <h2>我有房间码</h2>
            <label className="room-code-input" htmlFor="online-room-code">
              <span>6 位房间码</span>
              <Input
                id="online-room-code"
                value={joinCode}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(event) => setJoinCode(normalizeCode(event.target.value))}
                onKeyDown={(event) => { if (event.key === 'Enter' && joinCode.length === 6) void joinRoom(); }}
                placeholder="例如 K7M4Q2"
              />
            </label>
            <p>邀请链接会自动填写房间码。你的席位会保存在当前设备，刷新后可恢复。</p>
            <Button size="lg" variant="outline" onClick={() => void joinRoom()} disabled={!!working || !!token || connection === 'connecting' || joinCode.length !== 6}>
              {working === 'join' ? <LoaderCircle className="spin" /> : <Users />}加入房间
            </Button>
          </article>
        </div>
        {token && connection !== 'idle' && (
          <output className={`online-message ${connection === 'offline' ? 'is-error' : ''}`} aria-live="polite">
            {connection === 'connecting' ? <LoaderCircle className="spin" /> : <WifiOff />}
            <span>{connection === 'connecting' ? '正在恢复上次的联机房间…' : '席位仍保留，可以重新连接。'}</span>
            {connection === 'offline' && <Button size="sm" variant="outline" onClick={() => void restoreRoom(joinCode, tokenRef.current)}>立即重试</Button>}
            {connection === 'offline' && <Button size="sm" variant="ghost" onClick={() => { clearSession(); setConnection('idle'); setError(''); }}>放弃恢复</Button>}
          </output>
        )}
        {error && <div className="online-message is-error" role="alert">{error}</div>}
      </section>
    );
  }

  const mySeat = room.seats.find((seat) => seat.seat === room.meSeat);
  const readyCount = room.seats.filter((seat) => seat.ready).length;
  const full = room.seats.length === room.targetPlayers;
  const allReady = full && readyCount === room.targetPlayers;
  const configDirty = room.isHost && (configPlayers !== room.targetPlayers || configMapKey !== `room:${room.mapId}` || configPreviewEnabled !== room.previewEnabled);

  if (room.phase === 'waiting' || !room.match || !map) {
    return (
      <section className="online-page room-page">
        <div className="room-toolbar">
          <Button variant="ghost" onClick={goBack}><ArrowLeft />返回地图（保留席位）</Button>
          <output className={`connection-pill is-${connection}`} aria-live="polite">
            {connection === 'connected' ? <Wifi /> : <WifiOff />}
            {connection === 'connected' ? '已连接' : connection === 'offline' ? '连接中断' : '正在重连'}
          </output>
        </div>

        <div className="room-hero">
          <div>
            <span className="online-kicker"><ShieldCheck />私人房间</span>
            <h1>{room.code}</h1>
            <p>{room.mapName} · {modeName} · {room.targetPlayers} 人 · 落子预览{room.previewEnabled ? '开启' : '关闭'}</p>
          </div>
          <Button size="lg" onClick={() => void copyInvite()}><Copy />复制邀请链接</Button>
        </div>

        <div className="room-layout">
          <section className="room-seats-card">
            <div className="room-section-title"><div><small>玩家席位</small><h2>{room.seats.length} / {room.targetPlayers} 已加入</h2></div><span>{readyCount} 人准备</span></div>
            <div className="room-seat-list">
              {Array.from({ length: room.targetPlayers }, (_, index) => {
                const seat = room.seats.find((item) => item.seat === index);
                const player = PLAYER_STYLES[index];
                return seat ? (
                  <div className={`room-seat ${seat.ready ? 'is-ready' : ''}`} key={seat.id}>
                    <span className="player-token" style={{ background: player.color }}>{player.symbol}</span>
                    <div><strong>{seat.name}{seat.seat === room.meSeat ? '（你）' : ''}</strong><small>{seat.isHost ? '房主' : `玩家 ${index + 1}`}</small></div>
                    {seat.isHost && <Crown className="host-crown" />}
                    <span className="ready-state">{seat.ready ? <><Check />已准备</> : '未准备'}</span>
                  </div>
                ) : (
                  <div className="room-seat is-empty" key={index}>
                    <span className="empty-seat-number">{index + 1}</span>
                    <div><strong>等待玩家加入</strong><small>分享房间码 {room.code}</small></div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="room-control-card">
            {room.isHost && (
              <section className="room-host-config">
                <span className="section-label"><SlidersHorizontal />房主设置</span>
                <div className="room-preview-setting"><span><strong>落子预览</strong><small>统一对所有玩家生效</small></span><Switch aria-label="房间落子预览" checked={configPreviewEnabled} onCheckedChange={setConfigPreviewEnabled} disabled={!!working} /></div>
                <div className="room-config-field">
                  <small>对局人数</small>
                  <Select value={String(configPlayers)} onValueChange={(value) => setConfigPlayers(Number(value))}>
                    <SelectTrigger aria-label="修改房间人数"><SelectValue /></SelectTrigger>
                    <SelectContent>{[2, 3, 4, 5, 6].map((count) => <SelectItem key={count} value={String(count)} disabled={count < room.seats.length}>{count} 人</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="room-config-field">
                  <small>对战地图</small>
                  <Select value={configMapKey} onValueChange={(value) => { if (value) setConfigMapKey(value); }}>
                    <SelectTrigger aria-label="修改房间地图"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {configurableMapOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="secondary" onClick={() => void applyRoomConfig()} disabled={!!working || connection !== 'connected' || (configPlayers === room.targetPlayers && configMapKey === `room:${room.mapId}`) || configPlayers < room.seats.length}>
                  {working === 'configure' ? <LoaderCircle className="spin" /> : <MapPinned />}应用房间设置
                </Button>
                <small>修改后全员需要重新准备；已加入的玩家不会被自动移除。</small>
              </section>
            )}
            <span className="section-label">开局准备</span>
            <h2>{mySeat?.ready ? '你已准备就绪' : '准备好后锁定席位'}</h2>
            <p>{configDirty ? '房间设置尚未应用，请先应用后再准备或开局。' : !full ? `还差 ${room.targetPlayers - room.seats.length} 位朋友加入。` : !allReady ? '等待所有玩家确认准备。' : room.isHost ? '全员就绪，可以开始对局。' : '全员就绪，等待房主开始。'}</p>
            <Button size="lg" variant={mySeat?.ready ? 'outline' : 'default'} onClick={() => void roomAction('ready', { ready: !mySeat?.ready })} disabled={configDirty || !!working || connection !== 'connected'}>
              {working === 'ready' ? <LoaderCircle className="spin" /> : mySeat?.ready ? <RefreshCw /> : <Check />}
              {mySeat?.ready ? '取消准备' : '我准备好了'}
            </Button>
            {room.isHost && (
              <Button size="lg" onClick={() => void roomAction('start')} disabled={configDirty || !allReady || !!working || connection !== 'connected'}>
                {working === 'start' ? <LoaderCircle className="spin" /> : <Play />}开始对局
              </Button>
            )}
            <div className="room-control-divider" />
            <Button variant="ghost" onClick={() => void leaveRoom(true)} disabled={!!working}>退出并释放席位</Button>
          </aside>
        </div>
        {(notice || error) && <output className={`online-message ${error ? 'is-error' : ''}`} aria-live={error ? 'assertive' : 'polite'}>{error || notice}</output>}
      </section>
    );
  }

  const match = room.match;
  const boardCells = displayCells.length === map.cells.length ? displayCells : hydrateMatchCells(map, match);
  const counts = countTerritory(boardCells, match.playerCount);
  const activeCellCount = boardCells.filter((cell) => cell.active).length;
  const dominionPercent = match.dominionPercent ?? DOMINION_PERCENT;
  const currentStyle = PLAYER_STYLES[match.currentPlayer];
  const currentSeat = room.seats.find((seat) => seat.seat === match.currentPlayer);
  const readyAt = room.lastTurn?.readyAt ?? 0;
  const isMyTurn = match.currentPlayer === room.meSeat;
  const proposal = room.abortProposal && room.abortProposal.expiresAt > clock ? room.abortProposal : null;
  const hasApprovedAbort = !!(proposal && mySeat && proposal.approvals.includes(mySeat.id));
  const canCancelAbort = !!(proposal && mySeat && (proposal.proposerSeatId === mySeat.id || room.isHost));
  const abortSecondsLeft = proposal ? Math.max(1, Math.ceil((proposal.expiresAt - clock) / 1_000)) : 0;
  const canAct = connection === 'connected' && !working && !animating && !proposal && match.phase === 'playing' && isMyTurn && clock >= readyAt;
  const winnerSeat = match.winner === null ? null : room.seats.find((seat) => seat.seat === match.winner);
  const matchEnded = match.phase !== 'playing';
  const turnTitle = animating
    ? `第 ${waveNumber || 1} 波反应`
    : matchEnded
      ? winnerSeat ? `${winnerSeat.name}获胜` : '本局平局'
      : isMyTurn ? '轮到你' : `等待${currentSeat?.name ?? currentStyle.name}行动`;
  const displayedTurn = animating ? room.lastTurn?.turnNumber ?? match.turnNumber : match.turnNumber;
  const displayedStep = animating ? room.lastTurn?.turnStep ?? 1 : match.turnStep;

  return (
    <section className="online-arena-page">
      {connection !== 'connected' && (
        <output className="connection-banner" aria-live="polite">
          <WifiOff />
          <span><strong>{connection === 'offline' ? '连接暂时中断' : '正在重新连接'}</strong><small>棋盘会保留，恢复连接后自动同步最新回合。</small></span>
          <Button size="sm" variant="outline" onClick={() => void syncRoom(false)}>立即重试</Button>
        </output>
      )}

      <div className="online-game-toolbar">
        {match.phase === 'playing'
          ? <Button variant="ghost" onClick={() => void roomAction('proposeAbort')} disabled={!!working || animating || !!proposal || connection !== 'connected'}><ArrowLeft />{proposal ? '正在表决' : '提议返回房间'}</Button>
          : <span className="online-game-finished-label">本局已结束</span>}
        <div>
          <span><Wifi />房间 {room.code}</span>
        </div>
      </div>

      <div className="arena-layout online-arena-layout">
        <div className="board-panel">
          <div className="board-heading">
            <div>
              <span className="eyebrow">线上 {match.playerCount} 人 · {modeName}</span>
              <h1><i style={{ background: currentStyle.color }} />{turnTitle}</h1>
            </div>
            <div className="move-counter"><span className={match.mode === 'surge' ? 'double-step-label' : undefined}>{match.mode === 'surge' ? `回合 · 第 ${displayedStep}/2 步` : '回合'}</span><strong>{String(displayedTurn).padStart(2, '0')}</strong></div>
          </div>

          <div className={`board-frame ${animating ? 'is-resolving' : ''} ${waveNumber > 12 ? 'is-accelerated' : ''}`}>
            <div className="board-corner-meta"><span>{map.rows} × {map.cols}</span><span>{activeCellCount} 格</span></div>
            <GameBoard
              map={map}
              cells={boardCells}
              snapshot={match}
              previewEnabled={room.previewEnabled !== false && !previewSuspended}
              energyDisplayMode={energyDisplayMode}
              currentPlayer={match.currentPlayer}
              blockedIndex={match.mode === 'surge' && match.turnStep === 2 ? match.firstMoveIndex : null}
              disabled={!canAct}
              exploding={exploding}
              receiving={receiving}
              transfers={transfers}
              lastMove={room.lastTurn}
              onCell={(index) => void submitMove(index)}
            />
          </div>

          <div className={`board-hint ${animating ? 'is-live' : ''}`}>
            {connection !== 'connected' ? <WifiOff /> : isMyTurn ? <Radio /> : <Wifi />}
            <span>{connection !== 'connected' ? '正在恢复连接，暂时不能落子。' : proposal ? '结束本局的提议正在表决，棋局暂时暂停。' : animating ? '服务器已确认这一步，正在播放完整连锁。' : matchEnded ? '对局已经结束，可返回房间或退出到地图。' : isMyTurn ? canAct ? match.mode === 'surge' ? match.turnStep === 2 ? '还有第二步：选择另一个合法格注入 1 点，虚线格本回合已使用。' : '第一步：选择己方格或全空中立格注入 1 点，结算后可再下一步。' : '轮到你：选择己方格或全空中立格注入能量。' : '上一手棋即将播放完毕。' : `等待${currentSeat?.name ?? '其他玩家'}落子。`}</span>
          </div>
        </div>

        <aside className="status-panel">
          {proposal && match.phase === 'playing' && (
            <section className="online-abort-card">
              <span className="section-label">结束本局提议</span>
              <h2>{proposal.proposerName} 希望返回房间</h2>
              <p>需要当前 {room.seats.length} 位玩家全部同意。表决期间棋局暂停，{abortSecondsLeft} 秒后自动继续。</p>
              <div className="abort-vote-progress">
                <i style={{ width: `${proposal.approvals.length / room.seats.length * 100}%` }} />
                <span>{proposal.approvals.length} / {room.seats.length} 已同意</span>
              </div>
              {!hasApprovedAbort ? (
                <div className="abort-vote-actions">
                  <Button onClick={() => void roomAction('voteAbort', { proposalId: proposal.id, approve: true })} disabled={!!working}><Check />同意返回</Button>
                  <Button variant="outline" onClick={() => void roomAction('voteAbort', { proposalId: proposal.id, approve: false })} disabled={!!working}>拒绝，继续对局</Button>
                </div>
              ) : <small>你已同意，正在等待其他玩家。</small>}
              {canCancelAbort && <Button variant="ghost" size="sm" onClick={() => void roomAction('cancelAbort', { proposalId: proposal.id })} disabled={!!working}>取消提议</Button>}
            </section>
          )}
          <section className="turn-card" style={{ '--active-rgb': currentStyle.rgb } as React.CSSProperties}>
            <span className="section-label">{animating ? '能量反应' : matchEnded ? '对局结束' : isMyTurn ? '你的回合' : '当前行动'}</span>
            <div className="turn-player">
              <span className="player-token" style={{ background: currentStyle.color }}>{currentStyle.symbol}</span>
              <div><strong>{currentSeat?.name ?? currentStyle.name}{isMyTurn ? '（你）' : ''}</strong><small>{animating ? `正在传播第 ${waveNumber || 1} 波` : match.mode === 'surge' ? `第 ${match.turnStep}/2 步 · 每步注入 1 点` : '本回合注入 1 点能量'}</small></div>
            </div>
            <div className={`turn-progress ${animating || working === 'move' ? 'is-busy' : ''}`}><i /></div>
          </section>

          <section className="score-card">
            <div className="section-title"><span className="section-label">房间势力</span><small>{counts.reduce((sum, count) => sum + count, 0)} / {activeCellCount} 已占领</small></div>
            {match.mode === 'dominion' && <p className="dominion-target">胜利目标 · 占领 {getDominionTarget(activeCellCount, dominionPercent)} 格（{dominionPercent}%）</p>}
            <div className="score-bar">
              {counts.map((count, index) => <i key={index} style={{ width: `${activeCellCount ? count / activeCellCount * 100 : 0}%`, background: PLAYER_STYLES[index].color }} />)}
            </div>
            {room.seats.map((seat) => (
              <div className={`player-row ${match.currentPlayer === seat.seat ? 'active' : ''}`} key={seat.id}>
                <span className="mini-token" style={{ background: PLAYER_STYLES[seat.seat].color }}>{PLAYER_STYLES[seat.seat].symbol}</span>
                <span className="player-name">{seat.name}{seat.seat === room.meSeat ? '（你）' : ''}{match.currentPlayer === seat.seat && match.phase === 'playing' ? <em>行动中</em> : null}</span>
                <strong>{counts[seat.seat] ?? 0}<small> 格</small></strong>
              </div>
            ))}
          </section>

          {(match.phase === 'finished' || match.phase === 'draw') && (
            <section className="online-result-card">
              <span className="section-label">对局结束</span>
              <h2>{winnerSeat ? `${winnerSeat.name}获胜` : '本局平局'}</h2>
              <p>{match.winReason === 'singularity' ? '不可停止的能量奇点结束了对局。' : match.winReason === 'dominion' ? `率先控制至少 ${dominionPercent}% 的有效格。` : match.winReason === 'classic' ? '成为唯一颜色并控制超过半数有效格。' : '场上已没有任何合法行动。'}</p>
              <div className="online-result-actions">
                <Button onClick={() => void roomAction('returnToRoom')} disabled={!!working || animating || clock < readyAt}><RefreshCw />返回房间</Button>
                <Button variant="outline" onClick={() => void leaveRoom(true)} disabled={!!working || animating || clock < readyAt}><LogOut />退出并返回地图</Button>
              </div>
            </section>
          )}

          <section className="online-room-card">
            <span><ShieldCheck />房间 {room.code}</span>
            <small>刷新页面或短暂断线后会自动恢复此席位。</small>
            <Button variant="ghost" size="sm" onClick={() => void copyInvite()}><Copy />邀请朋友</Button>
          </section>
        </aside>
      </div>

      {(notice || error) && <output className={`online-message ${error ? 'is-error' : ''} floating-message`} aria-live={error ? 'assertive' : 'polite'}>{error || notice}</output>}
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {connection !== 'connected' ? '联机连接中断，正在重新连接' : animating ? `正在播放第 ${waveNumber || 1} 波爆炸` : matchEnded ? winnerSeat ? `${winnerSeat.name}获胜` : '本局平局' : isMyTurn ? '轮到你行动' : `等待${currentSeat?.name ?? '其他玩家'}行动`}
      </output>
    </section>
  );
}
