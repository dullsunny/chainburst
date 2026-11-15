'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, GraduationCap, LockKeyhole, Play, RotateCcw, Search, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCellCoordinate, isPassiveSpecialCell, PLAYER_STYLES } from '@/lib/explosion-game';
import { DOMINION_PERCENT, getDominionTarget } from '@/lib/game-modes';
import {
  BOOST_DEMO, demoFrames, learningFrames, LESSONS, resolveLessonReply, SIMULTANEOUS_DEMO, type LearningFrame, type Lesson,
} from '@/lib/learning-scenarios';
import { MATCH_LIMITS, resolveTurn } from '@/lib/match-engine';

function usePlayback(reducedMotion: boolean, interval: number) {
  const [frames, setFrames] = useState<LearningFrame[]>([]);
  const [index, setIndex] = useState(0);
  const playing = index < frames.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (reducedMotion) {
      setIndex(frames.length - 1);
      return;
    }
    const timer = window.setTimeout(() => setIndex(index + 1), interval);
    return () => window.clearTimeout(timer);
  }, [frames, index, interval, playing, reducedMotion]);

  return {
    frame: frames[index],
    playing,
    play(next: LearningFrame[]) {
      setFrames(next);
      setIndex(reducedMotion ? Math.max(0, next.length - 1) : 0);
    },
  };
}

function MiniBoard({ example, frame, target, blocked, disabled, onCell }: {
  example: Lesson;
  frame: LearningFrame;
  target?: number;
  blocked?: number | null;
  disabled?: boolean;
  onCell?: (index: number) => void;
}) {
  const marker = useId();
  const { map } = example;
  return (
    <div className="learning-board" role={onCell ? 'group' : 'img'} aria-label={onCell ? '三乘三练习棋盘' : frame.label}>
      {frame.cells.map((cell, index) => {
        const base = map.cells[index];
        const player = cell.owner === null ? undefined : PLAYER_STYLES[cell.owner];
        const seeded = cell.owner === null && cell.energy > 0;
        const passive = isPassiveSpecialCell(base);
        const cellStyle = player ? { '--mini-color': player.color, '--mini-rgb': player.rgb } as CSSProperties : undefined;
        const classes = [
          'learning-cell', player && 'has-owner', passive && 'is-passive', target === index && 'is-target',
          blocked === index && 'is-used', frame.source === index && 'is-injected',
          frame.bursting?.includes(index) && 'is-bursting',
        ].filter(Boolean).join(' ');
        const content = (
          <>
            {(seeded || passive) && <LockKeyhole className="learning-cell-lock" aria-hidden="true" />}
            {base.boosted.length > 0 && <i className="learning-boost-edge" aria-hidden="true" />}
            <span className="learning-pips" aria-hidden="true">
              {Array.from({ length: cell.energy }, (_, pip) => <i key={pip} />)}
            </span>
            <span className="learning-slots" aria-hidden="true">
              {Array.from({ length: base.capacity }, (_, slot) => <i className={slot < cell.energy ? 'filled' : undefined} key={slot} />)}
            </span>
          </>
        );
        return onCell ? (
          <button key={index} type="button" className={classes} style={cellStyle} aria-disabled={disabled}
            aria-label={`${formatCellCoordinate(map, base)}，${player?.name ?? '中立'}，能量 ${cell.energy} / ${base.capacity}${seeded ? '，预充能锁定' : passive ? '，被动格' : ''}${blocked === index ? '，本回合已用' : ''}${target === index ? '，练习目标' : ''}`}
            onClick={() => onCell(index)}>
            {content}
          </button>
        ) : <div key={index} className={classes} style={cellStyle} aria-hidden="true">{content}</div>;
      })}
      {!!frame.transfers?.length && (
        <svg className="learning-transfers" viewBox="0 0 3 3" aria-hidden="true">
          <defs><marker id={marker} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0 0L6 3 0 6Z" fill="currentColor" />
          </marker></defs>
          {frame.transfers.map(({ source, target: destination, amount }) => {
            const from = map.cells[source];
            const to = map.cells[destination];
            const dx = to.col - from.col;
            const dy = to.row - from.row;
            return <line key={`${source}-${destination}`}
              x1={from.col + .5 + dx * .2} y1={from.row + .5 + dy * .2}
              x2={to.col + .5 - dx * .2} y2={to.row + .5 - dy * .2}
              strokeWidth={amount > 1 ? .082 : .043} markerEnd={`url(#${marker})`} />;
          })}
        </svg>
      )}
    </div>
  );
}

function RuleDemo({ example, reducedMotion }: { example: Lesson; reducedMotion: boolean }) {
  const frames = useMemo(() => demoFrames(example), [example]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = frames[index];
  const end = frames.length - 1;
  const autoplay = playing && !reducedMotion;

  useEffect(() => {
    if (!autoplay || index >= end) return;
    const timer = window.setTimeout(() => setIndex(index + 1), 580);
    return () => window.clearTimeout(timer);
  }, [autoplay, end, index]);

  const stepTo = (next: number) => {
    setPlaying(false);
    setIndex(next);
  };

  return (
    <article className="rule-demo">
      <div className="rule-demo-heading">
        <h4>{example.title}</h4>
        {!reducedMotion && <button className="learning-replay" type="button" aria-label={`播放${example.title}示例`}
          onClick={() => { setIndex(0); setPlaying(true); }}>
          <Play aria-hidden="true" />
        </button>}
      </div>
      <div className="rule-scene">
        <MiniBoard example={example} frame={frame} />
        <div className="learning-demo-controls">
          <button type="button" className="learning-replay" aria-label={`${example.title}上一帧`} disabled={!index} onClick={() => stepTo(index - 1)}><ChevronLeft /></button>
          <small aria-live={autoplay && index < end ? 'off' : 'polite'}>{frame.label} <span>{index + 1} / {frames.length}</span></small>
          <button type="button" className="learning-replay" aria-label={`${example.title}下一帧`} disabled={index === end} onClick={() => stepTo(index + 1)}><ChevronRight /></button>
        </div>
      </div>
      <p>{example.rule}</p>
    </article>
  );
}

interface RuleSection {
  id: string;
  title: string;
  examples?: Lesson[];
  notes: { title: string; description: string; aliases?: string }[];
}

const lessonById = Object.fromEntries(LESSONS.map((lesson) => [lesson.id, lesson]));
const RULE_SECTIONS: RuleSection[] = [
  {
    id: 'turn', title: '开局与合法落点', examples: [lessonById.claim, lessonById.rejoin],
    notes: [
      { title: '人数与先手', description: '对局支持 2～6 人。选择地图和模式后，随机选定先手，随后按席位顺序轮流行动。所有格子开局均为中立。某些地图的格子自带少量能量。', aliases: '玩家 本地 联机' },
      { title: '哪里可以落子', description: '每次落子加 1 点能量。你只能选择自己的格子，或能量为零的中立格。落在空中立格后，该格立即归你。敌方格、被动格、带能量的中立格和空洞均不可主动落子。', aliases: '点击 注能 锁' },
      { title: '失去领地与跳过回合', description: '只要尚未分出胜负，失去全部领地的玩家仍可从空中立格重新入场。结算后按席位顺序寻找能落子的下一位，找遍一轮时也会检查刚落子的玩家。所有玩家都无合法落点才判平。', aliases: '淘汰 复活 平局' },
    ],
  },
  {
    id: 'burst', title: '邻接、爆炸与连锁', examples: [lessonById.burst, lessonById.chain, SIMULTANEOUS_DEMO],
    notes: [
      { title: '共边与容量', description: '实格共享一条边才相邻，空洞和只在角上接触的格子都不传能。普通格的容量等于有效邻格数，三角格、方格、六边格分别最多有 3、4、6 个邻格。边缘和洞旁通常更容易填满。', aliases: '密铺 斜角 斜对角 能量槽 槽位' },
      { title: '爆炸与夺格', description: '格内能量达到容量即满足爆炸条件。普通格每次爆炸沿每条共边送 1 点。接收格无论原属谁，都会转归发动本次落子的玩家，收到的能量叠加在格内。' },
      { title: '同一波同时结算', description: '先确定本波所有满格，它们各爆炸一次。所有爆炸源先扣能，再向接收格同时送能。能量可传回本波刚清空的爆炸源，也可从多个邻居同时流入一格。下一波才处理收能后达到容量的格子。', aliases: '动画 连锁 顺序 时间' },
      { title: '超出容量', description: '每次爆炸只扣掉一个容量，清零才变成中立。有 4 个槽的格子收到能量后若共有 9 点，第一波爆掉 4 点，仍留 5 点且保留颜色。接收这一波能量后若仍满，下一波再爆一次。', aliases: '溢出 超过 剩余' },
    ],
  },
  {
    id: 'special', title: '特殊格与强化边', examples: [lessonById.lock, BOOST_DEMO],
    notes: [
      { title: '预充能格', description: '带锁的中立格自带能量，不能主动落子。只有相邻爆炸才能夺取它，原有能量会与传来的能量相加。夺取后，若它并非被动格，便可按己方格的规则注能。', aliases: '带锁 中立 锁定' },
      { title: '被动格', description: '槽位少于邻格的手动容量格以虚线标出。即使已被占领，它也只能通过爆炸接收能量。爆炸时每条共边仍送 1 点，所以一次送出的总量可能超过本格扣除的能量。', aliases: '锁 虚线 金边 低容量' },
      { title: '强化格与强化边', description: '槽位多于邻格的格可正常落子。爆炸时先把容量除以邻格数，向每个邻格送出相同的整份能量。有余数时，金色双线标出的每条边再多送 1 点。6 槽、4 邻格且上、下是强化边时，上下各收 2 点，左右各收 1 点。6 槽、3 邻格时，每边均收 2 点。', aliases: '闪电 加强边 分流 高容量' },
    ],
  },
  {
    id: 'modes', title: '模式与胜负', examples: [lessonById.win, lessonById.surge, lessonById.dominion],
    notes: [
      { title: '经典模式', description: '每回合落一次。连锁平息后，只有一位玩家仍拥有格子，且该玩家占领超过半数有效格时，才会判胜。恰好一半不够。', aliases: '胜利 经典 过半 百分比' },
      { title: '双脉冲', description: '每回合最多两步，每步加 1 点并单独结算。第二步不可重复点第一步的格，即使它已爆成空格。它仍可从爆炸收能。第一步已经获胜或没有其他合法格时，回合提前结束。获胜条件与经典模式相同。', aliases: '快速 对局 两步 二次' },
      { title: '疆域赛', description: `每回合落一次。连锁平息后，占领至少 ${DOMINION_PERCENT}% 有效格即可获胜，其他玩家可以仍有领地。按整格向上取整，6×6 无洞地图至少需要 ${getDominionTarget(36)} 格。空洞不计入有效格总数。`, aliases: '占领 百分比 比例' },
      { title: '能量奇点与平局', description: `连锁达到无法稳定的状态时，由触发该手的玩家取胜，优先于普通模式的胜负条件。局面重复、总能量超过所有格子的最大稳定容量总和，或需要结算的连锁超出 ${MATCH_LIMITS.maxWaves} 波或 ${MATCH_LIMITS.maxTransfers.toLocaleString('zh-CN')} 次传递，都会判奇点。若已稳定、没人满足胜利条件且所有人都无合法落点，则判平局。`, aliases: '无限连锁 循环 上限' },
    ],
  },
  {
    id: 'controls', title: '棋盘操作', notes: [
      { title: '落子预览', description: '鼠标移到合法格上可预览整步结算后的局面，点击才落子。触屏接触合法格后，用棋盘下方的确认按钮落子，也可取消。预览可在本地设置关闭，联机由房主在房间设置中控制。', aliases: '电脑 手机 触屏 悬停' },
      { title: '缩放与查看格子', description: '用加号和减号缩放棋盘，用适应全图按钮复原。点手掌可以拖动画布，再点一次恢复落子。点信息按钮进入查看模式，可以查看格子的槽位和传能方向。', aliases: '放大 棋子 小格' },
      { title: '棋子、槽位与上一步', description: '有颜色的棋子表示该方的能量，分段槽位显示填充程度。棋子显示可在设置切换。上一步落点有玩家色的扩散提示，提示的是主动落子的源格。', aliases: '标记 棋子数量 几何堆叠 数字' },
    ],
  },
  {
    id: 'play', title: '本地与联机', notes: [
      { title: '本地对局', description: '在地图大厅选择地图、模式和人数。对手可由朋友在同一设备上轮流操作，也可给席位分配难度不同的人机。', aliases: '开始 AI 电脑' },
      { title: '创建或加入联机房间', description: '房主在地图大厅选定初始配置后创建房间，再把邀请码或邀请链接发给朋友。所有席位坐满且玩家就绪后，由房主开始。房主可在房间修改地图、人数、落子预览设置，应用后需要重新准备。', aliases: '多人 好友 房间码 地图 房主' },
      { title: '结束或中途退出', description: '对局结束后可选返回房间，或释放席位返回地图。对局中可提议返回房间，表决时暂停。所有玩家同意才会返回，有人拒绝或超时则继续。', aliases: '投票 逃跑 离开 再战' },
      { title: '自制地图', description: '地图大厅有 4 个自制地图槽位，可保存、编辑或删除已有地图。地图工坊可设置地图尺寸和密铺类型，选择格子配置空洞、预充能、容量和强化边。房主可以选择已保存的自制地图。', aliases: '编辑器 导入 导出 复原 重置' },
    ],
  },
];

function RuleBook({ reducedMotion, onTutorial }: { reducedMotion: boolean; onTutorial: () => void }) {
  const [sectionId, setSectionId] = useState(RULE_SECTIONS[0].id);
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length ? RULE_SECTIONS.flatMap((section) =>
    section.notes.filter(({ title, description, aliases }) => terms.every((term) =>
      `${section.title} ${title} ${description} ${aliases ?? ''}`.toLowerCase().includes(term)))
      .map((entry) => ({ ...entry, sectionId: section.id, sectionTitle: section.title })),
  ) : [];
  const section = RULE_SECTIONS.find(({ id }) => id === sectionId) ?? RULE_SECTIONS[0];

  return (
    <>
      <DialogHeader className="learning-heading">
        <DialogTitle>爆炸棋规则书</DialogTitle>
        <DialogDescription>按主题查阅规则，也可以搜索「强化边」「溢出」或「双脉冲」。</DialogDescription>
      </DialogHeader>
      <label className="learning-search">
        <Search aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索规则" aria-label="搜索规则" />
        {!!query && <button className="learning-replay" type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X /></button>}
      </label>
      {terms.length > 0 ? (
        <section className="learning-reference" aria-label="搜索规则结果">
          <h3 role="status">{matches.length ? `找到 ${matches.length} 条规则` : '没有找到相关规则'}</h3>
          {!!matches.length && <dl className="learning-notes">
            {matches.map(({ title, description, sectionId, sectionTitle }) => (
              <div key={title}>
                <dt>{title}</dt><dd>{description}</dd>
                <dd><button type="button" className="learning-section-link" onClick={() => { setSectionId(sectionId); setQuery(''); }}>{sectionTitle}<ChevronRight /></button></dd>
              </div>
            ))}
          </dl>}
        </section>
      ) : (
        <div className="learning-rule-layout">
          <nav className="learning-rule-index" aria-label="规则目录">
            {RULE_SECTIONS.map(({ id, title }) => <button key={id} type="button" aria-current={id === sectionId ? 'true' : undefined} onClick={() => setSectionId(id)}>{title}</button>)}
          </nav>
          <section className="learning-reference">
            <h3>{section.title}</h3>
            <dl className="learning-notes">
              {section.notes.map(({ title, description }) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}
            </dl>
            {!!section.examples?.length && <div className="rule-demo-grid" key={section.id}>
              {section.examples.map((example) => <RuleDemo example={example} key={example.id} reducedMotion={reducedMotion} />)}
            </div>}
          </section>
        </div>
      )}
      <div className="learning-rule-footer"><Button onClick={onTutorial}><GraduationCap />开始互动教程</Button></div>
    </>
  );
}

function Practice({ example, reducedMotion, onSolved, onRetry }: {
  example: Lesson;
  reducedMotion: boolean;
  onSolved: () => void;
  onRetry: () => void;
}) {
  const [snapshot, setSnapshot] = useState(example.initial);
  const [step, setStep] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [showHint, setShowHint] = useState(false);
  const playback = usePlayback(reducedMotion, 370);
  const challenge = example.reply !== undefined;
  const solved = challenge ? snapshot.winner === 0 : step === example.targets.length;
  const done = solved && !playback.playing;
  const exhausted = challenge && !solved && (step >= example.targets.length || snapshot.phase !== 'playing');
  const frame = playback.frame ?? { cells: snapshot.cells, label: '轮到赤焰' };
  const active = !playback.playing && !solved && !exhausted;
  const highlight = active && (!challenge || (showHint && (step === 0 || snapshot.cells[example.targets[step]].owner === 0)));

  useEffect(() => { if (done) onSolved(); }, [done, onSolved]);

  const place = (index: number) => {
    if (!active) return;
    const result = resolveTurn(example.map, snapshot, 0, index);
    if (!result.ok) {
      if (result.error === 'CELL_ALREADY_USED') setFeedback('这是本回合第一步的格。现在要换一个格子。');
      else if (isPassiveSpecialCell(example.map.cells[index])) setFeedback('虚线被动格只能由邻格爆炸注能，不能直接点。');
      else if (snapshot.cells[index].owner === 1) setFeedback('蓝格是对手的领地，要靠爆炸夺取。');
      else setFeedback('带锁的灰格已有能量。让它旁边的格子爆炸，就能夺取它。');
      return;
    }
    if (!challenge && index !== example.targets[step]) {
      setFeedback('这一手可以下。先完成当前练习，试试带黄虚线的格。');
      return;
    }

    let next = result.value.next;
    const frames = learningFrames(example.map, snapshot, result.value);
    if (step < example.targets.length - 1) {
      const reply = resolveLessonReply(example, next);
      if (reply) {
        frames.push(...learningFrames(example.map, next, reply));
        next = reply.next;
      }
    }
    playback.play(frames);
    setSnapshot(next);
    setStep(step + 1);
    setFeedback('');
    setShowHint(false);
  };

  return (
    <div className="learning-practice">
      <div className="learning-practice-copy">
        <h3>{example.title}</h3>
        <p>{example.rule}</p>
        {!done && !(exhausted && !playback.playing) && <div className="learning-instruction"><Zap aria-hidden="true" />
          <span>{step > 0 && !playback.playing ? example.followUp ?? example.action : example.action}</span>
        </div>}
        {challenge && active && <button type="button" className="learning-section-link" onClick={() => setShowHint(!showHint)} aria-expanded={showHint}>{showHint ? '收起提示' : '给我一点提示'}</button>}
        {challenge && active && showHint && <p className="learning-hint">{step === 0
          ? '先在右下角占一个红格，为下一波接力做准备。'
          : '右上的红格只差 1 点，正好贴着右边的蓝格。如果蓝方已经占了上方红格，可以重练试试从右下角开始。'}</p>}
      </div>
      <div className="learning-practice-board">
        <MiniBoard example={example} frame={frame} target={highlight ? example.targets[step] : undefined}
          blocked={snapshot.firstMoveIndex} disabled={!active} onCell={place} />
        <small>{frame.label}</small>
      </div>
      <div className={`learning-feedback${done ? ' is-done' : ''}`} role="status">
        {done ? <><Check aria-hidden="true" />{example.success}</> : feedback || (playback.playing ? '观察能量传到哪里。' : exhausted
          ? <><span>{snapshot.winner === 1 ? '蓝方先赢了。' : '这次两步之内还没赢。'}重练时，试试先占右下角。</span><button type="button" className="learning-section-link" onClick={onRetry}>再试一次</button></>
          : '轮到你。你是红方赤焰。')}
      </div>
    </div>
  );
}

const PROGRESS_KEY = 'chainburst-tutorial-v2';

export function LearningCenter({ view, onViewChange, reducedMotion }: {
  view: 'rules' | 'tutorial' | null;
  onViewChange: (view: 'rules' | 'tutorial' | null) => void;
  reducedMotion: boolean;
}) {
  const [chapter, setChapter] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const lastView = useRef<'rules' | 'tutorial'>('rules');
  const example = LESSONS[chapter];
  const lessMotion = reducedMotion || systemReducedMotion;
  const solved = completed.includes(example.id);
  const displayedView = view ?? lastView.current;

  useEffect(() => { if (view) lastView.current = view; }, [view]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '[]');
      if (!Array.isArray(stored)) return;
      const known = LESSONS.filter(({ id }) => stored.includes(id)).map(({ id }) => id);
      setCompleted(known);
      const resume = LESSONS.findIndex(({ id }) => !known.includes(id));
      if (resume > 0) setChapter(resume);
    } catch { /* Optional tutorial progress. */ }
  }, []);

  const selectChapter = (index: number) => {
    setChapter(index);
    setAttempt((previous) => previous + 1);
  };

  const completeChapter = useCallback(() => {
    if (solved) return;
    const next = [...completed, example.id];
    setCompleted(next);
    try { window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next)); } catch { /* Optional tutorial progress. */ }
  }, [completed, example.id, solved]);

  return (
    <Dialog open={view !== null} onOpenChange={(open) => { if (!open) onViewChange(null); }}>
      <DialogContent className={`learning-dialog${lessMotion ? ' reduce-motion' : ''}`}>
        {displayedView === 'rules' ? <RuleBook reducedMotion={lessMotion} onTutorial={() => onViewChange('tutorial')} /> : (
          <>
            <DialogHeader className="learning-heading">
              <DialogTitle>爆炸棋教程</DialogTitle>
              <DialogDescription>从点亮第一个格子开始，最后亲手赢下一局。</DialogDescription>
            </DialogHeader>
            <div className="learning-tutorial-layout">
              <nav className="learning-chapters" aria-label="教程章节">
                <div className="learning-progress">
                  <span>已完成章节</span><strong>{completed.length} / {LESSONS.length}</strong>
                  <progress aria-label="已完成章节" value={completed.length} max={LESSONS.length} />
                </div>
                {LESSONS.map((entry, index) => (
                  <button type="button" key={entry.id} aria-current={chapter === index ? 'step' : undefined}
                    onClick={() => selectChapter(index)}>
                    <span>{completed.includes(entry.id) ? <Check aria-label="已完成" /> : index + 1}</span>{entry.title}
                  </button>
                ))}
              </nav>
              <div className="learning-practice-pane">
                <Practice key={`${chapter}:${attempt}`} example={example} reducedMotion={lessMotion} onSolved={completeChapter} onRetry={() => selectChapter(chapter)} />
                <div className="learning-tutorial-footer">
                  <Button variant="ghost" size="sm" onClick={() => selectChapter(chapter)}><RotateCcw />重练</Button>
                  <div>
                    <Button variant="outline" size="sm" disabled={chapter === 0} onClick={() => selectChapter(chapter - 1)}><ArrowLeft />上一章</Button>
                    {chapter < LESSONS.length - 1 ? (
                      <Button size="sm" disabled={!solved} onClick={() => selectChapter(chapter + 1)}>下一章<ArrowRight /></Button>
                    ) : completed.length === LESSONS.length ? (
                      <Button size="sm" onClick={() => onViewChange(null)}><Check />完成教程</Button>
                    ) : (
                      <Button size="sm" disabled={!solved} onClick={() => selectChapter(LESSONS.findIndex(({ id }) => !completed.includes(id)))}>
                        继续练习<ArrowRight />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
