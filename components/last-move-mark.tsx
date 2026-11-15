import { useId } from 'react';
import { PLAYER_STYLES, type GameCell } from '@/lib/explosion-game';
import type { TurnResolved } from '@/lib/match-engine';

export type LastMove = Pick<TurnResolved, 'actor' | 'cellIndex' | 'revision'>;

export function LastMoveMark({ cell, actor }: { cell: GameCell; actor: number }) {
  const gradient = useId();
  const player = PLAYER_STYLES[actor];
  if (!cell.geometry || !player) return null;
  const { x, y, centerX, centerY, width, height, vertices } = cell.geometry;
  const cx = centerX - x;
  const cy = centerY - y;
  const radius = Math.max(...vertices.map(([vx, vy]) => Math.hypot(vx - centerX, vy - centerY)));
  return (
    <svg className="last-move-mark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ color: player.color }} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${gradient}-fill`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={radius}>
          <stop offset="0" stopColor="currentColor" stopOpacity=".40" />
          <stop offset=".56" stopColor="currentColor" stopOpacity=".24" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".09" />
        </radialGradient>
        <radialGradient id={`${gradient}-pulse`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={radius}>
          <stop offset="0" stopColor="currentColor" stopOpacity=".15" />
          <stop offset=".56" stopColor="currentColor" stopOpacity=".33" />
          <stop offset=".86" stopColor="currentColor" stopOpacity=".14" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${gradient}-fill)`} />
      <circle className="last-move-wave" cx={cx} cy={cy} r={radius} fill={`url(#${gradient}-pulse)`} />
    </svg>
  );
}
