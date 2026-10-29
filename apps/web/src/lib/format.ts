const numberFormat = new Intl.NumberFormat('en');
const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });
const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  return `${percent === 0 || percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatTime(value: string | Date): string {
  return timeFormat.format(typeof value === 'string' ? new Date(value) : value);
}

/** "5 minutes ago", "in 2 hours", "now". */
export function formatRelative(value: string | Date, now: number = Date.now()): string {
  const seconds = Math.round(((typeof value === 'string' ? Date.parse(value) : value.getTime()) - now) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.trunc(seconds / size), unit);
  }
  return Math.abs(seconds) < 10 ? 'just now' : relativeFormat.format(seconds, 'second');
}

/** Compact duration for cooldowns: "45 s", "5 min", "2 h", "3 d". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`;
  if (totalSeconds < 3600) return `${Math.round(totalSeconds / 60)} min`;
  if (totalSeconds < 86_400) return `${Math.round(totalSeconds / 360) / 10} h`;
  return `${Math.round(totalSeconds / 8640) / 10} d`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** Shortens long opaque ids for display: "3f2a9c…81bd". */
export function shortId(value: string, head = 8, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
