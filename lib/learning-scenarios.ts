import { createClassicMap, createMap, explodeWave, PLAYER_STYLES, type GameMap, type Transfer } from './explosion-game.ts';
import { DOMINION_PERCENT, getDominionTarget } from './game-modes.ts';
import { createMatchSnapshot, hydrateMatchCells, resolveTurn, type DynamicCell, type MatchSnapshot, type TurnResolved } from './match-engine.ts';

const practiceMap = createClassicMap(3);
const specialMap = createMap({
  ...practiceMap,
  id: 'practice-lock',
  topology: 'square',
  customize: ({ row, col }) => {
    if (row === 0 && col === 1) return { initialEnergy: 1 };
    if (row === 1 && col === 0) return { autoCapacity: false, capacity: 1 };
    return {};
  },
});
const boostMap = createMap({
  ...practiceMap,
  id: 'practice-boost',
  topology: 'square',
  customize: ({ row, col }) => row === 0 && col === 0
    ? { autoCapacity: false, capacity: 3, boostDirections: ['R'] }
    : {},
});
const dominionTarget = getDominionTarget(practiceMap.cells.length);

export interface Lesson {
  id: string;
  title: string;
  action: string;
  followUp?: string;
  rule: string;
  success: string;
  map: GameMap;
  initial: MatchSnapshot;
  targets: number[];
  reply?: number;
}

interface LessonOptions extends Pick<Lesson, 'id' | 'title' | 'action' | 'followUp' | 'rule' | 'success' | 'targets' | 'reply'> {
  map?: GameMap;
  mode?: MatchSnapshot['mode'];
  occupied?: [index: number, owner: number, energy: number][];
}

function lesson({ map = practiceMap, mode = 'classic', occupied = [], ...options }: LessonOptions): Lesson {
  const initial = createMatchSnapshot(map, mode, 2, 0, 0);
  for (const [index, owner, energy] of occupied) initial.cells[index] = { owner, energy };
  return { ...options, map, initial };
}

export const BOOST_DEMO = lesson({
  id: 'boost', title: '强化边与溢出', targets: [0], map: boostMap,
  occupied: [[0, 0, 2], [1, 1, 2]],
  rule: '金色双线标出强化边。左上格有 3 个槽和 2 个邻居，引爆时向右送 2 点，向下送 1 点。',
  action: '引爆左上角，观察上方蓝格收到 2 点后会留下多少能量。',
  success: '上方格变红，收到能量后共有 4 点。它爆炸送出 3 点，余下 1 点留在红格里。',
});

export const SIMULTANEOUS_DEMO = lesson({
  id: 'simultaneous', title: '同一波同时爆炸', targets: [0],
  occupied: [[0, 0, 1], [1, 1, 2], [3, 1, 2]],
  rule: '上方和左侧的两格在第一波同时被填满。第二波它们一同爆炸，中央格同时收到两份能量。',
  action: '引爆左上角。',
  success: '中央格一共收到 2 点。',
});

export const LESSONS: Lesson[] = [
  lesson({
    id: 'claim', title: '先下一步', targets: [4],
    occupied: [[0, 0, 1], [2, 1, 1]],
    rule: '你是红方赤焰。每次落子加 1 点能量。你可以点自己的红格，也可以点没有能量的灰格。',
    action: '点中央带黄虚线的空格。也可以先试点右上角的蓝格。',
    success: '中央格变红，最下排第一个能量槽亮起。接下来轮到蓝方。',
  }),
  lesson({
    id: 'burst', title: '填满会爆炸', targets: [0],
    occupied: [[0, 0, 1]],
    rule: '格子底部有几小格，就能装几颗棋子。角上只有两个共边邻居，所以只有 2 个槽。',
    action: '给已有 1 点的左上角再加 1 点，看看哪两格会变红。',
    success: '左上角爆后清空。右边和下边各收到 1 点。只在角上碰到的中央格没有收到能量。',
  }),
  lesson({
    id: 'chain', title: '用连锁夺格', targets: [0],
    occupied: [[0, 0, 1], [1, 1, 2]],
    rule: '爆炸送出的能量会把邻格染成你的颜色。邻格也满了，就会接着爆炸。',
    action: '点左上角。它右边的蓝格正好还差 1 点。',
    success: '蓝格被夺下后引爆。留意能量传回刚刚清空的角格，又把它变红了。',
  }),
  lesson({
    id: 'rejoin', title: '丢光仍能继续', targets: [8],
    occupied: [[0, 1, 1], [1, 1, 1], [3, 1, 1]],
    rule: '棋盘上已经没有红格了。蓝方只占了 3 格，经典模式还没分出胜负。',
    action: '轮到你了。点右下角的空格，重新占一个红格。',
    success: '你重新入场了。只要有空中立格，失去所有格子的玩家依然有机会。',
  }),
  lesson({
    id: 'lock', title: '只能传能的格', targets: [0],
    map: specialMap, occupied: [[0, 0, 1]],
    rule: '上方是带锁的中立格，左侧是虚线标记的被动格。两者都得靠邻格爆炸来注能。',
    action: '试着点一下带锁格或被动格，再点左上角引爆。',
    success: '带锁格保留原有 1 点，现在有 2 点。左侧被动格只要 1 点就会爆炸，仍向所有邻格送能量。',
  }),
  BOOST_DEMO,
  lesson({
    id: 'surge', title: '一轮下两格', targets: [0, 4], mode: 'surge',
    rule: '双脉冲模式每回合最多下两步。每步各加 1 点，两步必须选不同格。',
    action: '先点左上角。等第一步结算完，注意仍然是你的回合。',
    followUp: '你还有一步。试着再点左上角，然后点中央完成本回合。',
    success: '两步都下完才换蓝方。在双脉冲里，第一步也可能直接获胜。',
  }),
  lesson({
    id: 'win', title: '经典怎么赢', targets: [0],
    occupied: [[0, 0, 1], [1, 1, 2], [8, 0, 1]],
    rule: '经典和双脉冲都要同时满足两件事。占领过半，并让对手一个格子也不剩。',
    action: '引爆左上角，看看赤焰能否同时满足这两个条件。',
    success: '红方占了 5 / 9 格，超过一半，棋盘上也没有蓝格了。红方获胜。',
  }),
  lesson({
    id: 'dominion', title: '疆域怎么赢', targets: [7], mode: 'dominion',
    occupied: ([0, 2, 3, 4, 6] as const).map((index): [number, number, number] => [index, 0, 1]).concat([[8, 1, 1]]),
    rule: `疆域赛看谁先占领至少 ${DOMINION_PERCENT}% 的有效格。这里有 9 格，至少占 ${dominionTarget} 格才够。`,
    action: '点下边中间的空格，给红方加一格领地。',
    success: `红方占了 ${dominionTarget} / 9 格，虽然蓝方还有领地，红方仍然获胜。`,
  }),
  lesson({
    id: 'challenge', title: '实战练习', targets: [8, 2], reply: 7,
    occupied: [[0, 0, 1], [1, 0, 1], [2, 0, 1], [5, 1, 2], [7, 1, 1]],
    rule: '在你的两次落子内赢下经典对局。蓝方会在你的第一步之后应对一次。',
    action: '先仔细看看，蓝方哪一格只差 1 点就会爆炸？想想怎样在下一回合把能量送过去。',
    followUp: '轮到你再下一步。哪一格既能爆炸，又正好挨着快满的蓝格？',
    success: '你成功用连锁占领过半，也清空了蓝方领地。下次在实战里，可以留意谁能先引爆关键格。',
  }),
];

export interface LearningFrame {
  cells: DynamicCell[];
  label: string;
  source?: number;
  bursting?: number[];
  transfers?: Transfer[];
}

function frameCells(cells: DynamicCell[]): DynamicCell[] {
  return cells.map(({ owner, energy }) => ({ owner, energy }));
}

export function learningFrames(map: GameMap, before: MatchSnapshot, turn: TurnResolved): LearningFrame[] {
  const { actor, cellIndex, next, waves } = turn;
  let cells = hydrateMatchCells(map, before);
  cells[cellIndex] = { ...cells[cellIndex], owner: actor, energy: cells[cellIndex].energy + turn.amount };
  const frames: LearningFrame[] = [{ cells: frameCells(cells), label: `${PLAYER_STYLES[actor].name}落子 · 注入 1 点`, source: cellIndex }];

  for (const [index, wave] of waves.entries()) {
    const burst = explodeWave(cells, actor);
    if (!burst) break;
    frames.push({
      cells: frameCells(burst.afterBurst), label: `第 ${index + 1} 波 · ${wave.exploding.length} 格爆炸`,
      bursting: wave.exploding, transfers: wave.transfers,
    });
    cells = burst.afterTransfer;
    frames.push({ cells: frameCells(cells), label: `第 ${index + 1} 波 · 共边格接收能量` });
  }

  const label = next.winner !== null
    ? `${PLAYER_STYLES[next.winner].name}获胜`
    : next.phase === 'draw' ? '无人还能落子 · 平局'
    : next.turnStep === 2 ? '还可在另一格落子'
    : `结算完成 · 轮到${PLAYER_STYLES[next.currentPlayer].name}`;
  frames.push({ cells: next.cells, label });
  return frames;
}

export function resolveLessonReply(example: Lesson, state: MatchSnapshot): TurnResolved | null {
  if (example.reply === undefined || state.phase !== 'playing' || state.currentPlayer === 0) return null;
  for (const index of new Set([example.reply, ...example.map.cells.map((cell) => cell.index)])) {
    const result = resolveTurn(example.map, state, state.currentPlayer, index);
    if (result.ok) return result.value;
  }
  return null;
}

export function demoFrames(example: Lesson): LearningFrame[] {
  let state = example.initial;
  const frames: LearningFrame[] = [{ cells: state.cells, label: '初始局面' }];
  for (const [step, target] of example.targets.entries()) {
    const result = resolveTurn(example.map, state, 0, target);
    if (!result.ok) break;
    frames.push(...learningFrames(example.map, state, result.value));
    state = result.value.next;
    if (step === example.targets.length - 1) continue;
    const reply = resolveLessonReply(example, state);
    if (!reply) continue;
    frames.push(...learningFrames(example.map, state, reply));
    state = reply.next;
  }
  return frames;
}
