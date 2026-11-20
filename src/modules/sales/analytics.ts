import { validationError } from '../../core/http/envelope';
import { BUSINESS_TIMEZONE, formatBratislavaDate } from '../stocktake/validators';
import { RestockRow } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates strict YYYY-MM-DD calendar dates (B-12).
 */
export function validateDateParam(raw: unknown, fieldName = 'date'): string | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  const s = String(raw).trim();
  if (!DATE_RE.test(s)) {
    throw validationError(`${fieldName} 格式应为 YYYY-MM-DD`);
  }
  const [y, m, d] = s.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== m ||
    check.getUTCDate() !== d
  ) {
    throw validationError(`${fieldName} 格式应为 YYYY-MM-DD`);
  }
  return s;
}

export function addDaysYyyyMmDd(yyyyMmDd: string, deltaDays: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

/**
 * Resolves effective [from, to] in Europe/Bratislava local date strings.
 * Defaults to recent 30 days inclusive if omitted (§5.4 item 1).
 * Note B-11: When from > to, reversed = true so callers return empty result cleanly without error.
 */
export function resolveDateRange(
  fromRaw?: unknown,
  toRaw?: unknown,
  now = new Date()
): { from: string; to: string; reversed: boolean } {
  const todayStr = formatBratislavaDate(now);
  const parsedFrom = validateDateParam(fromRaw, 'from');
  const parsedTo = validateDateParam(toRaw, 'to');

  const to = parsedTo || todayStr;
  const from = parsedFrom || addDaysYyyyMmDd(to, -29);

  // Guard maximum span (B-35: allows multi-year like 2025-01-01..2026-12-31, caps at 1100 days ~ 3 years)
  if (from <= to) {
    const startMs = Date.parse(`${from}T00:00:00Z`);
    const endMs = Date.parse(`${to}T00:00:00Z`);
    const spanDays = Math.round((endMs - startMs) / 86400_000) + 1;
    if (spanDays > 1100) {
      throw validationError('查询时间跨度不能超过 3 年 (1100 天)，请缩小时间范围');
    }
  }

  return {
    from,
    to,
    reversed: from > to,
  };
}

/**
 * Finds exact UTC timestamp corresponding to 00:00:00.000 local time in Europe/Bratislava (DST-safe, B-13).
 */
export function bratislavaLocalMidnightToUtc(yyyyMmDd: string): Date {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  // Initial guess in CET (UTC+1)
  let candidateMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 3600_000;

  // Iterate twice to resolve DST offset accurately
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(candidateMs));

    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const localYear = get('year');
    const localMonth = get('month');
    const localDay = get('day');
    const localHour = get('hour') === 24 ? 0 : get('hour');
    const localMin = get('minute');
    const localSec = get('second');

    const renderedAsUtc = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMin, localSec, 0);
    const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    const diffMs = targetAsUtc - renderedAsUtc;
    if (diffMs === 0) break;
    candidateMs += diffMs;
  }

  return new Date(candidateMs);
}

/**
 * Formats an instant into YYYY-MM-DD in Europe/Bratislava timezone (B-13).
 */
export function toBratislavaLocalDate(ts: Date | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  return formatBratislavaDate(date);
}

/**
 * Computes ISO 8601 week string `YYYY-Www` from a calendar date `YYYY-MM-DD` (B-14, AC-SAL-04).
 * Monday is the first day of the week; ISO week-numbering year follows the Thursday rule.
 */
export function getIsoWeekString(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7; // 1=Mon .. 7=Sun
  // Move to Thursday in current ISO week
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

export function formatPeriodFromLocalDate(localDate: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'week') {
    return getIsoWeekString(localDate);
  }
  if (granularity === 'month') {
    return localDate.slice(0, 7);
  }
  return localDate;
}

/**
 * Clamps limit strictly to [1, 200] without throwing (B-17, AC-SAL-05).
 */
export function clampLimit(raw: unknown, fallback = 20, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > max) return max;
  return floored;
}

export function clampRestockDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > 365) return 365;
  return floored;
}

/**
 * Computes M2 restock metrics (§5.3, AC-SAL-07, AC-SAL-08):
 * DailyRate = SoldQty / days (3 decimals)
 * DaysLeft = DailyRate === 0 ? null : Surplus / DailyRate (1 decimal)
 * SuggestedQty = max(0, ceil(DailyRate * 30 - Surplus)) (always 30-day cover regardless of lookback days)
 */
export function computeRestockMetrics(
  soldQtyInput: number,
  surplusInput: number | null | undefined,
  days: number
): {
  DailyRate: number;
  DaysLeft: number | null;
  SuggestedQty: number;
} {
  const soldQty = Number(soldQtyInput ?? 0) || 0;
  const surplus = Number(surplusInput ?? 0) || 0;
  const safeDays = Math.max(1, days);

  const rawRate = soldQty / safeDays;
  const DailyRate = Number(rawRate.toFixed(3));
  const DaysLeft = rawRate <= 0 ? null : Number((surplus / rawRate).toFixed(1));
  const SuggestedQty = Math.max(0, Math.ceil(rawRate * 30 - surplus));

  return {
    DailyRate,
    DaysLeft,
    SuggestedQty,
  };
}

/**
 * Sorts restock rows: DaysLeft ASC (null treated as Infinity at bottom), then SoldQty DESC, Barcode ASC.
 */
export function sortRestockRows(rows: RestockRow[]): RestockRow[] {
  return [...rows].sort((a, b) => {
    const aDays = a.DaysLeft === null ? Number.POSITIVE_INFINITY : a.DaysLeft;
    const bDays = b.DaysLeft === null ? Number.POSITIVE_INFINITY : b.DaysLeft;
    if (aDays !== bDays) return aDays - bDays;
    if (b.SoldQty !== a.SoldQty) return b.SoldQty - a.SoldQty;
    return a.Barcode.localeCompare(b.Barcode);
  });
}
