// Run against an owned local dev server: node --experimental-strip-types scripts/check-online-double-step.mjs
import assert from 'node:assert/strict';
import { createCustomMap, serializeCustomMap } from '../lib/explosion-game.ts';

const endpoint = 'http://localhost:3000/api/online';
const request = async (body) => {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
};
let room;
const tokens = [];
const action = async (name, seat, extra = {}) => {
  const result = await request({ action: name, code: room.code, token: tokens[seat], expectedRevision: room.revision, ...extra });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.room) room = result.room;
  return result;
};
const settle = async () => {
  const delay = (room.lastTurn?.readyAt ?? 0) - Date.now() + 20;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
};

const map = createCustomMap(1, 9, 8, undefined, 'trihex', '双步联机本地回归');
const created = await request({ action: 'create', name: '本地检查甲', targetPlayers: 2, mapId: map.id, customMap: serializeCustomMap(map), mode: 'surge' });
assert.equal(created.ok, true, JSON.stringify(created));
room = created.room;
tokens[0] = created.token;
try {
  const joined = await request({ action: 'join', code: room.code, name: '本地检查乙' });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  tokens[1] = joined.token;
  room = joined.room;
  assert.equal(room.seats.length, 2);
  assert.notEqual(room.seats[0].id, room.seats[1].id);
  assert.equal(room.previewEnabled, true);
  const denied = await request({ action: 'configure', code: room.code, token: tokens[1], expectedRevision: room.revision, targetPlayers: 2, mapId: map.id, customMap: serializeCustomMap(map), previewEnabled: false });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'HOST_ONLY');
  await action('ready', 0, { ready: true });
  await action('configure', 0, { targetPlayers: 2, mapId: map.id, customMap: serializeCustomMap(map), previewEnabled: false });
  assert.equal(room.previewEnabled, false);
  assert.equal(room.seats.every((seat) => !seat.ready), true);
  await action('snapshot', 1);
  assert.equal(room.previewEnabled, false);
  await action('ready', 0, { ready: true });
  await action('ready', 1, { ready: true });
  await action('start', 0);
  assert.equal(room.match.rulesVersion, 2);
  assert.equal(room.match.cells.length, 184);
  assert.equal(room.previewEnabled, false);
  const actor = room.match.currentPlayer;
  const firstRequest = { action: 'move', code: room.code, token: tokens[actor], expectedRevision: room.revision, commandId: crypto.randomUUID(), cellIndex: 9 };
  const first = await request(firstRequest);
  assert.equal(first.ok, true, JSON.stringify(first));
  room = first.room;
  assert.equal(room.match.currentPlayer, actor);
  assert.equal(room.match.turnStep, 2);
  assert.equal(room.match.firstMoveIndex, 9);
  assert.equal(room.match.cells[9].energy, 1);
  const replay = await request(firstRequest);
  assert.deepEqual(replay, first, 'retry must not inject energy twice');
  await action('snapshot', 1 - actor);
  assert.equal(room.match.turnStep, 2, 'reconnect must retain second step');
  await settle();
  const rejected = await request({ action: 'move', code: room.code, token: tokens[actor], expectedRevision: room.revision, commandId: crypto.randomUUID(), cellIndex: 9 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'CELL_ALREADY_USED');
  await action('move', actor, { commandId: crypto.randomUUID(), cellIndex: 10 });
  assert.equal(room.match.currentPlayer, 1 - actor);
  assert.equal(room.match.turnStep, 1);
  assert.equal(room.match.firstMoveIndex, null);
  assert.equal(room.match.turnNumber, 2);
  assert.equal(room.match.moves, 2);
  assert.equal(room.match.cells[10].energy, 1);
  console.log('PASS: custom map, first/second placement, same-cell rejection, reconnect, idempotent retry and turn change');
} finally {
  if (room.phase === 'playing' && tokens[1]) {
    await settle();
    await action('proposeAbort', 0);
    await action('voteAbort', 1, { proposalId: room.abortProposal.id, approve: true });
    assert.equal(room.seats.length, 2);
  }
  if (room.phase === 'finished' || room.phase === 'draw') { await settle(); await action('returnToRoom', 0); }
  if (room.phase === 'waiting') {
    if (tokens[1]) {
      await action('leave', 1);
      await action('snapshot', 0);
      assert.equal(room.seats.length, 1);
    }
    await action('leave', 0);
  }
}
