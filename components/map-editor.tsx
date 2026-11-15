'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, CircleDot, Download, Eraser, Play, Redo2, RefreshCcw, RotateCcw, Save, Undo2, Upload, Zap } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { GameBoard } from '@/components/game-board';
import { BOARD_TOPOLOGY_NAMES, type CellShape, type GameMap, createEditorMap, directionForNeighbor, edgeLabel, formatCellCoordinate, getTransferPlan, isBoardTopology, isMixedTiling, isPassiveSpecialCell, renameCustomMap, resetEditorCellToDefault, resetEditorMapToDefault, resizeEditorMap, retileEditorMap, updateEditorCell, validateMap } from '@/lib/explosion-game';

type PaintTool = 'select' | 'hole' | 'seed' | 'reset';
type SliderField = 'capacity' | 'initialEnergy';

interface EditorRevision {
  map: GameMap;
  selectedIndex: number;
}

interface MapEditorProps {
  map: GameMap;
  slotNumber: number;
  onMapChange: (map: GameMap) => void;
  onSave: (map: GameMap) => void;
  onPlay: (map: GameMap) => void;
  onBack: () => void;
  playerCount: number;
  modeName: string;
}

const tools: { id: PaintTool; label: string; icon: typeof CircleDot; hint: string }[] = [
  { id: 'select', label: '选择', icon: CircleDot, hint: '选择格子查看属性，使用检查器细调。' },
  { id: 'seed', label: '预充能', icon: Zap, hint: '点击格子可一键预充 1 点。' },
  { id: 'hole', label: '挖空', icon: Eraser, hint: '点击格子将其挖空，并重算相邻格的自动槽位。' },
  { id: 'reset', label: '恢复画笔', icon: RotateCcw, hint: '点击格子恢复默认槽位，清除预充能和强化边，也可填回空洞。' },
];

const legacyDirectionOrder = ['U', 'R', 'D', 'L', 'UL', 'UR', 'DL', 'DR'];
const editorDimensions = Array.from({ length: 15 }, (_, index) => index + 6);
const shapeNames: Record<CellShape, string> = { square: '正方形', triangle: '等边三角形', hex: '正六边形' };
const historyLimit = 16;

function isDefaultCell(cell: GameMap['cells'][number]) {
  return cell.active && cell.autoCapacity && cell.initialEnergy === 0 && cell.boostDirections.length === 0;
}

function describeCell(cell: GameMap['cells'][number]) {
  if (!cell.active) return '空洞';
  if (isPassiveSpecialCell(cell)) return '被动格';
  if (cell.capacity > cell.neighbors.length && !cell.autoCapacity) return '强化格';
  if (cell.initialEnergy > 0) return '预充能中立格';
  return cell.autoCapacity ? '普通格' : '自定义槽位';
}

export function MapEditor({ map, slotNumber, onMapChange, onSave, onPlay, onBack, playerCount, modeName }: MapEditorProps) {
  const [tool, setTool] = useState<PaintTool>('select');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(map.name);
  const [history, setHistory] = useState<{ past: EditorRevision[]; future: EditorRevision[] }>({ past: [], future: [] });
  const [sliderEdit, setSliderEdit] = useState<{ field: SliderField; value: number }>();
  const [hoveredEdge, setHoveredEdge] = useState<string>();
  const [focusedEdge, setFocusedEdge] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const editRevision = useRef(0);
  useEffect(() => () => { editRevision.current += 1; }, []);
  const selected = map.cells[selectedIndex];
  const isMixed = isMixedTiling(map.topology);
  const warnings = useMemo(() => validateMap(map, playerCount), [map, playerCount]);
  const { activeCount, modifiedCount, seededCount } = useMemo(() => ({
    activeCount: map.cells.filter((cell) => cell.active).length,
    modifiedCount: map.cells.filter((cell) => !isDefaultCell(cell)).length,
    seededCount: map.cells.filter((cell) => cell.initialEnergy > 0).length,
  }), [map.cells]);
  const selectedIsDefault = !selected || isDefaultCell(selected);
  const degree = selected?.neighbors.length ?? 0;
  const boostQuota = selected?.active && !selected.autoCapacity && degree > 0 && selected.capacity > degree
    ? selected.capacity % degree
    : 0;
  const transferPlan = selected && boostQuota > 0 ? getTransferPlan(selected) : [];
  const edgeOptions = new Map<string, GameMap['cells'][number]>();
  if (selected && boostQuota > 0) {
    for (const index of selected.neighbors) {
      const neighbor = map.cells[index];
      const direction = directionForNeighbor(selected, neighbor);
      if (!edgeOptions.has(direction)) edgeOptions.set(direction, neighbor);
    }
  }
  const edgeOrder = isMixed ? [...edgeOptions.keys()].sort() : legacyDirectionOrder.filter((direction) => edgeOptions.has(direction));
  const inspectedEdge = hoveredEdge ?? focusedEdge;
  const highlightedEdge = inspectedEdge && edgeOptions.has(inspectedEdge) ? inspectedEdge : undefined;

  const selectCell = (index: number) => {
    setSelectedIndex(index);
    setSliderEdit(undefined);
    setHoveredEdge(undefined);
    setFocusedEdge(undefined);
  };

  const applyEdit = (nextMap: GameMap, nextIndex = selectedIndex) => {
    editRevision.current += 1;
    setHistory(({ past }) => ({ past: [...past, { map, selectedIndex }].slice(-historyLimit), future: [] }));
    onMapChange(nextMap);
    if (nextIndex !== selectedIndex) selectCell(nextIndex);
    setNotice('');
  };

  const navigateHistory = (undo: boolean) => {
    const next = (undo ? history.past : history.future).at(-1);
    if (!next) return;
    const current = { map, selectedIndex };
    editRevision.current += 1;
    setHistory(({ past, future }) => undo
      ? { past: past.slice(0, -1), future: [...future, current] }
      : { past: [...past, current], future: future.slice(0, -1) });
    onMapChange(next.map);
    selectCell(next.selectedIndex);
    setNameDraft(next.map.name);
    setNotice(undo ? '已撤销上一次修改' : '已重做上一次修改');
  };

  const commitName = () => {
    const namedMap = renameCustomMap(map, nameDraft);
    setNameDraft(namedMap.name);
    if (namedMap.name !== map.name) applyEdit(namedMap);
    return namedMap;
  };

  const paint = (index: number) => {
    const cell = map.cells[index];
    selectCell(index);
    if (tool === 'select') return;
    if (tool === 'reset') {
      if (!isDefaultCell(cell)) applyEdit(resetEditorCellToDefault(map, index), index);
      return;
    }
    if (!cell.active) return;
    if (tool === 'hole') {
      applyEdit(updateEditorCell(map, index, { active: false, initialEnergy: 0 }), index);
      return;
    }
    if (cell.capacity <= 1) {
      setNotice('只有 1 个槽位的格子无法预充能。');
      return;
    }
    if (cell.initialEnergy === 0) applyEdit(updateEditorCell(map, index, { initialEnergy: 1 }), index);
  };

  const updateSelected = (patch: Parameters<typeof updateEditorCell>[2]) => {
    if (selected) applyEdit(updateEditorCell(map, selectedIndex, patch));
  };

  const commitSlider = (field: SliderField, value: number | readonly number[]) => {
    const amount = Number(Array.isArray(value) ? value[0] : value);
    setSliderEdit(undefined);
    if (selected && selected[field] !== amount) updateSelected({ [field]: amount });
  };

  const resetSelected = () => {
    if (selectedIsDefault) return;
    applyEdit(resetEditorCellToDefault(map, selectedIndex));
    selectCell(selectedIndex);
    setNotice('当前格已恢复，已重算相邻格的自动槽位。');
  };

  const resetAll = () => {
    applyEdit(resetEditorMapToDefault(map), 0);
    selectCell(0);
    setTool('select');
    setNotice('已恢复全部格子，可撤销此次操作。');
    setResetAllOpen(false);
  };

  const exportMap = () => {
    const namedMap = commitName();
    const payload = {
      version: 1,
      name: namedMap.name,
      rows: namedMap.rows,
      cols: namedMap.cols,
      topology: namedMap.topology,
      cells: namedMap.cells.map(({ row, col, active, shape, autoCapacity, capacity, initialEnergy, boostDirections }) => ({ row, col, active, shape, autoCapacity, capacity, initialEnergy, boostDirections })),
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    link.download = '爆炸棋-自定义地图.json';
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice('地图文件已导出');
  };

  const importMap = async (file?: File) => {
    if (!file) return;
    const revision = ++editRevision.current;
    try {
      const payload = JSON.parse(await file.text()) as { name?: unknown; rows: number; cols: number; topology?: unknown; cells: GameMap['cells'] };
      if (revision !== editRevision.current) return;
      if (!Number.isInteger(payload.rows) || !Number.isInteger(payload.cols) || payload.rows < 6 || payload.rows > 20 || payload.cols < 6 || payload.cols > 20 || !Array.isArray(payload.cells)) throw new Error('invalid');
      const topology = isBoardTopology(payload.topology) ? payload.topology : undefined;
      const imported = createEditorMap(payload.rows, payload.cols, payload.cells.map((cell) => ({
        row: cell.row,
        col: cell.col,
        active: Boolean(cell.active),
        shape: ['square', 'triangle', 'hex'].includes(cell.shape) ? cell.shape : 'square',
        autoCapacity: cell.autoCapacity !== false,
        capacity: Math.min(8, Math.max(1, Number(cell.capacity) || 1)),
        initialEnergy: Math.max(0, Number(cell.initialEnergy) || 0),
        boostDirections: Array.isArray(cell.boostDirections) ? cell.boostDirections.filter((item) => typeof item === 'string') : [],
      })), topology);
      const nextMap = {
        ...imported,
        id: map.id,
        name: typeof payload.name === 'string'
          ? payload.name.trim().slice(0, 24) || map.name
          : map.name,
        subtitle: map.subtitle,
        description: map.description,
      };
      setNameDraft(nextMap.name);
      applyEdit(nextMap, 0);
      selectCell(0);
      setNotice('地图已导入并重新校验');
    } catch {
      if (revision === editRevision.current) setNotice('无法读取此地图文件');
    }
  };

  const changeTopology = (value: unknown) => {
    if (!isBoardTopology(value) || value === map.topology) return;
    const resetsCells = modifiedCount > 0 && (isMixed || isMixedTiling(value) || map.topology === 'trihex' || value === 'trihex');
    applyEdit(retileEditorMap(map, value), 0);
    selectCell(0);
    setNotice(resetsCells ? '已按新密铺重新生成格子。撤销可恢复原来的逐格设置。' : '已重新铺设地图。');
  };

  const changeDimensions = (rows: number, cols: number) => {
    if (rows === map.rows && cols === map.cols) return;
    applyEdit(resizeEditorMap(map, rows, cols), 0);
    selectCell(0);
  };

  const sliderValue = (field: SliderField) => sliderEdit?.field === field ? sliderEdit.value : selected?.[field] ?? 0;

  return (
    <section className="editor-page">
      <div className="editor-heading">
        <div>
          <Button variant="ghost" size="icon-lg" onClick={onBack} aria-label="返回地图选择"><ArrowLeft /></Button>
          <div>
            <span className="lobby-kicker">地图工坊 · 自制槽位 {slotNumber}</span>
            <Input className="editor-map-name" aria-label="自制地图名称" value={nameDraft} maxLength={24} onChange={(event) => setNameDraft(event.target.value)} onBlur={commitName} />
          </div>
        </div>
        <div className="editor-heading-actions">
          <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void importMap(file);
          }} />
          <Button variant="outline" onClick={() => fileInput.current?.click()}><Upload />导入</Button>
          <Button variant="outline" onClick={exportMap}><Download />导出</Button>
          <Button variant="secondary" onClick={() => { onSave(commitName()); setNotice('已保存到这台设备'); }}><Save />保存</Button>
          <Button onClick={() => onPlay(commitName())} disabled={warnings.length > 0}><Play />试玩地图</Button>
        </div>
      </div>

      <div className="editor-commandbar">
        <div className="dimension-control topology-control">
          <span>密铺</span>
          <Select value={map.topology} onValueChange={changeTopology}>
            <SelectTrigger aria-label="选择地图密铺类型"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(BOARD_TOPOLOGY_NAMES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="tool-divider" />
        <div className="dimension-control"><span>{isMixed ? '铺设行' : '行'}</span><Select value={String(map.rows)} onValueChange={(value) => changeDimensions(Number(value), map.cols)}><SelectTrigger aria-label={isMixed ? '密铺范围的行数' : '地图行数'}><SelectValue /></SelectTrigger><SelectContent>{editorDimensions.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
        <span className="dimension-times">×</span>
        <div className="dimension-control"><span>{isMixed ? '铺设列' : '列'}</span><Select value={String(map.cols)} onValueChange={(value) => changeDimensions(map.rows, Number(value))}><SelectTrigger aria-label={isMixed ? '密铺范围的列数' : '地图列数'}><SelectValue /></SelectTrigger><SelectContent>{editorDimensions.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
        <div className="tool-divider" />
        <div className="paint-tools" role="toolbar" aria-label="格子绘制工具">
          {tools.map((item) => {
            const Icon = item.icon;
            return <Button key={item.id} variant={tool === item.id ? 'default' : 'ghost'} onClick={() => { setTool(item.id); setNotice(''); }} aria-pressed={tool === item.id}><Icon />{item.label}</Button>;
          })}
        </div>
        <div className="tool-divider" />
        <AlertDialog open={resetAllOpen} onOpenChange={setResetAllOpen}>
          <AlertDialogTrigger render={<Button className="reset-all-button" variant="outline" disabled={modifiedCount === 0}><RefreshCcw />恢复全部</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>恢复全部格子？</AlertDialogTitle>
              <AlertDialogDescription>将清除 {modifiedCount} 个格子的空洞、特殊槽位、预充能与强化边。当前尺寸为 {map.rows} × {map.cols}，密铺为 {BOARD_TOPOLOGY_NAMES[map.topology]}。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={resetAll}><RefreshCcw />恢复默认</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="editor-workspace">
        <div className="editor-canvas-wrap">
          <div className="editor-canvas-meta"><span>{isMixed ? '铺设范围 ' : ''}{map.rows} × {map.cols}</span><span>{BOARD_TOPOLOGY_NAMES[map.topology]}</span><span>{activeCount} 个有效格</span><span>{modifiedCount} 个已改造格</span><span>{seededCount} 个预充能格</span><span>{playerCount} 人 · {modeName}</span></div>
          <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <output aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {selected ? <>
                  <strong className="font-mono text-sm text-foreground">{formatCellCoordinate(map, selected)}</strong>
                  <span>{shapeNames[selected.shape]} · {describeCell(selected)}</span>
                  {selected.active && <span>能量 <b className="font-mono text-primary">{selected.initialEnergy}/{selected.capacity}</b></span>}
                </> : '未选择格子'}
              </output>
              <div className="flex gap-1" role="group" aria-label="编辑历史">
                <Button variant="outline" size="sm" onClick={() => navigateHistory(true)} disabled={history.past.length === 0}><Undo2 />撤销</Button>
                <Button variant="outline" size="sm" onClick={() => navigateHistory(false)} disabled={history.future.length === 0}><Redo2 />重做</Button>
                <Button variant="ghost" size="sm" className="min-[901px]:hidden" onClick={() => inspectorRef.current?.focus()} disabled={!selected}><ChevronDown />属性</Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{tools.find((item) => item.id === tool)?.hint}</p>
            {notice && <output className="mt-1.5 block text-xs text-primary" aria-live="polite">{notice}</output>}
          </div>
          <div className="editor-board-frame"><GameBoard map={map} cells={map.cells} editorMode selectedIndex={selectedIndex} highlightedEdge={highlightedEdge} onCell={paint} /></div>
          <div className="editor-legend"><span><i className="legend-normal" />普通格</span><span><i className="legend-special" />特殊槽位</span><span><i className="legend-seed" />预充能中立格</span><span><i className="legend-hole" />空洞</span></div>
        </div>

        <aside className="inspector-panel scroll-mt-24" ref={inspectorRef} tabIndex={-1} aria-label="格子检查器">
          <div className="inspector-title">
            <div><span className="section-label">格子检查器</span><strong>{selected ? formatCellCoordinate(map, selected) : '未选择'}</strong></div>
            <Button variant="outline" size="sm" onClick={resetSelected} disabled={!selected || selectedIsDefault}><RotateCcw />恢复此格</Button>
          </div>
          {selected ? (
            <>
              <label className="switch-row"><span><strong>启用格子</strong><small>关闭后该位置成为空洞</small></span><Switch checked={selected.active} onCheckedChange={(checked) => updateSelected({ active: checked, initialEnergy: checked ? selected.initialEnergy : 0 })} /></label>
              <label className="switch-row"><span><strong>自动槽位</strong><small>槽位数等于有效相邻格数</small></span><Switch checked={selected.autoCapacity} disabled={!selected.active} onCheckedChange={(checked) => updateSelected({ autoCapacity: checked })} /></label>
              <div className={`inspector-field slider-field ${selected.autoCapacity || !selected.active ? 'is-disabled' : ''}`}>
                <div><label>能量槽上限</label><strong>{sliderValue('capacity')}</strong></div>
                <Slider aria-label="能量槽上限" value={[sliderValue('capacity')]} min={1} max={8} step={1} disabled={selected.autoCapacity || !selected.active}
                  onValueChange={(value) => setSliderEdit({ field: 'capacity', value: Number(Array.isArray(value) ? value[0] : value) })}
                  onValueCommitted={(value) => commitSlider('capacity', value)} />
                <small>{!selected.autoCapacity && selected.capacity < selected.neighbors.length
                  ? `当前邻接 ${selected.neighbors.length} 格：该格为被动金边，不能主动注能，只能由相邻爆炸点燃。`
                  : `当前邻接 ${selected.neighbors.length} 格；不同数值会形成特殊槽位。`}</small>
              </div>
              <div className={`inspector-field slider-field ${!selected.active || selected.capacity <= 1 ? 'is-disabled' : ''}`}>
                <div><label>中立预充能</label><strong>{sliderValue('initialEnergy')}</strong></div>
                <Slider aria-label="中立预充能" value={[sliderValue('initialEnergy')]} min={0} max={Math.max(1, selected.capacity - 1)} step={1} disabled={!selected.active || selected.capacity <= 1}
                  onValueChange={(value) => setSliderEdit({ field: 'initialEnergy', value: Number(Array.isArray(value) ? value[0] : value) })}
                  onValueCommitted={(value) => commitSlider('initialEnergy', value)} />
                <small>大于 0 时不可直接落子，只能通过爆炸占领。</small>
              </div>
              {boostQuota > 0 && (
                <div className="inspector-field">
                  <label>强化传递边</label>
                  <div className="direction-grid">
                    {edgeOrder.map((id) => {
                      const neighbor = edgeOptions.get(id)!;
                      const label = edgeLabel(selected, neighbor);
                      const target = formatCellCoordinate(map, neighbor);
                      const active = selected.boostDirections.includes(id);
                      const unavailable = !active && selected.boostDirections.length >= boostQuota;
                      const amount = transferPlan.find((item) => item.target === neighbor.index)?.amount ?? 1;
                      return (
                        <button
                          type="button"
                          aria-label={`${label}，相邻格 ${target}`}
                          aria-pressed={active}
                          aria-disabled={unavailable}
                          title={`${label} · ${target}`}
                          className={active ? 'active' : ''}
                          key={id}
                          onPointerEnter={() => setHoveredEdge(id)}
                          onPointerLeave={() => setHoveredEdge(undefined)}
                          onFocus={() => setFocusedEdge(id)}
                          onBlur={() => setFocusedEdge(undefined)}
                          onClick={(event) => {
                            event.currentTarget.focus({ preventScroll: true });
                            if (unavailable) return;
                            updateSelected({ boostDirections: active ? selected.boostDirections.filter((item) => item !== id) : [...selected.boostDirections, id] });
                          }}
                        >
                          {label}{active ? ` ×${amount}` : ''}
                        </button>
                      );
                    })}
                  </div>
                  <small>已选择 {selected.boostDirections.length}/{boostQuota} 条加强边。悬停或聚焦可在棋盘上查看对应的共边。</small>
                </div>
              )}
            </>
          ) : <p className="inspector-empty">选择画布中的格子以调整属性。</p>}

          <div className={`validation-card ${warnings.length ? 'has-warning' : ''}`}>
            <strong>{warnings.length ? `${warnings.length} 项需要留意` : '地图结构有效'}</strong>
            {warnings.length ? warnings.map((warning) => <p key={warning}>· {warning}</p>) : <p>所有格子都能参与连锁，可立即试玩。</p>}
          </div>
        </aside>
      </div>
    </section>
  );
}
