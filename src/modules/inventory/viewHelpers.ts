import { G1Product, LowStockRow } from './types';
import { calculateVatMetrics, getStockStatus } from './validators';

export interface InventoryPageSummary {
  totalMatching: number;
  lowStockTotal: number;
  pageInCount: number;
  pageLowCount: number;
  pageOutCount: number;
  pageStockValueRetail: number;
  pageStockValueCost: number;
  pageAvgNetMarginRate: number | null;
}

export function hasCostData(cena2: number | null | undefined): boolean {
  if (cena2 === null || cena2 === undefined) return false;
  const num = Number(cena2);
  return Number.isFinite(num) && num > 0;
}

export interface ParsedProductName {
  primary: string;
  secondary: string | null;
}

export function parsePipeProductName(raw: string | null | undefined): ParsedProductName {
  const text = (raw ?? '').trim();
  if (!text) return { primary: '', secondary: null };
  if (!text.includes('|')) return { primary: text, secondary: null };
  const parts = text
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return { primary: '', secondary: null };
  return {
    primary: parts[0],
    secondary: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

export interface ProductDisplayLines {
  line1: string;
  line2: string | null;
  line3: string | null;
}

export function resolveProductDisplayLines(
  nazov: string | null | undefined,
  nameZh: string | null | undefined,
  lang: 'zh' | 'sk'
): ProductDisplayLines {
  const trimmedNazov = (nazov ?? '').trim();
  const trimmedZh = (nameZh ?? '').trim();
  const useZhPrimary = lang === 'zh' && trimmedZh.length > 0;
  const primaryRaw = useZhPrimary ? trimmedZh : trimmedNazov;
  const parsedPrimary = parsePipeProductName(primaryRaw);

  const hasSeparateNazov =
    useZhPrimary && trimmedNazov.length > 0 && trimmedNazov !== trimmedZh;
  const altClean = hasSeparateNazov
    ? (() => {
        const parsedAlt = parsePipeProductName(trimmedNazov);
        return parsedAlt.secondary ? `${parsedAlt.primary} ${parsedAlt.secondary}` : parsedAlt.primary;
      })()
    : null;

  if (parsedPrimary.secondary) {
    return {
      line1: parsedPrimary.primary,
      line2: parsedPrimary.secondary,
      line3: altClean,
    };
  }
  return {
    line1: parsedPrimary.primary,
    line2: altClean,
    line3: null,
  };
}

export function computeInventoryPageSummary(
  rows: G1Product[],
  totalMatching: number,
  lowStockTotal: number
): InventoryPageSummary {
  let pageInCount = 0;
  let pageLowCount = 0;
  let pageOutCount = 0;
  let pageStockValueRetail = 0;
  let pageStockValueCost = 0;
  let marginSum = 0;
  let marginCount = 0;

  for (const row of rows) {
    const status = getStockStatus(row.Surplus, row.WarningAt);
    if (status === 'in') pageInCount++;
    else if (status === 'low') pageLowCount++;
    else pageOutCount++;

    const qty = Math.max(0, Number(row.Surplus ?? 0) || 0);
    const cena = Number(row.Cena ?? 0) || 0;
    const cena2 = Number(row.Cena2 ?? 0) || 0;
    pageStockValueRetail += qty * cena;
    pageStockValueCost += qty * cena2;

    if (hasCostData(row.Cena2)) {
      const vat = calculateVatMetrics(cena, cena2);
      if (vat.netMarginRate !== null) {
        marginSum += vat.netMarginRate;
        marginCount++;
      }
    }
  }

  return {
    totalMatching,
    lowStockTotal,
    pageInCount,
    pageLowCount,
    pageOutCount,
    pageStockValueRetail,
    pageStockValueCost,
    pageAvgNetMarginRate: marginCount > 0 ? marginSum / marginCount : null,
  };
}

export interface LowStockSummary {
  alertCount: number;
  outOfStockCount: number;
  totalGapQty: number;
  estimatedRestockCost: number;
}

export function computeLowStockSummary(rows: LowStockRow[]): LowStockSummary {
  let outOfStockCount = 0;
  let totalGapQty = 0;
  let estimatedRestockCost = 0;

  for (const row of rows) {
    if ((row.Surplus ?? 0) <= 0) {
      outOfStockCount++;
    }
    const gap = Math.max(0, Number(row.Gap ?? 0) || 0);
    const cost = Math.max(0, Number(row.Cena2 ?? 0) || 0);
    totalGapQty += gap;
    estimatedRestockCost += gap * cost;
  }

  return {
    alertCount: rows.length,
    outOfStockCount,
    totalGapQty,
    estimatedRestockCost,
  };
}

export function filterLowStockRows(
  rows: LowStockRow[],
  query: string,
  supplier: string
): LowStockRow[] {
  const q = query.trim().toLowerCase();
  const sup = supplier.trim();
  return rows.filter((row) => {
    if (sup && (row.Supplier || '').trim() !== sup) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      row.Barcode,
      row.Kod,
      row.Nazov,
      row.name_zh || '',
      row.Supplier || '',
      row.category_name_zh || '',
      row.category_name_sk || '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

export interface EditProductFormState {
  Nazov: string;
  name_zh: string;
  Kod: string;
  Surplus: string;
  Mnozstvo: string;
  Cena: string;
  Cena2: string;
  PovCena: string;
  PurchasePrice: string;
  Supplier: string;
  barcode2nd: string;
  conv2ndtobarcode: string;
  Dozen: string;
  Box: string;
  menupackage: string;
  Shelves: string;
  DPHtype: string;
  ExpiryDate: string;
  PurchaseCountry: string;
  Reserved: boolean;
  VIPnoDiscount: boolean;
  category: string;
}

export function createInitialEditForm(product: G1Product): EditProductFormState {
  return {
    Nazov: product.Nazov || '',
    name_zh: product.name_zh || '',
    Kod: product.Kod || '',
    Surplus: String(product.Surplus ?? 0),
    Mnozstvo: String(product.Mnozstvo ?? 0),
    Cena: String(product.Cena ?? 0),
    Cena2: String(product.Cena2 ?? 0),
    PovCena: String(product.PovCena ?? 0),
    PurchasePrice: String(product.PurchasePrice ?? 0),
    Supplier: product.Supplier || '',
    barcode2nd: product.barcode2nd || '',
    conv2ndtobarcode: String(product.conv2ndtobarcode ?? 0),
    Dozen: String(product.Dozen ?? 0),
    Box: String(product.Box ?? 0),
    menupackage: product.menupackage || '',
    Shelves: product.Shelves === null || product.Shelves === undefined ? '' : String(product.Shelves),
    DPHtype: String(product.DPHtype ?? 1),
    ExpiryDate: product.ExpiryDate || '',
    PurchaseCountry: product.PurchaseCountry || '',
    Reserved: Boolean(product.Reserved),
    VIPnoDiscount: Boolean(product.VIPnoDiscount),
    category: product.category || '',
  };
}

export function buildEditProductPatch(form: EditProductFormState): Record<string, unknown> {
  return {
    Nazov: form.Nazov,
    Kod: form.Kod,
    Surplus: form.Surplus === '' ? 0 : Number(form.Surplus),
    Mnozstvo: form.Mnozstvo === '' ? 0 : Number(form.Mnozstvo),
    Cena: form.Cena === '' ? 0 : Number(form.Cena),
    Cena2: form.Cena2 === '' ? 0 : Number(form.Cena2),
    PovCena: form.PovCena === '' ? 0 : Number(form.PovCena),
    PurchasePrice: form.PurchasePrice === '' ? 0 : Number(form.PurchasePrice),
    Supplier: form.Supplier,
    barcode2nd: form.barcode2nd,
    conv2ndtobarcode: form.conv2ndtobarcode === '' ? 0 : Number(form.conv2ndtobarcode),
    Dozen: form.Dozen === '' ? 0 : Number(form.Dozen),
    Box: form.Box === '' ? 0 : Number(form.Box),
    menupackage: form.menupackage,
    Shelves: form.Shelves.trim() === '' ? null : Number(form.Shelves),
    DPHtype: form.DPHtype === '' ? 1 : Number(form.DPHtype),
    ExpiryDate: form.ExpiryDate.trim() === '' ? null : form.ExpiryDate.trim(),
    PurchaseCountry: form.PurchaseCountry,
    Reserved: form.Reserved ? 1 : 0,
    VIPnoDiscount: form.VIPnoDiscount ? 1 : 0,
  };
}

export interface CreateProductFormState {
  Barcode: string;
  Nazov: string;
  Cena: string;
  Cena2: string;
  Surplus: string;
  Kod: string;
  Supplier: string;
  category: string;
  barcode2nd: string;
  conv2ndtobarcode: string;
  ExpiryDate: string;
}

export function createEmptyProductForm(): CreateProductFormState {
  return {
    Barcode: '',
    Nazov: '',
    Cena: '',
    Cena2: '',
    Surplus: '',
    Kod: '',
    Supplier: '',
    category: '',
    barcode2nd: '',
    conv2ndtobarcode: '',
    ExpiryDate: '',
  };
}

export function buildCreateProductBody(form: CreateProductFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    Barcode: form.Barcode,
    Nazov: form.Nazov,
  };
  if (form.Cena !== '') payload.Cena = Number(form.Cena);
  if (form.Cena2 !== '') payload.Cena2 = Number(form.Cena2);
  if (form.Surplus !== '') payload.Surplus = Number(form.Surplus);
  if (form.Kod.trim() !== '') payload.Kod = form.Kod.trim();
  if (form.Supplier.trim() !== '') payload.Supplier = form.Supplier.trim();
  if (form.category !== '') payload.category = form.category;
  if (form.barcode2nd.trim() !== '') payload.barcode2nd = form.barcode2nd.trim();
  if (form.conv2ndtobarcode !== '') payload.conv2ndtobarcode = Number(form.conv2ndtobarcode);
  if (form.ExpiryDate.trim() !== '') payload.ExpiryDate = form.ExpiryDate.trim();
  return payload;
}
