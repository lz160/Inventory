export type TimeGranularity = 'day' | 'week' | 'month';

export interface SalesFilterQuery {
  from?: string;
  to?: string;
  barcode?: string;
  q?: string;
}

export interface SalesSummaryResult {
  totalQty: number;
  totalRevenue: number;
  zeroPriceQty: number;
  zeroPricePct: number;
  from: string;
  to: string;
}

export interface TimeseriesRow {
  period: string;
  qty: number;
  revenue: number;
}

export interface SoldRow {
  Barcode: string;
  Nazov: string | null;
  SoldQty: number;
  Revenue: number;
  Cena: number | null;
  Cena2: number | null;
  Surplus: number | null;
}

export interface RestockRow {
  Barcode: string;
  Nazov: string | null;
  Surplus: number;
  WarningAt: number;
  Cena: number | null;
  Cena2: number | null;
  SoldQty: number;
  DailyRate: number;
  DaysLeft: number | null;
  SuggestedQty: number;
}

export interface CategoryRow {
  code: string;
  name_sk: string;
  name_zh: string;
  skuCount: number;
  qty: number;
  revenue: number;
  qtyShare: number;
  revenueShare: number;
  averagePrice: number;
}

export interface ByCategoryResult {
  rows: CategoryRow[];
  total: {
    qty: number;
    revenue: number;
    skuCount: number;
    categoryCount: number;
    uncategorized: {
      skuCount: number;
      qty: number;
      revenue: number;
      revenueShare: number;
      skuShare: number;
    };
  };
}

export interface UncatRow {
  Barcode: string;
  Nazov: string | null;
  SoldQty: number;
  Revenue: number;
  suggestedCategory: string | null;
  suggestedNameSk: string | null;
  suggestedNameZh: string | null;
}
