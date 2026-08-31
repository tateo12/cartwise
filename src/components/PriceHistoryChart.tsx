'use client';

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ChartSeries {
  storeId: string;
  label: string;
  color: string;
  points: { date: string; priceCents: number }[];
}

/**
 * 90-day price history, one line per Store.
 *
 * The Y axis deliberately does NOT start at zero: the question here is "how
 * does today compare to the recent range", and a zero baseline flattens a $1
 * swing on a $4 item into invisibility.
 */
export function PriceHistoryChart({ series, medianCents }: { series: ChartSeries[]; medianCents?: number }) {
  // Recharts wants one row per x value with a column per series.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const line of series) {
    for (const point of line.points) {
      const row = byDate.get(point.date) ?? { date: point.date };
      row[line.storeId] = point.priceCents / 100;
      byDate.set(point.date, row);
    }
  }
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (data.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-zinc-500">No price history yet.</p>;
  }

  return (
    <div className="h-64 w-full px-2 py-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="#1d2a25" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7f77', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#1d2a25' }}
            minTickGap={40}
            tickFormatter={(value: string) => value.slice(5)}
          />
          <YAxis
            tick={{ fill: '#6b7f77', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => `$${value.toFixed(2)}`}
            width={54}
          />
          {medianCents != null && (
            <ReferenceLine
              y={medianCents / 100}
              stroke="#3f5850"
              strokeDasharray="4 4"
              label={{ value: '90-day median', fill: '#6b7f77', fontSize: 10, position: 'insideTopRight' }}
            />
          )}
          <Tooltip
            contentStyle={{
              background: '#0f1613',
              border: '1px solid #2a3a33',
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: '#8fa39a' }}
            formatter={(value: number, name: string) => [
              `$${Number(value).toFixed(2)}`,
              series.find((s) => s.storeId === name)?.label ?? name,
            ]}
          />
          {series.map((line) => (
            <Line
              key={line.storeId}
              type="monotone"
              dataKey={line.storeId}
              stroke={line.color}
              strokeWidth={1.75}
              dot={false}
              connectNulls
              // No draw-on animation: this is a reference chart, and the 1.5s
              // sweep delays reading the numbers (and makes screenshots capture
              // half-drawn lines).
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
