import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  RotateCcw,
  Sparkles,
  Info,
  X,
} from 'lucide-react';
import { useIms } from '../../context/ImsContext';
import { downloadImsXlsx, formatEur, formatQty } from '../../utils/imsApi';
import { calculateVatMetrics } from '../../modules/inventory/validators';
import { parsePipeProductName } from '../../modules/inventory/viewHelpers';
import type { CategoryDef } from '../../modules/sales/category-rules';
import { DbConnectionNotice } from './DbConnectionNotice';
import {
  ByCategoryResult,
  RestockRow,
  SalesSummaryResult,
  SoldRow,
  TimeGranularity,
  TimeseriesRow,
  UncatRow,
} from '../../modules/sales/types';

type SalesTab = 'category' | 'top' | 'slow' | 'restock';

function getDefaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86400_000);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bratislava',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  return { from: fmt(from), to: fmt(to) };
}

export const SalesAnalyticsModule: React.FC = () => {
  const { lang, t, apiCall, showToast, dbMode, dbContextReady, dbStatus } = useIms();
  const saledataBlocked = dbContextReady && dbMode === 'mssql' && !dbStatus.saledata.ok;

  const defaults = getDefaultRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeTab, setActiveTab] = useState<SalesTab>('category');
  const [restockDays, setRestockDays] = useState(30);

  // Data states (retained on error per §5.4 #9)
  const [summary, setSummary] = useState<SalesSummaryResult | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [byCategory, setByCategory] = useState<ByCategoryResult | null>(null);
  const [topRows, setTopRows] = useState<SoldRow[]>([]);
  const [slowRows, setSlowRows] = useState<SoldRow[]>([]);
  const [restockRows, setRestockRows] = useState<RestockRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-categorize drawer state (§5.4 #8)
  const [isAutoCatOpen, setIsAutoCatOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [uncatData, setUncatData] = useState<{
    rows: UncatRow[];
    total: number;
    withSuggestion: number;
    suggestTotal: number;
  } | null>(null);
  const [checkedBarcodes, setCheckedBarcodes] = useState<Set<string>>(new Set());
  const [manualCategoryMap, setManualCategoryMap] = useState<Record<string, string>>({});
  const [applyingAutoCat, setApplyingAutoCat] = useState(false);

  const buildFilterQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (appliedSearch.trim()) {
      // Exact barcode if numeric/barcode-like without spaces? Let backend handle 'q' or exact barcode cleanly
      p.set('q', appliedSearch.trim());
    }
    return p;
  }, [from, to, appliedSearch]);

  const loadAllAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const baseParams = buildFilterQuery();
      const tsParams = new URLSearchParams(baseParams);
      tsParams.set('granularity', granularity);

      const [sumData, tsData, catData, topData, slowData, restockData] = await Promise.all([
        apiCall<SalesSummaryResult>(`/api/sales/summary?${baseParams.toString()}`),
        apiCall<{ granularity: TimeGranularity; rows: TimeseriesRow[] }>(`/api/sales/timeseries?${tsParams.toString()}`),
        apiCall<ByCategoryResult>(`/api/sales/by-category?${baseParams.toString()}`),
        apiCall<{ rows: SoldRow[] }>(`/api/sales/top?${baseParams.toString()}&limit=50`),
        apiCall<{ rows: SoldRow[] }>(`/api/sales/slow?${baseParams.toString()}&limit=50`),
        apiCall<{ days: number; rows: RestockRow[] }>(`/api/sales/restock?days=${restockDays}&limit=50`),
      ]);

      setSummary(sumData);
      setTimeseries(tsData.rows);
      setByCategory(catData);
      setTopRows(topData.rows);
      setSlowRows(slowData.rows);
      setRestockRows(restockData.rows);
    } catch (err: any) {
      // §5.4 #9: Toast error without wiping previously rendered data
      showToast(err?.message || '加载销售分析数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildFilterQuery, granularity, restockDays, apiCall, showToast]);

  useEffect(() => {
    if (!dbContextReady || saledataBlocked) return;
    loadAllAnalytics();
  }, [dbContextReady, saledataBlocked, loadAllAnalytics]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(searchInput);
  };

  const handleReset = () => {
    const def = getDefaultRange();
    setFrom(def.from);
    setTo(def.to);
    setGranularity('day');
    setSearchInput('');
    setAppliedSearch('');
  };

  const openAutoCategorizeDrawer = async () => {
    setIsAutoCatOpen(true);
    try {
      const p = buildFilterQuery();
      p.set('limit', '200');
      const [data, categoryList] = await Promise.all([
        apiCall<{
          rows: UncatRow[];
          total: number;
          withSuggestion: number;
          suggestTotal: number;
        }>(`/api/sales/uncategorized?${p.toString()}`),
        apiCall<CategoryDef[]>('/api/sales/categories'),
      ]);
      setUncatData(data);
      setCategories(categoryList);

      // §5.4 #8: Default-select rows that have an automatic suggestion
      const initialChecked = new Set<string>();
      const initialManual: Record<string, string> = {};
      data.rows.forEach((r) => {
        if (r.suggestedCategory) {
          initialChecked.add(r.Barcode);
          initialManual[r.Barcode] = r.suggestedCategory;
        }
      });
      setCheckedBarcodes(initialChecked);
      setManualCategoryMap(initialManual);
    } catch (err: any) {
      showToast(err?.message || '加载未归类商品失败', 'error');
    }
  };

  const handleApplyAutoCategorize = async () => {
    const items = Array.from(checkedBarcodes)
      .map((bc) => ({ barcode: bc, category: manualCategoryMap[bc] || '' }))
      .filter((it) => it.category);

    if (items.length === 0) return;
    setApplyingAutoCat(true);
    try {
      const res = await apiCall<{ applied: number }>('/api/sales/auto-categorize', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      showToast(
        lang === 'zh' ? `成功归类 ${res.applied} 条商品` : `Kategorizovaných ${res.applied} produktov`,
        'success'
      );
      setIsAutoCatOpen(false);
      loadAllAnalytics();
    } catch (err: any) {
      showToast(err?.message || '归类写入失败', 'error');
    } finally {
      setApplyingAutoCat(false);
    }
  };

  const handleExport = async () => {
    try {
      const p = buildFilterQuery();
      await downloadImsXlsx(
        `/api/sales/export?${p.toString()}`,
        `sales_analytics_${from}_${to}.xlsx`
      );
      showToast(lang === 'zh' ? '销售分析 XLSX 导出成功' : 'Export XLSX hotový', 'success');
    } catch (err: any) {
      showToast(err?.message || '导出失败', 'error');
    }
  };

  // Responsive SVG Line Chart Geometry
  const chartW = 720;
  const chartH = 210;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const maxQty = Math.max(1, ...timeseries.map((r) => r.qty));
  const points = timeseries.map((r, i) => {
    const x =
      timeseries.length === 1
        ? padL + plotW / 2
        : padL + (i / (timeseries.length - 1)) * plotW;
    const y = padT + plotH - (r.qty / maxQty) * plotH;
    return { x, y, ...r };
  });
  const polylineStr = points.map((pt) => `${pt.x},${pt.y}`).join(' ');

  if (!dbContextReady) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-500">
        {t('dbChecking')}
      </div>
    );
  }

  if (saledataBlocked) {
    return <DbConnectionNotice targets={[{ name: 'SaleData', status: dbStatus.saledata }]} />;
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <form
        onSubmit={handleSearchSubmit}
        className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 flex flex-wrap items-center gap-2.5"
      >
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500 whitespace-nowrap">{t('salFrom')}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono-numbers text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500 whitespace-nowrap">{t('salTo')}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono-numbers text-xs"
          />
        </div>

        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as TimeGranularity)}
          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
        >
          <option value="day">{t('salGranDay')}</option>
          <option value="week">{t('salGranWeek')}</option>
          <option value="month">{t('salGranMonth')}</option>
        </select>

        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('salSearchPlaceholder')}
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
        />

        <button
          type="submit"
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
        >
          {lang === 'zh' ? '应用' : 'Použiť'}
        </button>

        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('reset')}</span>
        </button>

        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap ml-auto"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{t('exportXlsx')}</span>
        </button>
      </form>

      {/* 3 Tabular-Nums KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">{t('salKpiQty')}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono-numbers">
            {summary ? formatQty(summary.totalQty) : '—'}
          </div>
          {summary && summary.zeroPriceQty > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>
                {t('salZeroPriceNoticePrefix')} {summary.zeroPricePct}% {t('salZeroPriceNoticeSuffix')}
              </span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">{t('salKpiRevenue')}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono-numbers">
            {summary ? formatEur(summary.totalRevenue) : '—'}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">{t('salKpiRange')}</div>
          <div className="mt-1 text-base font-bold text-slate-900 font-mono-numbers">
            {summary ? `${summary.from} ~ ${summary.to}` : `${from} ~ ${to}`}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Europe/Bratislava</div>
        </div>
      </div>

      {/* Timeseries Line Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-800">{t('salChartTitle')}</h3>
          {loading && <span className="text-[11px] text-slate-400">{t('loading')}</span>}
        </div>
        {timeseries.length === 0 ? (
          <div className="h-[180px] flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
            {t('salChartEmpty')}
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full min-w-[460px] h-[200px]">
              {/* Grid lines */}
              {[0, 0.5, 1].map((frac) => {
                const y = padT + plotH * (1 - frac);
                const val = Math.round(maxQty * frac);
                return (
                  <g key={frac}>
                    <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <text x={padL - 6} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Line */}
              <polyline
                fill="none"
                stroke="#4f46e5"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polylineStr}
              />

              {/* Points + X labels */}
              {points.map((pt, idx) => (
                <g key={pt.period}>
                  <circle cx={pt.x} cy={pt.y} r="4" fill="#4f46e5" stroke="#ffffff" strokeWidth="1.5">
                    <title>{`${pt.period}: ${formatQty(pt.qty)} (${formatEur(pt.revenue)})`}</title>
                  </circle>
                  {(timeseries.length <= 12 || idx % Math.ceil(timeseries.length / 8) === 0 || idx === points.length - 1) && (
                    <text
                      x={pt.x}
                      y={chartH - 10}
                      textAnchor="middle"
                      className="fill-slate-500 text-[10px] font-mono"
                    >
                      {pt.period}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>

      {/* 4 Tabs + Content Tables */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['category', t('salTabCategory')],
                ['top', t('salTabTop')],
                ['slow', t('salTabSlow')],
                ['restock', t('salTabRestock')],
              ] as Array<[SalesTab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'category' && (
            <button
              type="button"
              onClick={openAutoCategorizeDrawer}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('salAutoCatBtn')}</span>
            </button>
          )}

          {activeTab === 'restock' && (
            <select
              value={restockDays}
              onChange={(e) => setRestockDays(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono-numbers"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          )}
        </div>

        {/* Tab 1: By Category */}
        {activeTab === 'category' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase">
                  <th className="py-2.5 px-3">{t('invColCategory')}</th>
                  <th className="py-2.5 px-3 text-right">SKU</th>
                  <th className="py-2.5 px-3 text-right">{t('salKpiQty')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salKpiRevenue')}</th>
                  <th className="py-2.5 px-3 min-w-[160px]">{t('salColShare')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {!byCategory || byCategory.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      {t('noData')}
                    </td>
                  </tr>
                ) : (
                  <>
                    {byCategory.rows.map((c) => {
                      const isUncat = c.code === '__uncat__';
                      const pct = (c.revenueShare * 100).toFixed(1);
                      return (
                        <tr
                          key={c.code}
                          className={isUncat ? 'bg-amber-50/70' : 'hover:bg-slate-50'}
                        >
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {lang === 'sk' ? c.name_sk : c.name_zh}
                            <span className="ml-2 text-[11px] text-slate-500">
                              {lang === 'sk' ? c.name_zh : c.name_sk}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers">{c.skuCount}</td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers">{formatQty(c.qty)}</td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers font-semibold">
                            {formatEur(c.revenue)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isUncat ? 'bg-amber-500' : 'bg-indigo-600'
                                  }`}
                                  style={{ width: `${Math.min(100, c.revenueShare * 100)}%` }}
                                />
                              </div>
                              <span className="font-mono-numbers text-[11px] w-12 text-right">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                      <td className="py-2.5 px-3">{lang === 'zh' ? '合计' : 'Spolu'}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers">{byCategory.total.skuCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers">{formatQty(byCategory.total.qty)}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers">{formatEur(byCategory.total.revenue)}</td>
                      <td className="py-2.5 px-3 font-mono-numbers text-right">100.0%</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Top Sales (includes VAT Margin columns) */}
        {activeTab === 'top' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase">
                  <th className="py-2.5 px-3">{t('invColBarcode')}</th>
                  <th className="py-2.5 px-3">{t('invColName')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salKpiQty')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salKpiRevenue')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invVatNetRate')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColSurplus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {topRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      {t('noData')}
                    </td>
                  </tr>
                ) : (
                  topRows.map((r) => {
                    const vat = r.Cena !== null && r.Cena2 !== null ? calculateVatMetrics(r.Cena, r.Cena2) : null;
                    return (
                      <tr key={r.Barcode} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono-numbers text-slate-700">{r.Barcode}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {(() => {
                            const parsed = parsePipeProductName(r.Nazov);
                            return (
                              <>
                                <div>{parsed.primary || '—'}</div>
                                {parsed.secondary && (
                                  <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                    {parsed.secondary}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers font-bold">{formatQty(r.SoldQty)}</td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers">{formatEur(r.Revenue)}</td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers">
                          {vat && vat.netMarginRate !== null ? `${(vat.netMarginRate * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers">
                          {r.Surplus === null ? '—' : formatQty(r.Surplus)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Slow Moving */}
        {activeTab === 'slow' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase">
                  <th className="py-2.5 px-3">{t('invColBarcode')}</th>
                  <th className="py-2.5 px-3">{t('invColName')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salKpiQty')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColSurplus')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColCena')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {slowRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      {t('noData')}
                    </td>
                  </tr>
                ) : (
                  slowRows.map((r) => (
                    <tr key={r.Barcode} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono-numbers text-slate-700">{r.Barcode}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {(() => {
                          const parsed = parsePipeProductName(r.Nazov);
                          return (
                            <>
                              <div>{parsed.primary || '—'}</div>
                              {parsed.secondary && (
                                <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                  {parsed.secondary}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers font-bold">{formatQty(r.SoldQty)}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers">{formatQty(r.Surplus)}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers">{formatEur(r.Cena)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Restock Suggestions */}
        {activeTab === 'restock' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase">
                  <th className="py-2.5 px-3">{t('invColBarcode')}</th>
                  <th className="py-2.5 px-3">{t('invColName')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColSurplus')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salColDailyRate')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salColDaysLeft')}</th>
                  <th className="py-2.5 px-3 text-right">{t('salColSuggested')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {restockRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      {t('noData')}
                    </td>
                  </tr>
                ) : (
                  restockRows.map((r) => {
                    const urgent = r.DaysLeft !== null && r.DaysLeft < 7;
                    return (
                      <tr key={r.Barcode} className={urgent ? 'bg-amber-50/70' : 'hover:bg-slate-50'}>
                        <td className="py-2.5 px-3 font-mono-numbers text-slate-700">{r.Barcode}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {(() => {
                            const parsed = parsePipeProductName(r.Nazov);
                            return (
                              <>
                                <div>{parsed.primary || '—'}</div>
                                {parsed.secondary && (
                                  <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                    {parsed.secondary}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers">{formatQty(r.Surplus)}</td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers">{r.DailyRate.toFixed(3)}</td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono-numbers font-bold ${
                            urgent ? 'text-rose-700' : 'text-slate-800'
                          }`}
                        >
                          {r.DaysLeft === null ? '∞' : r.DaysLeft.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-numbers font-bold text-indigo-700">
                          {r.SuggestedQty}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Smart Auto-Categorize Drawer (§5.4 #8) */}
      {isAutoCatOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full flex flex-col border-l border-slate-200 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{t('salAutoCatTitle')}</h3>
                {uncatData && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === 'zh'
                      ? `本页 ${uncatData.rows.length} 条、其中 ${uncatData.withSuggestion} 条可自动判断（全店共 ${uncatData.total} 条未归类）`
                      : `Na strane ${uncatData.rows.length}, návrh pre ${uncatData.withSuggestion} (spolu ${uncatData.total})`}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsAutoCatOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {!uncatData ? (
                <div className="py-12 text-center text-xs text-slate-500">{t('loading')}</div>
              ) : uncatData.rows.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">{t('noData')}</div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600">
                      <th className="py-2 px-2 w-8"></th>
                      <th className="py-2 px-2">{t('invColName')}</th>
                      <th className="py-2 px-2 text-right">{t('salKpiRevenue')}</th>
                      <th className="py-2 px-2">{t('invColCategory')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {uncatData.rows.map((r) => {
                      const canSelect = Boolean(manualCategoryMap[r.Barcode]);
                      return (
                        <tr key={r.Barcode} className="hover:bg-slate-50">
                          <td className="py-2 px-2">
                            <input
                              type="checkbox"
                              disabled={!canSelect}
                              checked={checkedBarcodes.has(r.Barcode)}
                              onChange={() => {
                                setCheckedBarcodes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.Barcode)) next.delete(r.Barcode);
                                  else next.add(r.Barcode);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="py-2 px-2">
                            {(() => {
                              const parsed = parsePipeProductName(r.Nazov);
                              return (
                                <>
                                  <div className="font-medium text-slate-900">{parsed.primary || '—'}</div>
                                  {parsed.secondary && (
                                    <div className="text-[11px] text-slate-500 mt-0.5">{parsed.secondary}</div>
                                  )}
                                </>
                              );
                            })()}
                            <div className="text-[11px] font-mono-numbers text-slate-500">{r.Barcode}</div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono-numbers">{formatEur(r.Revenue)}</td>
                          <td className="py-2 px-2">
                            <select
                              value={manualCategoryMap[r.Barcode] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualCategoryMap((m) => ({ ...m, [r.Barcode]: val }));
                                if (val) {
                                  setCheckedBarcodes((prev) => new Set(prev).add(r.Barcode));
                                } else {
                                  setCheckedBarcodes((prev) => {
                                    const next = new Set(prev);
                                    next.delete(r.Barcode);
                                    return next;
                                  });
                                }
                              }}
                              className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white"
                            >
                              <option value="">{lang === 'zh' ? '无匹配建议' : 'Bez návrhu'}</option>
                              {categories.map((cat) => (
                                <option key={cat.code} value={cat.code}>
                                  {cat.name_zh} / {cat.name_sk}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAutoCatOpen(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={checkedBarcodes.size === 0 || applyingAutoCat}
                onClick={handleApplyAutoCategorize}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('salAutoCatApply')} ({checkedBarcodes.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
