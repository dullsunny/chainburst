'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, Eye, Hand, Info, LockKeyhole, Maximize, Minus, Plus, X, Zap } from 'lucide-react';
import { LastMoveMark, type LastMove } from '@/components/last-move-mark';
import type { EnergyDisplayMode } from '@/lib/energy-display';
import { energyOrbLayout, energySlotLayout, rotatedCellOverlayStyle } from '@/lib/energy-layout';
import { compactEnergyView } from '@/lib/move-preview';
import { useMovePreview } from '@/hooks/use-move-preview';
import type { MatchSnapshot } from '@/lib/match-engine';
import { GameCell, GameMap, PLAYER_STYLES, Transfer, boostEdgeSegments, cellLayoutStyle, cellOrientation, cellPolygonPoints, directionForNeighbor, edgeLabel, formatCellCoordinate, getTransferPlan, isLegalMove, isMixedTiling, isPassiveSpecialCell, normalizedCellCenter, normalizedTransferRoute } from '@/lib/explosion-game';

interface GameBoardProps {
  map: GameMap;
  cells: GameCell[];
  currentPlayer?: number;
  disabled?: boolean;
  blockedIndex?: number | null;
  exploding?: number[];
  receiving?: number[];
  transfers?: Transfer[];
  selectedIndex?: number | null;
  highlightedEdge?: string;
  editorMode?: boolean;
  snapshot?: MatchSnapshot;
  previewEnabled?: boolean;
  energyDisplayMode?: EnergyDisplayMode;
  lastMove?: LastMove | null;
  onCell: (index: number) => void;
}

function localOutlinePoints(cell: GameCell) {
  return cellPolygonPoints(cell, .04).map(([x, y]) => `${x},${y}`).join(' ');
}

function CellOutline({ cell }: { cell: GameCell }) {
  return (
    <svg className="cell-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polygon points={localOutlinePoints(cell)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function specialCellKind(cell: GameCell) {
  if (isPassiveSpecialCell(cell)) return 'passive';
  if (!cell.autoCapacity && cell.capacity > cell.neighbors.length) return 'boost';
  if (cell.owner === null && cell.energy > 0) return 'seeded';
  if (!cell.autoCapacity) return 'manual';
  return null;
}

const specialNames = { passive: '被动格', boost: '强化格', seeded: '预充能格', manual: '自定义槽位' };

export function GameBoard({
  map,
  cells,
  currentPlayer = 0,
  disabled = false,
  blockedIndex = null,
  exploding = [],
  receiving = [],
  transfers = [],
  selectedIndex = null,
  highlightedEdge,
  editorMode = false,
  snapshot,
  previewEnabled = true,
  energyDisplayMode = 'auto',
  lastMove,
  onCell,
}: GameBoardProps) {
  const player = PLAYER_STYLES[currentPlayer];
  const topology = map.topology;
  const mixedTiling = isMixedTiling(topology);
  const dense = Math.max(map.rows, map.cols) > 12 || cells.length > 180;
  const cellLayouts = useMemo(() => map.cells.map((cell) => ({
    layout: cellLayoutStyle(map, cell),
    overlay: rotatedCellOverlayStyle(cell),
    slots: energySlotLayout(cell),
    enhanced: cell.capacity > cell.neighbors.length ? getTransferPlan(cell).filter(({ amount }) => amount > 1) : [],
  })), [map]);
  const [zoom, setZoom] = useState(1);
  const [fittedWidth, setFittedWidth] = useState(600);
  const [dragView, setDragView] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const pointerKind = useRef('mouse');
  const touch = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointers = useRef(new Set<number>());
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const previewAllowed = previewEnabled && !editorMode && !disabled && !dragView && !inspectMode && snapshot?.phase === 'playing';
  const preview = useMovePreview(map, snapshot, previewAllowed);
  const compact = energyDisplayMode === 'count'
    || (energyDisplayMode === 'auto' && compactEnergyView(map, zoom, fittedWidth));
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(() => cells.findIndex((cell) => editorMode || cell.active));
  const boardRatio = map.geometry.width / map.geometry.height;
  const inspected = inspectedIndex === null ? undefined : cells[inspectedIndex];
  const inspectedKind = inspected ? specialCellKind(inspected) : null;
  const inspectedTransfers = inspected ? cellLayouts[inspected.index].enhanced : [];
  const boostTargets = new Set(inspectedTransfers.map(({ target }) => target));
  const previewCell = preview.index === null ? undefined : cells[preview.index];
  const projectedCell = preview.index === null ? undefined : preview.result?.cells[preview.index];
  const previewDelta = previewCell && projectedCell ? projectedCell.energy - previewCell.energy : 0;
  const boardStyle = {
    '--board-aspect': `${map.geometry.width} / ${map.geometry.height}`,
    '--player-rgb': player.rgb,
    width: `${fittedWidth * zoom}px`,
    maxWidth: 'none',
  } as CSSProperties;

  const clearPreview = () => { preview.clear(); setPinned(false); touch.current = null; };
  const changeZoom = (next: number) => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (viewport && stage) {
      const v = viewport.getBoundingClientRect(), s = stage.getBoundingClientRect();
      anchor.current = { x: (v.left + viewport.clientWidth / 2 - s.left) / s.width, y: (v.top + viewport.clientHeight / 2 - s.top) / s.height };
    }
    clearPreview();
    setZoom(Math.max(1, Math.min(8, next)));
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const maxHeight = Number.parseFloat(getComputedStyle(viewport).maxHeight);
      const fitHeight = Number.isFinite(maxHeight) ? maxHeight : window.innerHeight;
      setFittedWidth(Math.max(1, Math.min(viewport.clientWidth, fitHeight * boardRatio)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [boardRatio]);

  useEffect(() => {
    setZoom(1);
    setDragView(false);
    setInspectMode(false);
    setInspectedIndex(null);
    setPinned(false);
    viewportRef.current?.scrollTo(0, 0);
  }, [map.id, map.rows, map.cols, map.topology]);

  useEffect(() => {
    setPinned(false);
    touch.current = null;
    pointers.current.clear();
  }, [previewAllowed, snapshot?.revision, snapshot?.currentPlayer, snapshot?.turnStep, snapshot?.mode, snapshot?.playerCount]);

  useEffect(() => {
    if (!anchor.current) return;
    const point = anchor.current;
    anchor.current = null;
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current, stage = stageRef.current;
      if (!viewport || !stage) return;
      const v = viewport.getBoundingClientRect(), s = stage.getBoundingClientRect();
      viewport.scrollLeft += s.left + point.x * s.width - v.left - viewport.clientWidth / 2;
      viewport.scrollTop += s.top + point.y * s.height - v.top - viewport.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [zoom, fittedWidth]);

  const commit = (index: number) => {
    if (disabled || dragView || inspectMode || index === blockedIndex || !isLegalMove(cells[index], currentPlayer)) return;
    clearPreview();
    onCell(index);
  };

  useEffect(() => {
    if (!cells[focusIndex] || (!editorMode && !cells[focusIndex].active)) setFocusIndex(cells.findIndex((cell) => editorMode || cell.active));
  }, [cells, editorMode, focusIndex]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const vectors: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowDown: [0, 1], ArrowLeft: [-1, 0] };
    const vector = vectors[event.key];
    if (!vector) return;
    event.preventDefault();
    const current = cells[index];
    const origin = normalizedCellCenter(map, current);
    const candidates = (editorMode ? cells.map((cell) => cell.index) : current.neighbors)
      .filter((candidate) => candidate !== index && (editorMode || cells[candidate]?.active))
      .map((candidate) => {
        const point = normalizedCellCenter(map, cells[candidate]);
        const dx = (point.x - origin.x) * boardRatio;
        const dy = point.y - origin.y;
        const distance = Math.hypot(dx, dy);
        const dot = dx * vector[0] + dy * vector[1];
        const alignment = distance > 0 ? dot / distance : -1;
        return { candidate, distance, alignment };
      })
      .filter((item) => item.alignment > .15)
      .sort((a, b) => (1 - a.alignment) * 100 + a.distance - ((1 - b.alignment) * 100 + b.distance));
    const nextIndex = candidates[0]?.candidate;
    if (nextIndex === undefined) return;
    setFocusIndex(nextIndex);
    cellRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="interactive-board">
      <div className="board-view-tools" role="toolbar" aria-label="棋盘视图">
        <div className="board-zoom-controls">
          <button type="button" onClick={() => changeZoom(zoom - .25)} disabled={zoom <= 1} aria-label="缩小棋盘"><Minus /></button>
          <span aria-label={`棋盘缩放 ${Math.round(zoom * 100)}%`}>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => changeZoom(zoom + .25)} disabled={zoom >= 8} aria-label="放大棋盘"><Plus /></button>
          <button type="button" onClick={() => changeZoom(1)} aria-label="适应全图" title="适应全图"><Maximize /></button>
          <button type="button" onClick={() => { clearPreview(); setInspectMode(false); setInspectedIndex(null); setDragView(!dragView); }} aria-label="拖动查看棋盘" aria-pressed={dragView} title="拖动查看棋盘"><Hand /></button>
          {!editorMode && <button type="button" onClick={() => { clearPreview(); setDragView(false); setInspectedIndex(null); setInspectMode(!inspectMode); }} aria-label="查看格子信息" aria-pressed={inspectMode} title="查看格子信息"><Info /></button>}
        </div>
        <small>{inspectMode ? '点选格子查看槽位与传递' : dragView ? '拖动画布 · 再点手掌恢复落子' : compact && energyDisplayMode === 'auto' ? '总览 · 放大查看几何棋子' : compact ? '单颗棋子显示' : zoom > 1 ? '局部 · 可滚动查看' : '全图'}</small>
      </div>
      <div
        className={`board-viewport ${dragView ? 'is-pan-mode' : ''}`}
        ref={viewportRef}
        style={{ height: `${fittedWidth / boardRatio}px` }}
        onScroll={clearPreview}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse' && !pinned) clearPreview(); if (!inspectMode) setInspectedIndex(null); }}
        onPointerDownCapture={(event) => {
          pointerKind.current = event.pointerType;
          if (event.pointerType === 'mouse') return;
          pointers.current.add(event.pointerId);
          if (pointers.current.size > 1) { clearPreview(); suppressClickUntil.current = Date.now() + 900; }
        }}
        onPointerDown={(event) => {
          if (!dragView) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        }}
        onPointerMove={(event) => {
          if (pan.current) {
            event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
            event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
          } else if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 9) {
            clearPreview();
            suppressClickUntil.current = Date.now() + 900;
          }
        }}
        onPointerUp={(event) => { pointers.current.delete(event.pointerId); if (pan.current || touch.current) suppressClickUntil.current = Date.now() + 900; pan.current = null; touch.current = null; }}
        onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pan.current = null; clearPreview(); suppressClickUntil.current = Date.now() + 900; }}
      >
    <div ref={stageRef} className={`board-stage ${dense ? 'is-dense' : ''}`} data-topology={topology} style={boardStyle}>
      <div className={`board-grid ${mixedTiling ? 'is-mixed-tiling' : ''} ${preview.result ? 'has-move-preview' : ''}`} data-topology={topology} role="grid" aria-label={`${map.name}棋盘`} aria-rowcount={mixedTiling ? undefined : map.rows} aria-colcount={mixedTiling ? undefined : map.cols} aria-busy={disabled && !inspectMode}>
        {cells.map((realCell) => {
          const predicted = preview.result?.cells[realCell.index];
          const source = !!predicted && preview.index === realCell.index;
          const cell = predicted && !source ? { ...realCell, ...predicted } : realCell;
          const { layout: geometryStyle, overlay, slots, enhanced: enhancedTransfers } = cellLayouts[cell.index];
          const coordinate = formatCellCoordinate(map, cell);
          const orientation = cellOrientation(cell);
          if (!cell.active) {
            return (
              <button
                type="button"
                role="gridcell"
                className={`board-hole shape-${cell.shape} ${(cell.row + cell.col) % 2 === 0 ? 'shape-even' : 'shape-odd'} ${selectedIndex === cell.index ? 'is-selected' : ''}`}
                data-orientation={orientation}
                key={cell.id}
                style={geometryStyle}
                onClick={() => { if (editorMode && !dragView && Date.now() >= suppressClickUntil.current) onCell(cell.index); }}
                onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !pinned) preview.clear(); if (!inspectMode) setInspectedIndex(null); }}
                aria-disabled={!editorMode}
                tabIndex={editorMode && focusIndex === cell.index ? 0 : -1}
                ref={(element) => { cellRefs.current[cell.index] = element; }}
                onFocus={() => setFocusIndex(cell.index)}
                onKeyDown={(event) => moveFocus(event, cell.index)}
                aria-label={`${coordinate}，空洞${editorMode ? '，点击编辑' : ''}`}
              >
                <CellOutline cell={cell} />
                {editorMode && <span>＋</span>}
              </button>
            );
          }

          const owner = cell.owner === null ? null : PLAYER_STYLES[cell.owner];
          const legal = editorMode || inspectMode || (!disabled && !dragView && realCell.index !== blockedIndex && isLegalMove(realCell, currentPlayer));
          const kind = specialCellKind(realCell);
          const isSpecial = kind !== null && kind !== 'seeded';
          const isPassiveSpecial = isPassiveSpecialCell(cell);
          const isSeeded = cell.owner === null && cell.energy > 0;
          const showLock = isPassiveSpecial || isSeeded;
          const showSpecialMark = showLock || kind === 'manual';
          const boostedNeighbors = enhancedTransfers.map(({ target }) => target);
          const lastHere = !editorMode && lastMove?.cellIndex === cell.index ? lastMove : null;
          const focusedNeighbor = editorMode && selectedIndex === cell.index && highlightedEdge
            ? cell.neighbors.find((neighbor) => directionForNeighbor(cell, cells[neighbor]) === highlightedEdge)
            : undefined;
          const visibleEdges = focusedNeighbor !== undefined && !boostedNeighbors.includes(focusedNeighbor)
            ? [...boostedNeighbors, focusedNeighbor]
            : boostedNeighbors;
          const { strokeWidth, segments } = slots;
          const { width, height, centerX, centerY, x, y } = cell.geometry!;
          const localCenter: [number, number] = [centerX - x, centerY - y];
          const topSlots = (segments[0].y1 + segments[segments.length - 1].y2) / 2 < localCenter[1];
          const classes = [
            'board-cell',
            `shape-${cell.shape}`,
            (cell.row + cell.col) % 2 === 0 ? 'shape-even' : 'shape-odd',
            cell.row % 2 === 0 ? 'row-even' : 'row-odd',
            owner ? 'is-owned' : '',
            legal ? 'is-legal' : '',
            predicted ? 'is-preview-cell' : '',
            source ? 'is-preview-source' : '',
            source && predicted?.owner === null ? 'preview-becomes-neutral' : '',
            predicted && (predicted.energy !== realCell.energy || predicted.owner !== realCell.owner) ? 'preview-changed' : '',
            !editorMode && cell.index === blockedIndex ? 'is-turn-used' : '',
            isSpecial ? 'is-special' : '',
            isPassiveSpecial ? 'is-passive-special' : '',
            boostedNeighbors.length > 0 ? 'has-boosted-edges' : '',
            showSpecialMark ? 'has-cell-mark' : '',
            topSlots ? 'has-top-slots' : '',
            inspectedIndex === cell.index ? 'is-inspected' : '',
            boostTargets.has(cell.index) ? 'is-boost-target' : '',
            isSeeded ? 'is-seeded' : '',
            exploding.includes(cell.index) ? 'is-exploding' : '',
            receiving.includes(cell.index) ? 'is-receiving' : '',
            selectedIndex === cell.index ? 'is-selected' : '',
          ].filter(Boolean).join(' ');

          const style = {
            ...geometryStyle,
            ...overlay,
            ...(owner ? { '--owner': owner.color, '--owner-rgb': owner.rgb } : {}),
          } as CSSProperties;
          const showCount = compact && (cell.energy > 1 || (energyDisplayMode === 'count' && cell.energy === 1));
          const orbs = energyOrbLayout(compact ? { ...cell, energy: Math.min(1, cell.energy) } : cell);

          return (
            <button
              type="button"
              role="gridcell"
              className={classes}
              data-orientation={orientation}
              key={cell.id}
              style={style}
              onClick={(event) => {
                if (inspectMode) { setInspectedIndex(cell.index); return; }
                // A touch preview is committed only by its explicit button,
                // even after a long cancelled gesture produces a delayed click.
                if (previewEnabled && !editorMode && pointerKind.current !== 'mouse' && event.detail !== 0) return;
                if (Date.now() < suppressClickUntil.current) return;
                if (editorMode) { if (!dragView) onCell(cell.index); } else if (legal) commit(cell.index);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse' && !editorMode && !dragView && !inspectMode) setInspectedIndex(kind ? cell.index : null);
                if (event.pointerType === 'mouse' && !pinned) { if (previewAllowed && legal) preview.show(cell.index); else preview.clear(); }
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== 'mouse') return;
                if (!pinned) preview.clear();
                if (!inspectMode) setInspectedIndex((current) => current === cell.index ? null : current);
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' || !previewAllowed || !legal || pointers.current.size > 1) return;
                touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                suppressClickUntil.current = Date.now() + 900;
                setPinned(true);
                preview.show(cell.index, true);
              }}
              aria-disabled={!legal}
              aria-description={!editorMode && cell.index === blockedIndex ? '本回合第一步已使用，第二步必须选择其他格子' : undefined}
              tabIndex={focusIndex === cell.index ? 0 : -1}
              ref={(element) => { cellRefs.current[cell.index] = element; }}
              onFocus={(event) => {
                setFocusIndex(cell.index);
                if (!event.currentTarget.matches(':focus-visible')) return;
                if (!editorMode && !dragView) setInspectedIndex(kind || inspectMode ? cell.index : null);
                if (previewAllowed && legal) preview.show(cell.index);
              }}
              onBlur={() => { if (!pinned) preview.clear(); if (!inspectMode) setInspectedIndex(null); }}
              onKeyDown={(event) => moveFocus(event, cell.index)}
              aria-label={`${coordinate}，${owner ? `${owner.name}玩家` : isSeeded ? '预充能中立格，不可落子' : '全空中立格'}，${cell.energy}/${cell.capacity} 能量${kind ? `，${specialNames[kind]}` : ''}${isPassiveSpecial ? '，只能由爆炸注能' : ''}${enhancedTransfers.length ? `，强化传递 ${enhancedTransfers.map(({ target, amount }) => `${edgeLabel(cell, cells[target])}至${formatCellCoordinate(map, cells[target])}传递${amount}点`).join('、')}` : ''}${lastHere ? `，上一步由${PLAYER_STYLES[lastHere.actor]?.name ?? '玩家'}落子` : ''}`}
            >
              <CellOutline cell={cell} />
              {lastHere && <LastMoveMark key={lastHere.revision} cell={realCell} actor={lastHere.actor} />}
              {owner && <span className="owner-symbol" aria-hidden="true">{owner.symbol}</span>}
              {showSpecialMark && (
                <span className="cell-rule-mark" data-kind={isPassiveSpecial ? 'passive' : isSeeded ? 'seeded' : 'manual'} aria-hidden="true">
                  {showLock ? <LockKeyhole /> : <Zap />}
                </span>
              )}
              {visibleEdges.length > 0 && cell.geometry && (
                <svg className="boost-edge-marks" viewBox={`0 0 ${cell.geometry.width} ${cell.geometry.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  {visibleEdges.map((neighbor) => {
                    const direction = directionForNeighbor(cell, cells[neighbor]);
                    const segments = boostEdgeSegments(cell, cells[neighbor]);
                    if (!segments) return null;
                    const { outer, inner } = segments;
                    return <g className={`boost-edge ${neighbor === focusedNeighbor ? 'is-edge-highlight' : ''}`} data-direction={direction} key={neighbor}>
                      <line className="boost-edge-outer" x1={outer[0][0]} y1={outer[0][1]} x2={outer[1][0]} y2={outer[1][1]} vectorEffect="non-scaling-stroke" />
                      <line className="boost-edge-inner" x1={inner[0][0]} y1={inner[0][1]} x2={inner[1][0]} y2={inner[1][1]} vectorEffect="non-scaling-stroke" />
                    </g>;
                  })}
                </svg>
              )}
              <span className={`energy-cluster ${showCount ? 'has-count' : ''}`} data-count={cell.energy} aria-hidden="true">
                {orbs.map((orb, energy) => <i key={energy} style={{ left: `${orb.left}%`, top: `${orb.top}%`, width: `${orb.width}%`, height: `${orb.height}%` }} />)}
                {showCount && <b>{cell.energy}</b>}
              </span>
              <svg className="cell-slots" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" strokeWidth={strokeWidth} aria-hidden="true" focusable="false">
                {segments.map((segment, slot) => {
                  const change = source && predicted
                    ? slot >= realCell.energy && slot < predicted.energy ? 'preview-gain'
                      : slot < realCell.energy && slot >= predicted.energy ? 'preview-loss' : ''
                    : '';
                  return <line {...segment} className={change || (slot < cell.energy ? 'filled' : undefined)} key={slot} />;
                })}
              </svg>
            </button>
          );
        })}

        <div className="energy-flight-layer" aria-hidden="true">
          {transfers.map((transfer, index) => {
            const source = cells[transfer.source];
            const target = cells[transfer.target];
            const { start, midpoint, end } = normalizedTransferRoute(map, source, target);
            const particleStyle = {
              '--sx': `${start.x * 100}%`,
              '--sy': `${start.y * 100}%`,
              '--ex': `${midpoint.x * 100}%`,
              '--ey': `${midpoint.y * 100}%`,
              '--tx': `${end.x * 100}%`,
              '--ty': `${end.y * 100}%`,
              '--delay': '0ms',
              '--flight-color': player.color,
            } as CSSProperties;
            return <i className="energy-packet" style={particleStyle} key={`${transfer.source}-${transfer.target}-${index}`} data-amount={transfer.amount > 1 ? transfer.amount : undefined} />;
          })}
        </div>
      </div>
    </div>
      </div>
      {!editorMode && (
        <div className={`cell-inspection-space ${inspectMode ? 'can-scroll' : ''}`} role="status" aria-atomic="true">
          {inspected && (
            <div className="cell-inspection">
              <Info aria-hidden="true" />
              <span>{inspectedKind && <strong>{specialNames[inspectedKind]}</strong>} <span>{inspected.energy}/{inspected.capacity} 能量</span>
                {inspectedKind === 'passive' && <span> · 仅接收爆炸能量</span>}
                {inspectedKind !== 'passive' && inspected.owner === null && inspected.energy > 0 && <span> · 预充能锁定</span>}
                {inspectedTransfers.length > 0 && <span className="cell-inspection-targets">强化传递 → {inspectedTransfers.map(({ target, amount }) => `${edgeLabel(inspected, cells[target]).split(' · ').at(-1)} ${amount} 点`).join(' · ')}</span>}
              </span>
            </div>
          )}
        </div>
      )}
      {!editorMode && previewEnabled && !inspectMode && (
        <div className={`move-preview-bar ${preview.index !== null ? 'is-active' : ''}`} aria-live="polite" aria-atomic="true">
          <Eye aria-hidden="true" />
          <span>{preview.index === null ? '悬停预览 · 触屏接触预览后确认落子' : preview.pending ? '正在预览完整连锁…' : preview.failed ? '预览暂不可用，可正常落子' : preview.result && previewCell && projectedCell ? `预览 ${previewCell.energy} → ${projectedCell.energy}${projectedCell.owner === null ? ' · 爆后中立' : ''}${preview.result.winner !== null ? ' · 此步将获胜' : preview.result.waveCount ? ` · ${preview.result.waveCount} 波连锁` : ''}` : '请选择合法格子'}</span>
          {previewDelta !== 0 && <strong className={`preview-energy-delta ${previewDelta > 0 ? 'is-gain' : 'is-loss'}`}>{previewDelta > 0 ? `+${previewDelta}` : `−${-previewDelta}`}</strong>}
          {preview.index !== null && <>
            {pinned && <button type="button" className="confirm-preview" disabled={preview.pending || (!preview.result && !preview.failed) || disabled} onClick={() => { if (preview.index !== null) commit(preview.index); }}><Check />{preview.failed ? '直接落子' : '确认落子'}</button>}
            <button type="button" onClick={clearPreview} aria-label="取消落子预览"><X /></button>
          </>}
        </div>
      )}
    </div>
  );
}
