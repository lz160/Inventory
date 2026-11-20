import * as XLSX from 'xlsx';
import { MetaStore } from '../../core/db/metaStore';
import { validationError } from '../../core/http/envelope';
import { formatBratislavaDate } from '../stocktake/validators';
import {
  addDaysYyyyMmDd,
  clampLimit,
  clampRestockDays,
  computeRestockMetrics,
  formatPeriodFromLocalDate,
  resolveDateRange,
  sortRestockRows,
} from './analytics';
import { matchCategoryByName } from './category-rules';
import { G1SalesEnrichment, SalesRepository } from './repository';
import {
  ByCategoryResult,
  CategoryRow,
  RestockRow,
  SalesFilterQuery,
  SalesSummaryResult,
  SoldRow,
  TimeGranularity,
  TimeseriesRow,
  UncatRow,
} from './types';

export class SalesService {
  constructor(private repo: SalesRepository, private metaStore: MetaStore) {}

  private enrichSoldRows(
    aggRows: Array<{ Barcode: string; FallbackNazov: string | null; SoldQty: number; Revenue: number }>,
    g1Map: Map<string, G1SalesEnrichment>
  ): SoldRow[] {
    return aggRows.map((a) => {
      const g1 = g1Map.get(a.Barcode);
      // §5.2 contract: missing fields in g1 must return null, NEVER empty string impersonation
      return {
        Barcode: a.Barcode,
        Nazov: g1 ? g1.Nazov : null,
        SoldQty: Number(a.SoldQty ?? 0),
        Revenue: Number(Number(a.Revenue ?? 0).toFixed(4)),
        Cena: g1 ? g1.Cena : null,
        Cena2: g1 ? g1.Cena2 : null,
        Surplus: g1 ? g1.Surplus : null,
      };
    });
  }

  async getSummary(query: SalesFilterQuery): Promise<SalesSummaryResult> {
    const range = resolveDateRange(query.from, query.to);
    if (range.reversed) {
      return {
        totalQty: 0,
        totalRevenue: 0,
        zeroPriceQty: 0,
        zeroPricePct: 0,
        from: range.from,
        to: range.to,
      };
    }
    const res = await this.repo.getSummary({
      from: range.from,
      to: range.to,
      barcode: query.barcode,
      q: query.q,
    });
    return {
      totalQty: res.totalQty,
      totalRevenue: Number(res.totalRevenue.toFixed(2)),
      zeroPriceQty: res.zeroPriceQty,
      zeroPricePct: res.zeroPricePct,
      from: range.from,
      to: range.to,
    };
  }

  async getTimeseries(
    query: SalesFilterQuery & { granularity?: string }
  ): Promise<{ granularity: TimeGranularity; rows: TimeseriesRow[] }> {
    const gRaw = String(query.granularity || 'day').trim().toLowerCase();
    const granularity: TimeGranularity =
      gRaw === 'week' || gRaw === 'month' ? gRaw : 'day';
    const range = resolveDateRange(query.from, query.to);
    if (range.reversed) {
      return { granularity, rows: [] };
    }

    const buckets = await this.repo.getDailyBuckets({
      from: range.from,
      to: range.to,
      barcode: query.barcode,
      q: query.q,
    });

    const grouped = new Map<string, { qty: number; revenue: number }>();
    for (const b of buckets) {
      const period = formatPeriodFromLocalDate(b.localDate, granularity);
      const cur = grouped.get(period) || { qty: 0, revenue: 0 };
      cur.qty += b.qty;
      cur.revenue += b.revenue;
      grouped.set(period, cur);
    }

    const rows: TimeseriesRow[] = Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, val]) => ({
        period,
        qty: val.qty,
        revenue: Number(val.revenue.toFixed(2)),
      }));

    return { granularity, rows };
  }

  async getTop(query: SalesFilterQuery & { limit?: unknown }): Promise<{ rows: SoldRow[] }> {
    const limit = clampLimit(query.limit, 20, 200);
    const range = resolveDateRange(query.from, query.to);
    if (range.reversed) {
      return { rows: [] };
    }

    const agg = await this.repo.getAggregatedSalesByBarcode({
      from: range.from,
      to: range.to,
      barcode: query.barcode,
      q: query.q,
    });

    const topAgg = agg.slice(0, limit);
    const g1Map = await this.repo.getAllG1ProductsForEnrichment(topAgg.map((r) => r.Barcode));
    return { rows: this.enrichSoldRows(topAgg, g1Map) };
  }

  async getMargin(query: SalesFilterQuery & { limit?: unknown }): Promise<{ rows: SoldRow[] }> {
    return this.getTop({ ...query, limit: query.limit ?? 50 });
  }

  async getSlow(query: SalesFilterQuery & { limit?: unknown }): Promise<{ rows: SoldRow[] }> {
    const limit = clampLimit(query.limit, 20, 200);
    const range = resolveDateRange(query.from, query.to);
    if (range.reversed) {
      return { rows: [] };
    }

    const stocked = await this.repo.getStockedProductsForSlowAndRestock();
    const agg = await this.repo.getAggregatedSalesByBarcode({
      from: range.from,
      to: range.to,
      barcode: query.barcode,
      q: query.q,
    });
    const salesMap = new Map(agg.map((a) => [a.Barcode, a]));

    let combined: SoldRow[] = stocked
      .filter((p) => {
        if (query.barcode && p.Barcode !== query.barcode.trim()) return false;
        if (query.q && query.q.trim()) {
          const q = query.q.trim().toLowerCase();
          return p.Barcode.toLowerCase().includes(q) || (p.Nazov || '').toLowerCase().includes(q);
        }
        return true;
      })
      .map((p) => {
        const s = salesMap.get(p.Barcode);
        return {
          Barcode: p.Barcode,
          Nazov: p.Nazov,
          SoldQty: s ? s.SoldQty : 0,
          Revenue: s ? Number(s.Revenue.toFixed(4)) : 0,
          Cena: p.Cena,
          Cena2: p.Cena2,
          Surplus: p.Surplus,
        };
      });

    // §5.3: Sort by SoldQty ASC, Surplus DESC, Barcode ASC
    combined.sort((a, b) => {
      if (a.SoldQty !== b.SoldQty) return a.SoldQty - b.SoldQty;
      const sa = Number(a.Surplus ?? 0);
      const sb = Number(b.Surplus ?? 0);
      if (sb !== sa) return sb - sa;
      return a.Barcode.localeCompare(b.Barcode);
    });

    return { rows: combined.slice(0, limit) };
  }

  async getRestock(query: { days?: unknown; limit?: unknown }): Promise<{ days: number; rows: RestockRow[] }> {
    const days = clampRestockDays(query.days);
    const limit = clampLimit(query.limit, 50, 200);

    const todayStr = formatBratislavaDate(new Date());
    const fromStr = addDaysYyyyMmDd(todayStr, -(days - 1));

    const [stocked, agg] = await Promise.all([
      this.repo.getStockedProductsForSlowAndRestock(),
      this.repo.getAggregatedSalesByBarcode({ from: fromStr, to: todayStr }),
    ]);

    const salesMap = new Map(agg.map((a) => [a.Barcode, a]));
    const g1Map = await this.repo.getAllG1ProductsForEnrichment(agg.map((a) => a.Barcode));

    // Include stocked products AND sold products even if Surplus <= 0 (they need restocking too!)
    const seen = new Set<string>();
    const combinedProducts: G1SalesEnrichment[] = [];
    for (const p of stocked) {
      seen.add(p.Barcode);
      combinedProducts.push(p);
    }
    for (const a of agg) {
      if (!seen.has(a.Barcode)) {
        const p = g1Map.get(a.Barcode);
        if (p) {
          seen.add(p.Barcode);
          combinedProducts.push(p);
        }
      }
    }

    const rawRows: RestockRow[] = combinedProducts.map((p) => {
      const s = salesMap.get(p.Barcode);
      const soldQty = s ? s.SoldQty : 0;
      const surplus = Number(p.Surplus ?? 0) || 0;
      const metrics = computeRestockMetrics(soldQty, surplus, days);
      return {
        Barcode: p.Barcode,
        Nazov: p.Nazov,
        Surplus: surplus,
        WarningAt: p.WarningAt,
        Cena: p.Cena,
        Cena2: p.Cena2,
        SoldQty: soldQty,
        DailyRate: metrics.DailyRate,
        DaysLeft: metrics.DaysLeft,
        SuggestedQty: metrics.SuggestedQty,
      };
    });

    const sorted = sortRestockRows(rawRows).slice(0, limit);
    return { days, rows: sorted };
  }

  // R/AC-SAL-11, AC-SAL-12, AC-SAL-13 (strictly read-only!)
  async getByCategory(query: SalesFilterQuery): Promise<ByCategoryResult> {
    const range = resolveDateRange(query.from, query.to);
    if (range.reversed) {
      return {
        rows: [],
        total: {
          qty: 0,
          revenue: 0,
          skuCount: 0,
          categoryCount: 0,
          uncategorized: { skuCount: 0, qty: 0, revenue: 0, revenueShare: 0, skuShare: 0 },
        },
      };
    }

    const agg = await this.repo.getAggregatedSalesByBarcode({
      from: range.from,
      to: range.to,
      barcode: query.barcode,
      q: query.q,
    });

    const categories = this.metaStore.listCategories();
    const catLookup = new Map(categories.map((c) => [c.code, c]));
    const metaMap = this.metaStore.getAllProductMetaMap();

    const buckets = new Map<
      string,
      { code: string; name_sk: string; name_zh: string; sort_order: number; skuCount: number; qty: number; revenue: number }
    >();

    let totalQty = 0;
    let totalRevenue = 0;
    let totalSkus = 0;

    for (const item of agg) {
      totalQty += item.SoldQty;
      totalRevenue += item.Revenue;
      totalSkus += 1;

      const assignedCode = metaMap.get(item.Barcode)?.category;
      const catDef = assignedCode ? catLookup.get(assignedCode) : undefined;
      const code = catDef ? catDef.code : '__uncat__';

      let bucket = buckets.get(code);
      if (!bucket) {
        bucket = {
          code,
          name_sk: catDef ? catDef.name_sk : 'Nezaradené',
          name_zh: catDef ? catDef.name_zh : '未归类',
          sort_order: catDef ? catDef.sort_order : 999999,
          skuCount: 0,
          qty: 0,
          revenue: 0,
        };
        buckets.set(code, bucket);
      }
      bucket.skuCount += 1;
      bucket.qty += item.SoldQty;
      bucket.revenue += item.Revenue;
    }

    const uncatBucket = buckets.get('__uncat__');
    const categorizedBuckets = Array.from(buckets.values())
      .filter((b) => b.code !== '__uncat__')
      .sort((a, b) => b.revenue - a.revenue || a.sort_order - b.sort_order);

    const orderedBuckets = uncatBucket ? [...categorizedBuckets, uncatBucket] : categorizedBuckets;

    const rows: CategoryRow[] = orderedBuckets.map((b) => ({
      code: b.code,
      name_sk: b.name_sk,
      name_zh: b.name_zh,
      skuCount: b.skuCount,
      qty: b.qty,
      revenue: Number(b.revenue.toFixed(2)),
      qtyShare: totalQty > 0 ? Number((b.qty / totalQty).toFixed(6)) : 0,
      revenueShare: totalRevenue > 0 ? Number((b.revenue / totalRevenue).toFixed(6)) : 0,
      averagePrice: b.qty > 0 ? Number((b.revenue / b.qty).toFixed(2)) : 0,
    }));

    return {
      rows,
      total: {
        qty: totalQty,
        revenue: Number(totalRevenue.toFixed(2)),
        skuCount: totalSkus,
        categoryCount: categorizedBuckets.length,
        uncategorized: {
          skuCount: uncatBucket?.skuCount ?? 0,
          qty: uncatBucket?.qty ?? 0,
          revenue: Number((uncatBucket?.revenue ?? 0).toFixed(2)),
          revenueShare: totalRevenue > 0 ? Number(((uncatBucket?.revenue ?? 0) / totalRevenue).toFixed(6)) : 0,
          skuShare: totalSkus > 0 ? Number(((uncatBucket?.skuCount ?? 0) / totalSkus).toFixed(6)) : 0,
        },
      },
    };
  }

  // Read-only uncategorized list + rule suggestions (NEVER writes product_meta, AC-SAL-13)
  async getUncategorized(query: SalesFilterQuery & { limit?: unknown }): Promise<{
    rows: UncatRow[];
    total: number;
    withSuggestion: number;
    suggestTotal: number;
  }> {
    const limit = clampLimit(query.limit, 100, 500);
    const range = resolveDateRange(query.from, query.to);
    if (range.reversed) {
      return { rows: [], total: 0, withSuggestion: 0, suggestTotal: 0 };
    }

    const agg = await this.repo.getAggregatedSalesByBarcode({
      from: range.from,
      to: range.to,
      barcode: query.barcode,
      q: query.q,
    });

    const metaMap = this.metaStore.getAllProductMetaMap();
    const catMap = new Map(this.metaStore.listCategories().map((c) => [c.code, c]));
    const uncatAgg = agg.filter((a) => !metaMap.get(a.Barcode)?.category);

    const g1Map = await this.repo.getAllG1ProductsForEnrichment(uncatAgg.slice(0, 2000).map((a) => a.Barcode));

    let suggestTotal = 0;
    const allSuggested = uncatAgg
      .sort((a, b) => b.Revenue - a.Revenue || b.SoldQty - a.SoldQty)
      .map((a) => {
        const g1 = g1Map.get(a.Barcode);
        const displayName = g1?.Nazov ?? a.FallbackNazov ?? null;
        const suggestedCode = displayName ? matchCategoryByName(displayName) : null;
        const catDef = suggestedCode ? catMap.get(suggestedCode) : undefined;
        if (catDef) suggestTotal += 1;
        return {
          Barcode: a.Barcode,
          Nazov: g1 ? g1.Nazov : a.FallbackNazov,
          SoldQty: a.SoldQty,
          Revenue: Number(a.Revenue.toFixed(2)),
          suggestedCategory: catDef ? catDef.code : null,
          suggestedNameSk: catDef ? catDef.name_sk : null,
          suggestedNameZh: catDef ? catDef.name_zh : null,
        } satisfies UncatRow;
      });

    const pageRows = allSuggested.slice(0, limit);
    const withSuggestion = pageRows.filter((r) => r.suggestedCategory !== null).length;

    return {
      rows: pageRows,
      total: uncatAgg.length,
      withSuggestion,
      suggestTotal,
    };
  }

  // Explicit transactional write (§5.2 #9, §7.4, AC-SAL-13)
  autoCategorize(
    itemsInput: unknown,
    updatedBy: string
  ): { applied: number } {
    if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
      throw validationError('请提供至少一条待归类商品记录');
    }
    if (itemsInput.length > 500) {
      throw validationError('单次批量归类不能超过 500 条');
    }

    const items = itemsInput.map((it: any) => ({
      barcode: String(it?.barcode ?? '').trim(),
      category: String(it?.category ?? '').trim(),
    }));

    try {
      const applied = this.metaStore.batchUpsertCategories(items, updatedBy);
      return { applied };
    } catch (err: any) {
      throw validationError(err?.message || '批量归类参数校验失败');
    }
  }

  listCategories() {
    return this.metaStore.listCategories();
  }

  // Q15 Sales Analytics Multi-Sheet XLSX Export
  async exportSalesXlsx(query: SalesFilterQuery): Promise<Buffer> {
    const [summary, byCategory, top, slow, restock] = await Promise.all([
      this.getSummary(query),
      this.getByCategory(query),
      this.getTop({ ...query, limit: 200 }),
      this.getSlow({ ...query, limit: 200 }),
      this.getRestock({ days: 30, limit: 200 }),
    ]);

    const wb = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.json_to_sheet([
      {
        开始日期_From: summary.from,
        结束日期_To: summary.to,
        总销量_TotalQty: Number(summary.totalQty.toFixed(2)),
        '总销售额_TotalRevenue(EUR)': Number(summary.totalRevenue.toFixed(2)),
        '零价销量占比(%)': summary.zeroPricePct,
      },
    ]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    const catSheet = XLSX.utils.json_to_sheet(
      byCategory.rows.length > 0
        ? byCategory.rows.map((c) => ({
            品类编码: c.code,
            斯洛伐克语名_SK: c.name_sk,
            中文名_ZH: c.name_zh,
            SKU数: c.skuCount,
            销量_Qty: Number(c.qty.toFixed(2)),
            '销售额_Revenue(EUR)': Number(c.revenue.toFixed(2)),
            '销售额占比(%)': Number((c.revenueShare * 100).toFixed(2)),
            '销量占比(%)': Number((c.qtyShare * 100).toFixed(2)),
          }))
        : [{ 品类编码: '', 斯洛伐克语名_SK: '', 中文名_ZH: '', SKU数: 0, 销量_Qty: 0, '销售额_Revenue(EUR)': 0 }]
    );
    XLSX.utils.book_append_sheet(wb, catSheet, 'ByCategory');

    const topSheet = XLSX.utils.json_to_sheet(
      top.rows.map((r) => ({
        条码_Barcode: r.Barcode,
        商品名称_Nazov: r.Nazov || '',
        销量_SoldQty: Number(r.SoldQty.toFixed(2)),
        '销售额_Revenue(EUR)': Number(r.Revenue.toFixed(2)),
        '售价_Cena(EUR)': r.Cena === null ? '' : Number(r.Cena.toFixed(2)),
        '进货价_Cena2(EUR)': r.Cena2 === null ? '' : Number(r.Cena2.toFixed(2)),
        当前库存_Surplus: r.Surplus === null ? '' : Number(r.Surplus.toFixed(2)),
      }))
    );
    XLSX.utils.book_append_sheet(wb, topSheet, 'TopSales');

    const slowSheet = XLSX.utils.json_to_sheet(
      slow.rows.map((r) => ({
        条码_Barcode: r.Barcode,
        商品名称_Nazov: r.Nazov || '',
        销量_SoldQty: Number(r.SoldQty.toFixed(2)),
        当前库存_Surplus: r.Surplus === null ? '' : Number(r.Surplus.toFixed(2)),
        '售价_Cena(EUR)': r.Cena === null ? '' : Number(r.Cena.toFixed(2)),
      }))
    );
    XLSX.utils.book_append_sheet(wb, slowSheet, 'SlowMoving');

    const restockSheet = XLSX.utils.json_to_sheet(
      restock.rows.map((r) => ({
        条码_Barcode: r.Barcode,
        商品名称_Nazov: r.Nazov || '',
        当前库存_Surplus: Number(r.Surplus.toFixed(2)),
        区间销量_SoldQty: Number(r.SoldQty.toFixed(2)),
        日均销量_DailyRate: r.DailyRate,
        可售天数_DaysLeft: r.DaysLeft === null ? '∞' : r.DaysLeft,
        建议补货量_SuggestedQty: r.SuggestedQty,
      }))
    );
    XLSX.utils.book_append_sheet(wb, restockSheet, 'Restock');

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
}
