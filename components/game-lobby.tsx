'use client';

import { type CSSProperties } from 'react';
import { ArrowRight, Bot, Grid3X3, Pencil, PencilRuler, Plus, Radio, Sparkles, Trash2, Users } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BOARD_TOPOLOGY_NAMES, GameMap, PLAYER_STYLES, cellLayoutStyle, isMixedTiling, validateMap } from '@/lib/explosion-game';
import { GAME_MODES, GameModeId } from '@/lib/game-modes';
import { AI_LEVELS, type PlayerController } from '@/lib/game-ai';

interface GameLobbyProps {
  maps: GameMap[];
  customMaps: Array<GameMap | null>;
  selectedMapId: string;
  playerCount: number;
  mode: GameModeId;
  controllers: PlayerController[];
  onControllers: (controllers: PlayerController[]) => void;
  onSelectMap: (id: string) => void;
  onPlayerCount: (count: number) => void;
  onMode: (mode: GameModeId) => void;
  onStart: () => void;
  onOnline?: () => void;
  onEditor: () => void;
  onCreateCustom: (slotIndex: number) => void;
  onEditCustom: (slotIndex: number) => void;
  onDeleteCustom: (slotIndex: number) => void;
}

function MapPreview({ map }: { map: GameMap }) {
  const ratio = map.geometry.width / map.geometry.height;
  const width = ratio >= 92 / 90 ? 92 : 90 * ratio;
  const height = width / ratio;
  const mixedTiling = isMixedTiling(map.topology);
  return (
    <div
      className="map-preview-grid"
      data-topology={map.topology}
      style={{ width, height, '--map-accent': map.accent } as CSSProperties}
      aria-hidden="true"
    >
      {map.cells.map((cell) => (
        <i
          key={cell.id}
          style={cellLayoutStyle(map, cell, mixedTiling ? .11 : 0)}
          className={`${cell.active ? 'preview-cell' : 'preview-hole'} shape-${cell.shape} ${(cell.row + cell.col) % 2 === 0 ? 'shape-even' : 'shape-odd'} ${!cell.autoCapacity ? 'preview-special' : ''} ${cell.initialEnergy ? 'preview-seeded' : ''}`}
        />
      ))}
    </div>
  );
}

export function GameLobby({
  maps,
  customMaps,
  selectedMapId,
  playerCount,
  mode,
  controllers,
  onControllers,
  onSelectMap,
  onPlayerCount,
  onMode,
  onStart,
  onOnline,
  onEditor,
  onCreateCustom,
  onEditCustom,
  onDeleteCustom,
}: GameLobbyProps) {
  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? maps[0];
  const mapWarnings = validateMap(selectedMap, playerCount);
  const canStart = mapWarnings.length === 0;
  const botCount = controllers.slice(0, playerCount).filter((controller) => controller !== 'human').length;

  return (
    <section className="lobby-page">
      <div className="lobby-intro">
        <div>
          <span className="lobby-kicker"><Sparkles /> {onOnline ? '同屏 · 人机 · 线上联机 · 2–6 人' : '单机版 · 同屏 · 人机 · 2–6 人'}</span>
          <h1>选择战场，点燃第一格。</h1>
          <p>所有能量都会留下伏笔。占领边角、制造临界点，再用一次连锁改写整张棋盘。</p>
        </div>
        <div className="lobby-intro-actions">
          {onOnline && <Button size="lg" onClick={onOnline}><Radio />线上联机</Button>}
          <Button variant="outline" size="lg" onClick={onEditor}><PencilRuler />地图工坊</Button>
        </div>
      </div>

      <div className="setup-strip">
        <div className="setup-field">
          <span className="setup-icon"><Users /></span>
          <div><small>参战人数</small><strong>{playerCount} 位玩家</strong></div>
          <Select value={String(playerCount)} onValueChange={(value) => onPlayerCount(Number(value))}>
            <SelectTrigger aria-label="选择玩家人数"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2, 3, 4, 5, 6].map((count) => <SelectItem value={String(count)} key={count}>{count} 人</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="setup-separator" />
        <div className="setup-field setup-summary">
          <span className="setup-icon"><Grid3X3 /></span>
          <div><small>当前地图</small><strong>{selectedMap.name}</strong></div>
        </div>
        <div className="setup-separator" />
        <div className="setup-field setup-summary">
          <span className="setup-icon"><Bot /></span>
          <div><small>先手规则</small><strong>开局随机</strong></div>
        </div>
      </div>

      <section className="opponent-setup" aria-label="本地对手设置">
        <div className="opponent-setup-heading">
          <div><span className="section-label"><Bot />对手设置</span><h2>{botCount ? `和 ${botCount} 位人机交锋` : '朋友同屏，轮流落子'}</h2></div>
          <div className="opponent-presets">
            <Button variant={botCount === 0 ? 'secondary' : 'ghost'} onClick={() => onControllers(Array(6).fill('human'))}><Users />本地同屏</Button>
            <Button variant={botCount > 0 ? 'secondary' : 'ghost'} onClick={() => onControllers(['human', 'normal', 'normal', 'normal', 'normal', 'normal'])}><Bot />人机对战</Button>
          </div>
        </div>
        <div className="opponent-seat-grid">
          {PLAYER_STYLES.slice(0, playerCount).map((player, index) => (
            <div className="opponent-seat" key={player.name}>
              <span className="mini-token" style={{ background: player.color }}>{player.symbol}</span>
              <span>{player.name}</span>
              <Select value={controllers[index] ?? 'human'} onValueChange={(value) => {
                if (!value) return;
                const next = [...controllers]; next[index] = value as PlayerController; onControllers(next);
              }}>
                <SelectTrigger aria-label={`${player.name}席位类型与人机难度`}><SelectValue>{controllers[index] === 'human' ? '真人玩家' : `${AI_LEVELS.find((level) => level.id === controllers[index])?.name ?? '标准'}人机`}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="human">真人玩家</SelectItem>
                  {AI_LEVELS.map((level) => <SelectItem value={level.id} key={level.id}><span title={level.description}>{level.name}人机</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <p>入门快速探索；标准短线攻防（约 0.12 秒内）；困难深入推演（约 0.7 秒内）；大师搜索更深的胜机（约 2.2 秒内）。以上为每步思考预算，复杂地图与设备速度会影响实际用时。先手随机，所有人机遵循相同规则。</p>
        {onOnline && <small>这里的对手设置用于本地对局；线上联机仍与朋友一起游玩。</small>}
      </section>

      <div className="lobby-section-heading">
        <div><span>01</span><div><h2>地图</h2><p>不同几何结构会改变能量的临界值与扩散路线</p></div></div>
        <small>{maps.length} 张可用地图</small>
      </div>

      <div className="map-selection-groups">
      <div className="map-card-grid">
        {maps.filter((map) => map.kind !== 'custom').map((map) => {
          const selected = map.id === selectedMap.id;
          const activeCount = map.cells.filter((cell) => cell.active).length;
          return (
            <label
              className={`map-card ${selected ? 'is-selected' : ''}`}
              key={map.id}
              style={{ '--map-accent': map.accent } as CSSProperties}
            >
              <input className="map-radio-input" type="radio" name="map-selection" value={map.id} checked={selected} onChange={() => onSelectMap(map.id)} />
              <div className="map-preview"><MapPreview map={map} /><span>{map.kind === 'classic' ? '经典' : map.kind === 'shape' ? '几何' : map.kind === 'mixed' ? '混合' : map.kind === 'custom' ? '自制' : '扩展'}</span></div>
              <div className="map-card-copy">
                <small>{map.subtitle}</small>
                <strong>{map.name}</strong>
                <p>{map.description}</p>
                <div><span>{activeCount} 格</span><span>{map.recommended}</span><span>{map.difficulty}</span></div>
              </div>
              <i className="map-selected-dot" />
            </label>
          );
        })}
      </div>

      <div className="custom-maps-heading">
        <div><span>自制地图</span><small>{onOnline ? '每个槽位都可独立创建、编辑与用于联机房间' : '每个槽位都可独立创建、编辑和导出'}</small></div>
        <strong>{customMaps.filter(Boolean).length} / {customMaps.length}</strong>
      </div>
      <div className="custom-map-slot-grid" aria-label="自制地图槽位">
        {customMaps.map((map, slotIndex) => {
          if (!map) {
            return (
              <button type="button" className="custom-map-empty" key={`empty-${slotIndex}`} onClick={() => onCreateCustom(slotIndex)}>
                <span><Plus /></span>
                <strong>新建自制地图</strong>
                <small>槽位 {slotIndex + 1}</small>
              </button>
            );
          }
          const selected = map.id === selectedMap.id;
          const activeCount = map.cells.filter((cell) => cell.active).length;
          return (
            <article className={`map-card custom-map-card ${selected ? 'is-selected' : ''}`} key={map.id} style={{ '--map-accent': map.accent } as CSSProperties}>
              <label className="custom-map-select">
                <input className="map-radio-input" type="radio" name="map-selection" value={map.id} checked={selected} onChange={() => onSelectMap(map.id)} />
                <div className="map-preview"><MapPreview map={map} /><span>自制 {slotIndex + 1}</span></div>
                <div className="map-card-copy">
                  <small>{map.subtitle}</small>
                  <strong>{map.name}</strong>
                  <p>{map.description}</p>
                  <div><span>{activeCount} 格</span><span>{BOARD_TOPOLOGY_NAMES[map.topology]}</span><span>{map.rows} × {map.cols}</span></div>
                </div>
                <i className="map-selected-dot" />
              </label>
              <div className="custom-map-actions">
                <Button variant="ghost" size="sm" onClick={() => onEditCustom(slotIndex)}><Pencil />编辑</Button>
                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="ghost" size="sm"><Trash2 />删除</Button>} />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>删除“{map.name}”？</AlertDialogTitle>
                      <AlertDialogDescription>此操作会清空自制槽位 {slotIndex + 1}。{onOnline && '已创建的线上房间会保留自己的地图副本，不受影响。'}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => onDeleteCustom(slotIndex)}><Trash2 />删除地图</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </article>
          );
        })}
      </div>
      </div>

      <div className="lobby-section-heading mode-heading">
        <div><span>02</span><div><h2>模式</h2><p>胜利条件与每回合能量由模式决定</p></div></div>
      </div>

      <RadioGroup className="mode-grid" value={mode} onValueChange={(value) => onMode(value as GameModeId)} aria-label="选择游戏模式">
        {GAME_MODES.map((item) => (
          <label className={`mode-card ${mode === item.id ? 'is-selected' : ''}`} key={item.id}>
            <RadioGroupItem value={item.id} />
            <span><small>{item.label}</small><strong>{item.name}</strong><p>{item.description}</p></span>
          </label>
        ))}
      </RadioGroup>

      <div className="start-dock">
        <div><small>{canStart ? '准备就绪' : '地图需要调整'}</small><strong>{canStart ? `${selectedMap.name} · ${playerCount - botCount} 真人 / ${botCount} 人机 · ${GAME_MODES.find((item) => item.id === mode)?.name}` : mapWarnings[0]}</strong></div>
        <Button size="lg" onClick={onStart} disabled={!canStart}>开始对局 <ArrowRight /></Button>
      </div>
    </section>
  );
}
