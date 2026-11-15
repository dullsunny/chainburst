export const ENERGY_DISPLAY_LABELS = {
  auto: '自动',
  geometry: '几何排列',
  count: '单颗加数字',
} as const;

export type EnergyDisplayMode = keyof typeof ENERGY_DISPLAY_LABELS;

export function isEnergyDisplayMode(value: unknown): value is EnergyDisplayMode {
  return value === 'auto' || value === 'geometry' || value === 'count';
}
