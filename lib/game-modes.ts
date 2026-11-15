export type GameModeId = 'classic' | 'surge' | 'dominion';

export const DOMINION_PERCENT = 65;

export function getDominionTarget(activeCount: number, percent = DOMINION_PERCENT) {
  return Math.ceil(activeCount * percent / 100);
}

export const GAME_MODES: { id: GameModeId; name: string; description: string; label: string }[] = [
  { id: 'classic', name: '经典模式', description: '每回合注入 1 能量，独占过半且清空其他颜色即获胜。', label: '标准规则' },
  { id: 'surge', name: '双脉冲', description: '每回合分两步，在不同格各注入 1 点；每步结算后继续，无其他合法格则结束回合。', label: '双步对局' },
  { id: 'dominion', name: '疆域赛', description: `无需清空对手，率先占领至少 ${DOMINION_PERCENT}% 可用格即获胜。`, label: '规则扩展' },
];
