export interface G1Product {
  Nazov: string;
  Cena: number;
  PovCena: number;
  Barcode: string;
  Mnozstvo: number;
  Kod: string;
  Element: string;
  Class: string;
  Reserved: boolean | number;
  Surplus: number | null;
  VIPnoDiscount: boolean | number;
  barcode2nd: string;
  conv2ndtobarcode: number;
  barcodeType: number;
  DPHtype: number;
  PurchasePrice: number;
  Dozen: number;
  Box: number;
  menupackage: string;
  Picture: string;
  Cena2: number;
  WarningAt: number;
  MoreSurplus: string;
  ExpiryDate: string | null;
  PurchaseCountry: string;
  Supplier: string;
  Companions: string;
  NotNewForCloud: boolean | number;
  IsUpdateCloud: boolean | number;
  InstallDate: string;
  Shelves: number | null;
  LastInstallQty: number;
  // Optional metadata enrichment from SQLite product_meta
  category?: string | null;
  category_name_sk?: string | null;
  category_name_zh?: string | null;
}

export type StockStatus = 'in' | 'low' | 'out';

export interface LowStockProduct extends G1Product {
  Gap: number;
}
export type LowStockRow = LowStockProduct;

export interface ProductListQuery {
  barcode?: string;
  kod?: string;
  q?: string;
  supplier?: string;
  stock?: StockStatus | '';
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc' | string;
}


export interface PriceHistoryEntry {
  Id?: number;
  Barcode: string;
  Nazov: string | null;
  Field: 'Cena' | 'Cena2';
  OldValue: number | null;
  NewValue: number;
  ChangedBy: string;
  ChangedAt?: string;
  Source: 'ims' | 'scheduled';
}

export type InventoryImportMode = 'upsert' | 'create_only' | 'update_only';

export interface InventoryImportItemInput {
  rowNumber?: number;
  Barcode: string;
  Nazov?: string;
  Kod?: string;
  Supplier?: string;
  category?: string | null;
  Surplus?: number;
  Cena?: number;
  Cena2?: number;
  barcode2nd?: string;
  conv2ndtobarcode?: number;
}

export interface InventoryImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    rowNumber: number;
    barcode: string;
    message: string;
  }>;
}

export const G1_ALL_FIELDS = [
  'Nazov',
  'Cena',
  'PovCena',
  'Barcode',
  'Mnozstvo',
  'Kod',
  'Element',
  'Class',
  'Reserved',
  'Surplus',
  'VIPnoDiscount',
  'barcode2nd',
  'conv2ndtobarcode',
  'barcodeType',
  'DPHtype',
  'PurchasePrice',
  'Dozen',
  'Box',
  'menupackage',
  'Picture',
  'Cena2',
  'WarningAt',
  'MoreSurplus',
  'ExpiryDate',
  'PurchaseCountry',
  'Supplier',
  'Companions',
  'NotNewForCloud',
  'IsUpdateCloud',
  'InstallDate',
  'Shelves',
  'LastInstallQty',
] as const;

/**
 * Editable whitelist = 32 - Barcode (PK) - WarningAt (stocktake-only) - InstallDate (system-written) = 29 fields (§4.1.1)
 */
export const G1_EDITABLE_FIELDS = [
  'Nazov',
  'Cena',
  'PovCena',
  'Mnozstvo',
  'Kod',
  'Element',
  'Class',
  'Reserved',
  'Surplus',
  'VIPnoDiscount',
  'barcode2nd',
  'conv2ndtobarcode',
  'barcodeType',
  'DPHtype',
  'PurchasePrice',
  'Dozen',
  'Box',
  'menupackage',
  'Picture',
  'Cena2',
  'MoreSurplus',
  'ExpiryDate',
  'PurchaseCountry',
  'Supplier',
  'Companions',
  'NotNewForCloud',
  'IsUpdateCloud',
  'Shelves',
  'LastInstallQty',
] as const;

export const G1_COLUMNS = G1_ALL_FIELDS;

export const G1_MONEY_FIELDS = new Set<string>(['Cena', 'PovCena', 'PurchasePrice', 'Cena2']);
export const G1_REAL_FIELDS = new Set<string>(['Mnozstvo', 'Surplus']);
export const G1_SMALLINT_FIELDS = new Set<string>(['WarningAt']);
export const G1_INT_FIELDS = new Set<string>(['conv2ndtobarcode', 'barcodeType', 'DPHtype', 'Dozen', 'Box']);
export const G1_FLOAT_FIELDS = new Set<string>(['Shelves', 'LastInstallQty']);

export const G1_NUMERIC_FIELDS = new Set<string>([
  'Cena',
  'PovCena',
  'Mnozstvo',
  'Surplus',
  'conv2ndtobarcode',
  'barcodeType',
  'DPHtype',
  'PurchasePrice',
  'Dozen',
  'Box',
  'Cena2',
  'WarningAt',
  'Shelves',
  'LastInstallQty',
]);

export const G1_BIT_FIELDS = new Set<string>([
  'Reserved',
  'VIPnoDiscount',
  'NotNewForCloud',
  'IsUpdateCloud',
]);

export const G1_SORTABLE_FIELDS = [
  'Barcode',
  'Nazov',
  'Kod',
  'Cena',
  'Cena2',
  'Surplus',
  'Supplier',
  'WarningAt',
] as const;

export function getG1CreateDefaults(nowIso: string): G1Product {
  return {
    Nazov: '',
    Cena: 0,
    PovCena: 0,
    Barcode: '',
    Mnozstvo: 0,
    Kod: '',
    Element: '',
    Class: '',
    Reserved: 0,
    Surplus: 0,
    VIPnoDiscount: 0,
    barcode2nd: '',
    conv2ndtobarcode: 0,
    barcodeType: 0,
    DPHtype: 1,
    PurchasePrice: 0,
    Dozen: 0,
    Box: 0,
    menupackage: '',
    Picture: '',
    Cena2: 0,
    WarningAt: 0,
    MoreSurplus: '',
    ExpiryDate: null,
    PurchaseCountry: '',
    Supplier: '',
    Companions: '',
    NotNewForCloud: 1,
    IsUpdateCloud: 0,
    InstallDate: nowIso,
    Shelves: null,
    LastInstallQty: 0,
  };
}
