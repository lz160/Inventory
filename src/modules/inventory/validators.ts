import { validationError } from '../../core/http/envelope';
import {
  G1_BIT_FIELDS,
  G1_EDITABLE_FIELDS,
  G1_NUMERIC_FIELDS,
  G1_SORTABLE_FIELDS,
  G1Product,
  StockStatus,
  getG1CreateDefaults,
} from './types';

export const VAT_RATE = 1.23;

/**
 * Stock status classification (R-INV-1 & AC-INV-03).
 * Mutually exclusive tri-state partition:
 *   out: Surplus <= 0 (NULL Surplus treated as 0 per B-33)
 *   low: WarningAt > 0 AND Surplus <= WarningAt AND Surplus > 0
 *   in:  Surplus > 0 AND NOT (WarningAt > 0 AND Surplus <= WarningAt)
 */
export function getStockStatus(surplusInput: number | null | undefined, warningAtInput: number | null | undefined): StockStatus {
  const surplus = Number(surplusInput ?? 0);
  const warningAt = Number(warningAtInput ?? 0);

  if (!Number.isFinite(surplus) || surplus <= 0) {
    return 'out';
  }
  if (Number.isFinite(warningAt) && warningAt > 0 && surplus <= warningAt) {
    return 'low';
  }
  return 'in';
}

export interface VatMarginMetrics {
  grossMarginWithVat: number;
  netPrice: number;
  netMargin: number;
  netMarginRate: number | null; // null when netPrice === 0 (AC-SAL-10)
}

/**
 * Margin & VAT formulas (§4.4 & §5.3):
 * Cena includes 23% VAT; Cena2 excludes VAT.
 */
export function calculateVatMetrics(cenaInput: number | null | undefined, cena2Input: number | null | undefined): VatMarginMetrics {
  const cena = Number(cenaInput ?? 0) || 0;
  const cena2 = Number(cena2Input ?? 0) || 0;
  const netPrice = cena / VAT_RATE;
  const grossMarginWithVat = cena - cena2;
  const netMargin = netPrice - cena2;
  const netMarginRate = Math.abs(netPrice) < 1e-9 ? null : netMargin / netPrice;

  return {
    grossMarginWithVat,
    netPrice,
    netMargin,
    netMarginRate,
  };
}

export function normalizeBarcode(raw: unknown): string {
  const bc = String(raw ?? '').trim();
  if (!bc) {
    throw validationError('条码不能为空');
  }
  if (bc.length > 13) {
    throw validationError('条码长度不能超过 13 位');
  }
  return bc;
}

export function normalizeNazov(raw: unknown, required = true): string {
  const name = String(raw ?? '').trim();
  if (required && !name) {
    throw validationError('商品名称 (Nazov) 不能为空');
  }
  if (name.length > 510) {
    throw validationError('商品名称长度不能超过 510 个字符');
  }
  return name;
}

export function coerceBit(val: unknown): number {
  if (val === true || val === 1 || val === '1' || val === 'true') return 1;
  return 0;
}

export function coerceNumber(val: unknown, fieldName: string, allowNull = false): number | null {
  if (val === null || val === undefined || val === '') {
    return allowNull ? null : 0;
  }
  const num = Number(val);
  if (!Number.isFinite(num)) {
    throw validationError(`字段 ${fieldName} 必须为有效数字`);
  }
  return num;
}

/**
 * Validates and constructs full 32-column create payload (R-INV-3).
 * Allows negative Surplus (B-07). Enforces Barcode <= 13, Nazov <= 510.
 * Forces InstallDate = nowIso, Mnozstvo = 0 if unset, DPHtype = 1, NotNewForCloud = 1.
 */
export function validateCreateProductPayload(body: Record<string, any>, nowIso = new Date().toISOString()): G1Product {
  const Barcode = normalizeBarcode(body?.Barcode);
  const Nazov = normalizeNazov(body?.Nazov, true);

  const defaults = getG1CreateDefaults(nowIso);
  const result: G1Product = { ...defaults };

  const editableSet = new Set<string>(G1_EDITABLE_FIELDS as readonly string[]);
  for (const key of Object.keys(body || {})) {
    if (!editableSet.has(key)) continue;
    const rawVal = body[key];
    if (rawVal === undefined) continue;

    if (G1_NUMERIC_FIELDS.has(key)) {
      if (key === 'Shelves') {
        result.Shelves = coerceNumber(rawVal, key, true);
      } else {
        (result as any)[key] = coerceNumber(rawVal, key, false) ?? 0;
      }
    } else if (G1_BIT_FIELDS.has(key)) {
      (result as any)[key] = coerceBit(rawVal);
    } else if (key === 'ExpiryDate') {
      result.ExpiryDate = rawVal === null || rawVal === '' ? null : String(rawVal).trim();
    } else {
      (result as any)[key] = String(rawVal ?? '').trim();
    }
  }

  result.Barcode = Barcode;
  result.Nazov = Nazov;
  result.InstallDate = nowIso;

  return result;
}

/**
 * Filters an update patch strictly against the 29-field whitelist (R-INV-4).
 * Rejects empty post-filter patches (e.g., trying to modify WarningAt or Barcode only) with 422.
 */
export function filterEditablePatch(body: Record<string, any>): Record<string, any> {
  const editableSet = new Set<string>(G1_EDITABLE_FIELDS as readonly string[]);
  const patch: Record<string, any> = {};

  for (const key of Object.keys(body || {})) {
    if (!editableSet.has(key)) continue;
    const rawVal = body[key];
    if (rawVal === undefined) continue;

    if (key === 'Nazov') {
      patch.Nazov = normalizeNazov(rawVal, true);
    } else if (G1_NUMERIC_FIELDS.has(key)) {
      if (key === 'Shelves') {
        patch.Shelves = coerceNumber(rawVal, key, true);
      } else {
        patch[key] = coerceNumber(rawVal, key, false) ?? 0;
      }
    } else if (G1_BIT_FIELDS.has(key)) {
      patch[key] = coerceBit(rawVal);
    } else if (key === 'ExpiryDate') {
      patch.ExpiryDate = rawVal === null || rawVal === '' ? null : String(rawVal).trim();
    } else {
      patch[key] = rawVal === null ? '' : String(rawVal).trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    throw validationError('没有可更新的字段（WarningAt 请在盘点模块修改）');
  }

  return patch;
}


export function validateSort(sortBy?: string, sortDir?: string): {
  column: (typeof G1_SORTABLE_FIELDS)[number];
  direction: 'ASC' | 'DESC';
} {
  const validCols = new Set<string>(G1_SORTABLE_FIELDS as readonly string[]);
  const column = (sortBy && validCols.has(sortBy) ? sortBy : 'Barcode') as (typeof G1_SORTABLE_FIELDS)[number];
  const direction = String(sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { column, direction };
}

export function clampPagination(pageInput?: unknown, pageSizeInput?: unknown): {
  page: number;
  pageSize: number;
} {
  const p = Number(pageInput);
  const ps = Number(pageSizeInput);
  const page = Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
  let pageSize = Number.isFinite(ps) ? Math.floor(ps) : 20;
  if (pageSize < 1) pageSize = 1;
  if (pageSize > 200) pageSize = 200;
  return { page, pageSize };
}
