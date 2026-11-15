import { env } from 'cloudflare:workers';
import {
  MAP_LIBRARY,
  MAX_CUSTOM_MAP_CELLS,
  deserializeCustomMap,
  findOfficialMap,
  serializeCustomMap,
  validateMap,
  type CustomMapSnapshot,
  type GameMap,
} from '@/lib/explosion-game';
import { createMatchSnapshot, normalizeMatchSnapshot, resolveTurn, type MatchSnapshot } from '@/lib/match-engine';
import type { GameModeId } from '@/lib/game-modes';
import type { OnlineRoomPhase, OnlineRoomView, OnlineTurnEvent } from '@/lib/online-types';

export const dynamic = 'force-dynamic';

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const MODES = new Set<GameModeId>(['classic', 'surge', 'dominion']);
const MAX_BODY_BYTES = 256 * 1024;
const ABORT_PROPOSAL_TTL_MS = 90_000;

interface StoredSeat {
  id: string;
  seat: number;
  name: string;
  ready: boolean;
  tokenHash: string;
  joinedAt: number;
}

interface StoredRoomState {
  phase: OnlineRoomPhase;
  targetPlayers: number;
  mapId: string;
  customMap?: CustomMapSnapshot | null;
  mode: GameModeId;
  previewEnabled?: boolean;
  hostSeatId: string;
  seats: StoredSeat[];
  match: MatchSnapshot | null;
  lastTurn: OnlineTurnEvent | null;
  abortProposal?: StoredAbortProposal | null;
}

interface StoredAbortProposal {
  id: string;
  proposerSeatId: string;
  approvals: string[];
  createdAt: number;
  expiresAt?: number;
}

type ActiveAbortProposal = StoredAbortProposal & { expiresAt: number };

interface RoomRow {
  code: string;
  revision: number;
  state_json: string;
  last_command_id: string | null;
  last_request_hash: string | null;
  last_result_json: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

interface CommandRow {
  request_hash: string;
  result_json: string;
}

type JsonRecord = Record<string, unknown>;

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

function fail(status: number, code: string, message: string, retryAt?: number) {
  return json({ ok: false, error: { code, message, ...(retryAt ? { retryAt } : {}) } }, status);
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 16) : '';
}

function cleanCode(value: unknown) {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6) : '';
}

function randomHex(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomRoomCode() {
  const data = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(data, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function bodyOf(request: Request): Promise<JsonRecord> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  if (!request.body) throw new Error('INVALID_BODY');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* The size violation still takes precedence. */ }
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BODY');
  return value as JsonRecord;
}

function parseState(row: RoomRow): StoredRoomState {
  const state = JSON.parse(row.state_json) as StoredRoomState;
  return { ...state, previewEnabled: state.previewEnabled !== false, match: state.match ? normalizeMatchSnapshot(state.match) : null, customMap: state.customMap ?? null, abortProposal: state.abortProposal ?? null };
}

function activeAbortProposal(state: Pick<StoredRoomState, 'abortProposal'>, now = Date.now()): ActiveAbortProposal | null {
  const proposal = state.abortProposal ?? null;
  if (!proposal) return null;
  const expiresAt = proposal.expiresAt ?? proposal.createdAt + ABORT_PROPOSAL_TTL_MS;
  return expiresAt > now ? { ...proposal, expiresAt } : null;
}

function resolveRoomMap(state: Pick<StoredRoomState, 'mapId' | 'customMap'>): GameMap | null {
  if (state.customMap) return deserializeCustomMap(state.customMap);
  return findOfficialMap(state.mapId) ?? null;
}

function resolveMapSelection(body: JsonRecord, targetPlayers: number, currentMapId?: string) {
  const mapId = typeof body.mapId === 'string' ? body.mapId : '';
  const customMap = body.customMap == null ? null : deserializeCustomMap(body.customMap);
  if (body.customMap != null && !customMap) return { ok: false, error: '自制地图数据无效，请返回地图工坊重新保存' } as const;
  const officialMap = mapId === currentMapId ? findOfficialMap(mapId) : MAP_LIBRARY.find((item) => item.id === mapId);
  const map = customMap ?? officialMap ?? null;
  if (!map || map.id !== mapId) return { ok: false, error: '所选地图无效' } as const;
  if (customMap && customMap.cells.length > MAX_CUSTOM_MAP_CELLS) return { ok: false, error: `自制地图最多支持 ${MAX_CUSTOM_MAP_CELLS} 个格子参与联机` } as const;
  const warnings = validateMap(map, targetPlayers);
  if (warnings.length) return { ok: false, error: warnings[0] } as const;
  return { ok: true, map, customMap: customMap ? serializeCustomMap(customMap) : null } as const;
}

async function loadRoom(db: D1Database, code: string) {
  const row = await db.prepare(`
    SELECT code, revision, state_json, last_command_id, last_request_hash,
           last_result_json, created_at, updated_at, expires_at
    FROM online_rooms
    WHERE code = ?
  `).bind(code).first<RoomRow>();
  if (!row || row.expires_at <= Date.now()) return null;
  return { row, state: parseState(row) };
}

function changes(result: D1Result<unknown>) {
  return Number(result.meta?.changes ?? 0);
}

async function authenticate(state: StoredRoomState, token: unknown) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const tokenHash = await digest(token);
  const seat = state.seats.find((item) => item.tokenHash === tokenHash) ?? null;
  return seat ? { seat, tokenHash } : null;
}

function roomView(row: RoomRow, state: StoredRoomState, tokenHash: string): OnlineRoomView {
  const me = state.seats.find((seat) => seat.tokenHash === tokenHash);
  const map = resolveRoomMap(state);
  const proposal = activeAbortProposal(state);
  return {
    code: row.code,
    phase: state.phase,
    targetPlayers: state.targetPlayers,
    mapId: state.mapId,
    mapName: map?.name ?? '未知地图',
    customMap: state.customMap ?? null,
    mode: state.mode,
    previewEnabled: state.previewEnabled !== false,
    revision: row.revision,
    seats: state.seats.map((seat) => ({
      id: seat.id,
      seat: seat.seat,
      name: seat.name,
      ready: seat.ready,
      isHost: seat.id === state.hostSeatId,
    })),
    meSeat: me?.seat ?? -1,
    isHost: me?.id === state.hostSeatId,
    match: state.match,
    lastTurn: state.lastTurn,
    abortProposal: proposal ? {
      ...proposal,
      proposerName: state.seats.find((seat) => seat.id === proposal.proposerSeatId)?.name ?? '一位玩家',
    } : null,
    updatedAt: row.updated_at,
  };
}

function prospectiveRow(row: RoomRow, revision: number, state: StoredRoomState, now: number): RoomRow {
  return {
    ...row,
    revision,
    state_json: JSON.stringify(state),
    updated_at: now,
    expires_at: now + ROOM_TTL_MS,
  };
}

async function saveRoom(db: D1Database, row: RoomRow, state: StoredRoomState) {
  const now = Date.now();
  const revision = row.revision + 1;
  const result = await db.prepare(`
    UPDATE online_rooms
    SET revision = ?, state_json = ?, updated_at = ?, expires_at = ?
    WHERE code = ? AND revision = ?
  `).bind(revision, JSON.stringify(state), now, now + ROOM_TTL_MS, row.code, row.revision).run();
  return changes(result) === 1 ? prospectiveRow(row, revision, state, now) : null;
}

async function createRoom(db: D1Database, body: JsonRecord) {
  const name = cleanName(body.name);
  const targetPlayers = Number(body.targetPlayers);
  const mode = body.mode as GameModeId;
  if (!name) return fail(400, 'INVALID_NAME', '请输入 1–16 个字符的昵称');
  if (!Number.isInteger(targetPlayers) || targetPlayers < 2 || targetPlayers > 6) return fail(400, 'INVALID_PLAYER_COUNT', '房间人数必须为 2–6 人');
  if (!MODES.has(mode)) return fail(400, 'INVALID_MODE', '游戏模式无效');
  if (body.previewEnabled !== undefined && typeof body.previewEnabled !== 'boolean') return fail(400, 'INVALID_SETTINGS', '落子预览设置无效');
  const selection = resolveMapSelection(body, targetPlayers);
  if (!selection.ok) return fail(400, 'INVALID_MAP', selection.error);

  await db.prepare('DELETE FROM online_rooms WHERE expires_at <= ?').bind(Date.now()).run();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const now = Date.now();
    const code = randomRoomCode();
    const token = randomHex();
    const tokenHash = await digest(token);
    const seatId = randomHex(10);
    const state: StoredRoomState = {
      phase: 'waiting',
      targetPlayers,
      mapId: selection.map.id,
      customMap: selection.customMap,
      mode,
      previewEnabled: body.previewEnabled !== false,
      hostSeatId: seatId,
      seats: [{ id: seatId, seat: 0, name, ready: false, tokenHash, joinedAt: now }],
      match: null,
      lastTurn: null,
      abortProposal: null,
    };
    const result = await db.prepare(`
      INSERT OR IGNORE INTO online_rooms
        (code, revision, state_json, created_at, updated_at, expires_at)
      VALUES (?, 0, ?, ?, ?, ?)
    `).bind(code, JSON.stringify(state), now, now, now + ROOM_TTL_MS).run();
    if (changes(result) === 1) {
      const row: RoomRow = {
        code,
        revision: 0,
        state_json: JSON.stringify(state),
        last_command_id: null,
        last_request_hash: null,
        last_result_json: null,
        created_at: now,
        updated_at: now,
        expires_at: now + ROOM_TTL_MS,
      };
      return json({ ok: true, token, room: roomView(row, state, tokenHash) });
    }
  }
  return fail(503, 'ROOM_CODE_BUSY', '暂时无法分配房间码，请重试');
}

async function joinRoom(db: D1Database, body: JsonRecord) {
  const code = cleanCode(body.code);
  const name = cleanName(body.name);
  const claimedToken = typeof body.claimToken === 'string' && /^[a-f0-9]{48}$/.test(body.claimToken)
    ? body.claimToken
    : randomHex();
  const claimedTokenHash = await digest(claimedToken);
  if (code.length !== 6) return fail(400, 'INVALID_CODE', '请输入 6 位房间码');
  if (!name) return fail(400, 'INVALID_NAME', '请输入 1–16 个字符的昵称');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadRoom(db, code);
    if (!loaded) return fail(404, 'ROOM_NOT_FOUND', '房间不存在或已经过期');
    const { row, state } = loaded;
    if (state.seats.some((seat) => seat.tokenHash === claimedTokenHash)) {
      return json({ ok: true, token: claimedToken, room: roomView(row, state, claimedTokenHash) });
    }
    if (state.phase !== 'waiting') return fail(409, 'MATCH_ALREADY_STARTED', '这局已经开始，无法加入新玩家');
    if (state.seats.length >= state.targetPlayers) return fail(409, 'ROOM_FULL', '房间已经满员');

    const now = Date.now();
    const seat: StoredSeat = {
      id: randomHex(10),
      seat: state.seats.length,
      name,
      ready: false,
      tokenHash: claimedTokenHash,
      joinedAt: now,
    };
    const nextState = { ...state, seats: [...state.seats, seat] };
    const saved = await saveRoom(db, row, nextState);
    if (saved) return json({ ok: true, token: claimedToken, room: roomView(saved, nextState, claimedTokenHash) });
  }
  return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请再试一次');
}

async function authenticatedRoom(db: D1Database, body: JsonRecord) {
  const code = cleanCode(body.code);
  if (code.length !== 6) return { error: fail(400, 'INVALID_CODE', '房间码无效') } as const;
  const loaded = await loadRoom(db, code);
  if (!loaded) return { error: fail(404, 'ROOM_NOT_FOUND', '房间不存在或已经过期') } as const;
  const auth = await authenticate(loaded.state, body.token);
  if (!auth) return { error: fail(401, 'UNAUTHORIZED', '席位凭证已失效，请重新加入房间') } as const;
  return { ...loaded, auth } as const;
}

async function snapshot(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  return json({ ok: true, room: roomView(loaded.row, loaded.state, loaded.auth.tokenHash) });
}

async function setReady(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  if (Number(body.expectedRevision) !== row.revision) return fail(409, 'STALE_REVISION', '房间设置已变化，请确认后重新准备');
  if (state.phase !== 'waiting') return fail(409, 'MATCH_ALREADY_STARTED', '对局已经开始');
  const ready = body.ready === true;
  const nextState = {
    ...state,
    seats: state.seats.map((seat) => seat.id === auth.seat.id ? { ...seat, ready } : seat),
  };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function configureRoom(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  if (auth.seat.id !== state.hostSeatId) return fail(403, 'HOST_ONLY', '只有房主可以修改房间设置');
  if (state.phase !== 'waiting') return fail(409, 'MATCH_ALREADY_STARTED', '只能在等待房间中修改设置');
  if (Number(body.expectedRevision) !== row.revision) return fail(409, 'STALE_REVISION', '房间刚刚发生变化，请重新确认设置');
  const targetPlayers = Number(body.targetPlayers);
  if (!Number.isInteger(targetPlayers) || targetPlayers < 2 || targetPlayers > 6) return fail(400, 'INVALID_PLAYER_COUNT', '房间人数必须为 2–6 人');
  if (targetPlayers < state.seats.length) return fail(409, 'TOO_MANY_PLAYERS', `房间已有 ${state.seats.length} 人，不能将人数调低到 ${targetPlayers} 人`);
  if (body.previewEnabled !== undefined && typeof body.previewEnabled !== 'boolean') return fail(400, 'INVALID_SETTINGS', '落子预览设置无效');
  const selection = resolveMapSelection(body, targetPlayers, state.mapId);
  if (!selection.ok) return fail(400, 'INVALID_MAP', selection.error);
  const nextState: StoredRoomState = {
    ...state,
    targetPlayers,
    previewEnabled: typeof body.previewEnabled === 'boolean' ? body.previewEnabled : state.previewEnabled !== false,
    mapId: selection.map.id,
    customMap: selection.customMap,
    seats: state.seats.map((seat) => ({ ...seat, ready: false })),
    match: null,
    lastTurn: null,
    abortProposal: null,
  };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function startMatch(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  if (auth.seat.id !== state.hostSeatId) return fail(403, 'HOST_ONLY', '只有房主可以开始对局');
  if (Number(body.expectedRevision) !== row.revision) return fail(409, 'STALE_REVISION', '房间刚刚发生变化，请重新确认开局');
  if (state.phase !== 'waiting') return fail(409, 'MATCH_ALREADY_STARTED', '对局已经开始');
  if (state.seats.length !== state.targetPlayers) return fail(409, 'WAITING_FOR_PLAYERS', `还需要 ${state.targetPlayers - state.seats.length} 位玩家`);
  if (!state.seats.every((seat) => seat.ready)) return fail(409, 'NOT_ALL_READY', '还有玩家尚未准备');
  const map = resolveRoomMap(state);
  if (!map) return fail(409, 'INVALID_MAP', '房间地图已不可用');

  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  const nextRevision = row.revision + 1;
  const match = createMatchSnapshot(map, state.mode, state.seats.length, random % state.seats.length, nextRevision);
  const nextState: StoredRoomState = { ...state, phase: 'playing', match, lastTurn: null, abortProposal: null };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function move(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  if (state.phase !== 'playing' || !state.match) return fail(409, 'MATCH_NOT_PLAYING', '当前没有进行中的对局');
  if (activeAbortProposal(state)) return fail(409, 'ABORT_PROPOSAL_ACTIVE', '结束本局的提议正在表决，请先完成表决');

  const commandId = typeof body.commandId === 'string' ? body.commandId.slice(0, 80) : '';
  const expectedRevision = Number(body.expectedRevision);
  const cellIndex = Number(body.cellIndex);
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(commandId)) return fail(400, 'INVALID_COMMAND', '落子请求无效');
  if (!Number.isInteger(expectedRevision) || !Number.isInteger(cellIndex)) return fail(400, 'INVALID_MOVE', '落子请求无效');
  const requestHash = await digest(`${expectedRevision}:${cellIndex}`);

  const previous = await db.prepare(`
    SELECT request_hash, result_json
    FROM online_commands
    WHERE room_code = ? AND command_id = ?
  `).bind(row.code, commandId).first<CommandRow>();
  if (previous) {
    if (previous.request_hash !== requestHash) return fail(409, 'COMMAND_ID_REUSE', '该请求编号已用于另一手棋');
    return new Response(previous.result_json, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  if (expectedRevision !== row.revision || state.match.revision !== row.revision) return fail(409, 'STALE_REVISION', '棋局已更新，正在同步最新状态');
  const now = Date.now();
  if (state.lastTurn && now < state.lastTurn.readyAt) return fail(425, 'TURN_NOT_READY', '上一回合动画尚未结束', state.lastTurn.readyAt);

  const map = resolveRoomMap(state);
  if (!map) return fail(409, 'INVALID_MAP', '房间地图已不可用');
  const result = resolveTurn(map, state.match, auth.seat.seat, cellIndex);
  if (!result.ok) {
    const messages = {
      MATCH_FINISHED: '对局已经结束',
      NOT_YOUR_TURN: '现在不是你的回合',
      CELL_NOT_FOUND: '格子不存在',
      ILLEGAL_MOVE: '只能选择己方格或全空中立格',
      CELL_ALREADY_USED: '本回合已在这个格子落子，第二步请选择其他格子',
    } as const;
    return fail(result.error === 'NOT_YOUR_TURN' ? 403 : 409, result.error, messages[result.error]);
  }

  const animationDuration = Math.min(9_000, Math.max(420, 180 + result.value.waves.length * 620));
  const { next: nextMatch, ...turn } = result.value;
  const event: OnlineTurnEvent = { ...turn, readyAt: now + animationDuration };
  const phase: OnlineRoomPhase = result.value.next.phase === 'playing' ? 'playing' : result.value.next.phase;
  const nextState: StoredRoomState = { ...state, phase, match: nextMatch, lastTurn: event, abortProposal: null };
  const nextRevision = row.revision + 1;
  const nextRow = prospectiveRow(row, nextRevision, nextState, now);
  const payload = JSON.stringify({ ok: true, room: roomView(nextRow, nextState, auth.tokenHash) });

  const statements = [
    db.prepare(`
      UPDATE online_rooms
      SET revision = ?, state_json = ?, last_command_id = ?, last_request_hash = ?,
          last_result_json = ?, updated_at = ?, expires_at = ?
      WHERE code = ? AND revision = ?
    `).bind(nextRevision, JSON.stringify(nextState), commandId, requestHash, payload, now, now + ROOM_TTL_MS, row.code, row.revision),
    db.prepare(`
      INSERT OR IGNORE INTO online_commands
        (room_code, command_id, request_hash, result_json, created_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM online_rooms
        WHERE code = ? AND revision = ? AND last_command_id = ? AND last_request_hash = ?
      )
    `).bind(row.code, commandId, requestHash, payload, now, row.code, nextRevision, commandId, requestHash),
  ];
  const [updateResult] = await db.batch(statements);
  if (changes(updateResult) === 1) return new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

  const raced = await db.prepare(`
    SELECT request_hash, result_json
    FROM online_commands
    WHERE room_code = ? AND command_id = ?
  `).bind(row.code, commandId).first<CommandRow>();
  if (raced?.request_hash === requestHash) return new Response(raced.result_json, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return fail(409, 'STALE_REVISION', '另一条操作已先完成，正在同步最新状态');
}

async function returnToRoom(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  if (Number(body.expectedRevision) !== row.revision) return fail(409, 'STALE_REVISION', '对局状态已经变化，请重新确认');
  if (state.phase === 'waiting') return json({ ok: true, room: roomView(row, state, auth.tokenHash) });
  if (state.phase !== 'finished' && state.phase !== 'draw') return fail(409, 'MATCH_NOT_FINISHED', '当前对局尚未结束');
  if (state.lastTurn && Date.now() < state.lastTurn.readyAt) return fail(425, 'TURN_NOT_READY', '请等待最终连锁动画播放完成', state.lastTurn.readyAt);
  const nextState: StoredRoomState = {
    ...state,
    phase: 'waiting',
    seats: state.seats.map((seat) => ({ ...seat, ready: false })),
    match: null,
    lastTurn: null,
    abortProposal: null,
  };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function proposeAbort(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  if (state.phase !== 'playing' || !state.match) return fail(409, 'MATCH_NOT_PLAYING', '当前没有进行中的对局');
  if (Number(body.expectedRevision) !== row.revision) return fail(409, 'STALE_REVISION', '棋局刚刚发生变化，请重试');
  if (activeAbortProposal(state)) return json({ ok: true, room: roomView(row, state, auth.tokenHash) });
  const now = Date.now();
  if (state.lastTurn && Date.now() < state.lastTurn.readyAt) return fail(425, 'TURN_NOT_READY', '请等待当前连锁动画播放完成', state.lastTurn.readyAt);
  const nextState: StoredRoomState = {
    ...state,
    match: { ...state.match, revision: row.revision + 1 },
    abortProposal: {
      id: randomHex(8),
      proposerSeatId: auth.seat.id,
      approvals: [auth.seat.id],
      createdAt: now,
      expiresAt: now + ABORT_PROPOSAL_TTL_MS,
    },
  };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function voteAbort(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  const proposal = activeAbortProposal(state);
  if (state.phase !== 'playing' || !state.match || !proposal) return fail(409, 'NO_ABORT_PROPOSAL', '当前没有需要表决的提议');
  if (Number(body.expectedRevision) !== row.revision) return fail(409, 'STALE_REVISION', '表决状态已更新，请重新确认');
  if (body.proposalId !== proposal.id) return fail(409, 'STALE_PROPOSAL', '这项提议已经变化');

  if (body.approve !== true) {
    const nextState: StoredRoomState = {
      ...state,
      match: { ...state.match, revision: row.revision + 1 },
      abortProposal: null,
    };
    const saved = await saveRoom(db, row, nextState);
    if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
    return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
  }

  if (proposal.approvals.includes(auth.seat.id)) return json({ ok: true, room: roomView(row, state, auth.tokenHash) });
  const approvals = [...new Set([...proposal.approvals, auth.seat.id])];
  const accepted = state.seats.every((seat) => approvals.includes(seat.id));
  const nextState: StoredRoomState = accepted ? {
    ...state,
    phase: 'waiting',
    seats: state.seats.map((seat) => ({ ...seat, ready: false })),
    match: null,
    lastTurn: null,
    abortProposal: null,
  } : {
    ...state,
    match: { ...state.match, revision: row.revision + 1 },
    abortProposal: { ...proposal, approvals },
  };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function cancelAbort(db: D1Database, body: JsonRecord) {
  const loaded = await authenticatedRoom(db, body);
  if ('error' in loaded) return loaded.error;
  const { row, state, auth } = loaded;
  const proposal = activeAbortProposal(state);
  if (state.phase !== 'playing' || !proposal) return fail(409, 'NO_ABORT_PROPOSAL', '当前没有需要取消的提议');
  if (Number(body.expectedRevision) !== row.revision || body.proposalId !== proposal.id) return fail(409, 'STALE_PROPOSAL', '这项提议已经变化');
  if (auth.seat.id !== proposal.proposerSeatId && auth.seat.id !== state.hostSeatId) return fail(403, 'CANNOT_CANCEL', '只有提议者或房主可以取消表决');
  const nextState: StoredRoomState = {
    ...state,
    match: state.match ? { ...state.match, revision: row.revision + 1 } : null,
    abortProposal: null,
  };
  const saved = await saveRoom(db, row, nextState);
  if (!saved) return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
  return json({ ok: true, room: roomView(saved, nextState, auth.tokenHash) });
}

async function leaveRoom(db: D1Database, body: JsonRecord) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await authenticatedRoom(db, body);
    if ('error' in loaded) return loaded.error;
    const { row, state, auth } = loaded;
    if (state.phase === 'playing') return fail(409, 'MATCH_IN_PROGRESS', '对局进行中，请先发起结束本局的提议');
    if (state.lastTurn && Date.now() < state.lastTurn.readyAt) return fail(425, 'TURN_NOT_READY', '请等待最终连锁动画播放完成', state.lastTurn.readyAt);
    const remaining = state.seats.filter((seat) => seat.id !== auth.seat.id).map((seat, index) => ({ ...seat, seat: index }));
    if (remaining.length === 0) {
      // Cascading command deletions can make D1's changes count exceed one.
      const deleted = await db.prepare('DELETE FROM online_rooms WHERE code = ? AND revision = ? RETURNING code').bind(row.code, row.revision).first<{ code: string }>();
      if (deleted) return json({ ok: true, left: true });
      continue;
    }
    const nextState: StoredRoomState = {
      ...state,
      phase: 'waiting',
      hostSeatId: state.hostSeatId === auth.seat.id ? remaining[0].id : state.hostSeatId,
      seats: remaining.map((seat) => ({ ...seat, ready: false })),
      match: null,
      lastTurn: null,
      abortProposal: null,
    };
    const saved = await saveRoom(db, row, nextState);
    if (saved) return json({ ok: true, left: true });
  }
  return fail(409, 'ROOM_CHANGED', '房间刚刚发生变化，请重试');
}

export async function POST(request: Request) {
  try {
    const body = await bodyOf(request);
    const action = body.action;
    const db = database();
    if (!db) return fail(503, 'DATABASE_UNAVAILABLE', '联机服务暂时不可用');
    if (action === 'create') return createRoom(db, body);
    if (action === 'join') return joinRoom(db, body);
    if (action === 'snapshot') return snapshot(db, body);
    if (action === 'configure') return configureRoom(db, body);
    if (action === 'ready') return setReady(db, body);
    if (action === 'start') return startMatch(db, body);
    if (action === 'move') return move(db, body);
    if (action === 'returnToRoom' || action === 'rematch') return returnToRoom(db, body);
    if (action === 'proposeAbort') return proposeAbort(db, body);
    if (action === 'voteAbort') return voteAbort(db, body);
    if (action === 'cancelAbort') return cancelAbort(db, body);
    if (action === 'leave') return leaveRoom(db, body);
    return fail(400, 'UNKNOWN_ACTION', '未知的联机操作');
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') return fail(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
    if (error instanceof SyntaxError || (error instanceof Error && error.message === 'INVALID_BODY')) return fail(400, 'INVALID_BODY', '请求格式无效');
    console.error('Online room request failed', error);
    return fail(500, 'SERVER_ERROR', '联机服务暂时繁忙，请稍后重试');
  }
}
