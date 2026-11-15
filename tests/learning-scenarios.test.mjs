import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOST_DEMO, demoFrames, LESSONS, resolveLessonReply, SIMULTANEOUS_DEMO } from '../lib/learning-scenarios.ts';
import { getDominionTarget } from '../lib/game-modes.ts';
import { resolveTurn } from '../lib/match-engine.ts';

const findLesson = (id) => LESSONS.find((entry) => entry.id === id);

test('每章引导落点可结算，演示准确回放练习结果', () => {
  for (const example of [...LESSONS, SIMULTANEOUS_DEMO]) {
    let state = example.initial;
    for (const [step, target] of example.targets.entries()) {
      const move = resolveTurn(example.map, state, 0, target);
      assert.ok(move.ok, example.id);
      state = move.value.next;
      if (step < example.targets.length - 1) state = resolveLessonReply(example, state)?.next ?? state;
    }
    assert.deepEqual(demoFrames(example).at(-1).cells, state.cells, example.id);
  }
});

test('练习局面演示第二波、解锁、被动传能和经典胜利', () => {
  const move = (id) => {
    const example = findLesson(id);
    return resolveTurn(example.map, example.initial, 0, example.targets[0]).value;
  };
  assert.equal(move('burst').waves.length, 1);
  assert.deepEqual(move('chain').waves.map(({ exploding }) => exploding), [[0], [1]]);

  const special = move('lock');
  assert.deepEqual(special.next.cells[1], { owner: 0, energy: 2 });
  assert.deepEqual(special.waves[1].transfers, [
    { source: 3, target: 0, amount: 1 },
    { source: 3, target: 4, amount: 1 },
    { source: 3, target: 6, amount: 1 },
  ]);

  assert.equal(move('win').next.winReason, 'classic');
  assert.equal(move('win').next.cells.filter((cell) => cell.owner === 0).length, 5);
});

test('强化示例演示加倍分流和溢出，第二次爆炸之后保留额外能量与归属', () => {
  const boost = resolveTurn(BOOST_DEMO.map, BOOST_DEMO.initial, 0, 0).value;
  assert.deepEqual(boost.waves[0].transfers, [
    { source: 0, target: 1, amount: 2 },
    { source: 0, target: 3, amount: 1 },
  ]);
  assert.deepEqual(demoFrames(BOOST_DEMO)[3].cells[1], { owner: 0, energy: 4 });
  assert.deepEqual(boost.next.cells[1], { owner: 0, energy: 1 });
});

test('同一波的两个格同时爆炸，中心格接收两份能量', () => {
  const frames = demoFrames(SIMULTANEOUS_DEMO);
  const simultaneous = frames.findIndex((frame) => frame.bursting?.length === 2);
  assert.deepEqual(frames[simultaneous].bursting, [1, 3]);
  assert.deepEqual(frames[simultaneous + 1].cells[4], { owner: 0, energy: 2 });
});

test('双脉冲练习保留第一步位置，完成两次不同注能后换人', () => {
  const example = findLesson('surge');
  const first = resolveTurn(example.map, example.initial, 0, 0).value.next;
  assert.equal(first.turnStep, 2);
  assert.deepEqual(resolveTurn(example.map, first, 0, 0), { ok: false, error: 'CELL_ALREADY_USED' });
  assert.equal(resolveTurn(example.map, first, 0, 4).value.next.currentPlayer, 1);
});

test('丢光领地仍能重入，疆域赛有其他颜色时也能胜利', () => {
  const rejoin = findLesson('rejoin');
  assert.equal(rejoin.initial.cells.filter(({ owner }) => owner === 0).length, 0);
  assert.deepEqual(demoFrames(rejoin).at(-1).cells[8], { owner: 0, energy: 1 });

  const dominion = findLesson('dominion');
  const outcome = resolveTurn(dominion.map, dominion.initial, 0, dominion.targets[0]).value.next;
  assert.equal(outcome.winReason, 'dominion');
  assert.equal(outcome.cells.filter(({ owner }) => owner === 0).length, getDominionTarget(dominion.map.cells.length));
  assert.equal(outcome.cells.filter(({ owner }) => owner === 1).length, 1);
});

test('实战练习包含蓝方的真实回应，正确应对能以连锁赢下经典模式', () => {
  const example = findLesson('challenge');
  const first = resolveTurn(example.map, example.initial, 0, example.targets[0]).value;
  assert.equal(first.next.phase, 'playing');
  const reply = resolveLessonReply(example, first.next);
  assert.equal(reply.actor, 1);
  assert.equal(reply.cellIndex, example.reply);
  const final = resolveTurn(example.map, reply.next, 0, example.targets[1]).value;
  assert.equal(final.next.winReason, 'classic');
  assert.equal(final.next.winner, 0);
  assert.ok(final.waves.length > 1);
});
