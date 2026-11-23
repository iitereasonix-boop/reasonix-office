"use client";

import { useState } from "react";

export type Slice = { key: string; label: string; value: number };

const SEGMENT_GAP = 2;

/** Colors follow the case type through --cat-N, so a filter never repaints a category. */
export function Donut({ slices, unit, colorOf }: { slices: Slice[]; unit: string; colorOf: (key: string) => string }) {
  const [hover, setHover] = useState<Slice | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <ul className="legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <i style={{ background: colorOf(slice.key) }} />
            <span>{slice.label}</span>
            <b>{total ? Math.round((slice.value / total) * 100) : 0}%</b>
          </li>
        ))}
      </ul>
      <div className="donut">
        <svg viewBox="0 0 100 100" role="img" aria-label={`توزيع ${total} ${unit}`}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--line-soft)" strokeWidth="11" />
          {total > 0 && slices.map((slice) => {
            const length = (slice.value / total) * circumference;
            const dash = Math.max(length - (slices.length > 1 ? SEGMENT_GAP : 0), 0.5);
            const element = (
              <circle
                key={slice.key}
                cx="50" cy="50" r={radius} fill="none"
                stroke={colorOf(slice.key)} strokeWidth={hover?.key === slice.key ? 14 : 11}
                strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
                onMouseEnter={() => setHover(slice)} onMouseLeave={() => setHover(null)}
              />
            );
            offset += length;
            return element;
          })}
        </svg>
        <div className="donut-center"><b>{hover?.value ?? total}</b><small>{hover?.label ?? unit}</small></div>
      </div>
    </div>
  );
}

export function BarList({ rows, colorOf }: { rows: Slice[]; colorOf: (key: string) => string }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="bar-list">
      {rows.map((row) => (
        <li key={row.key} data-tip={`${row.label}: ${row.value}`}>
          <span>{row.label}</span>
          <div><i style={{ width: `${(row.value / max) * 100}%`, background: colorOf(row.key) }} /></div>
          <b>{row.value}</b>
        </li>
      ))}
    </ul>
  );
}

export function MonthBars({ rows, label }: { rows: { key: string; label: string; value: number }[]; label: string }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="month-bars" role="img" aria-label={label}>
      {rows.map((row) => (
        <div key={row.key} className="month-bar" data-tip={`${row.label}: ${row.value}`}>
          <b>{row.value || ""}</b>
          <i style={{ height: `${Math.max((row.value / max) * 100, row.value ? 4 : 0)}%` }} />
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
