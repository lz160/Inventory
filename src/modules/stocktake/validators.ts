import { validationError } from '../../core/http/envelope';
import { normalizeBarcode } from '../inventory/validators';

export const BUSINESS_TIMEZONE = 'Europe/Bratislava';

export function formatBratislavaDate(date = new Date()): string {
  // sv-SE locale produces YYYY-MM-DD cleanly
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Normalizes stocktake creation name (§6.4 / AC-STK-01):
 * Empty/omitted -> `盘点-YYYY-MM-DD` (Europe/Bratislava date). Truncated to 200 chars.
 */
export function normalizeStocktakeName(rawName?: unknown, now = new Date()): string {
  const trimmed = String(rawName ?? '').trim();
  const base = trimmed || `盘点-${formatBratislavaDate(now)}`;
  return base.slice(0, 200);
}

/**
 * Validates stocktake line payload (§6.4 / B-08 / AC-STK-03).
 */
export function validateStocktakeLineInput(body: Record<string, any>): {
  barcode: string;
  countedQty: number;
  warningAt: number | null;
  hasWarningAt: boolean;
  notes: string | null;
} {
  const barcode = normalizeBarcode(body?.barcode);

  if (body?.countedQty === undefined || body?.countedQty === null || body?.countedQty === '') {
    throw validationError('实盘数量 (countedQty) 为必填项');
  }
  const countedQty = Number(body.countedQty);
  if (!Number.isFinite(countedQty) || countedQty < 0) {
    throw validationError('实盘数量 (countedQty) 必须为非负有效数字');
  }

  let warningAt: number | null = null;
  let hasWarningAt = false;
  if (body?.warningAt !== undefined && body?.warningAt !== null && body?.warningAt !== '') {
    const w = Number(body.warningAt);
    if (!Number.isFinite(w) || w < 0) {
      throw validationError('低库存警戒线 (warningAt) 必须为非负有效数字');
    }
    warningAt = Math.round(w);
    hasWarningAt = true;
  }

  const rawNotes = body?.notes;
  const notes =
    rawNotes === undefined || rawNotes === null || String(rawNotes).trim() === ''
      ? null
      : String(rawNotes).trim().slice(0, 1000);

  return {
    barcode,
    countedQty,
    warningAt,
    hasWarningAt,
    notes,
  };
}

export function calculateVariance(countedQty: number, systemQtyInput: number | null | undefined): number {
  const systemQty = Number(systemQtyInput ?? 0) || 0;
  return countedQty - systemQty;
}
