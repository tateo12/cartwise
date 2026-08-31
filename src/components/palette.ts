/**
 * Categorical series colours for charts.
 *
 * Hand-picked to stay distinguishable on the near-black ground and to keep the
 * accent green reserved for "cheapest" so it never competes with a data series.
 */
export const SERIES_COLORS = [
  '#5eead4',
  '#a78bfa',
  '#fbbf24',
  '#38bdf8',
  '#fb7185',
  '#84cc16',
  '#f472b6',
  '#e2e8e5',
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}
