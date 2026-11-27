import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Plus,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  FileSpreadsheet,
  ChevronDown,
} from 'lucide-react';
import { useIms } from '../../context/ImsContext';
import { downloadImsXlsx, formatEur, formatQty } from '../../utils/imsApi';
import { getStockStatus, calculateVatMetrics } from '../../modules/inventory/validators';
import { G1Product, LowStockRow, StockStatus } from '../../modules/inventory/types';
import {
  computeInventoryPageSummary,
  computeLowStockSummary,
  filterLowStockRows,
  hasCostData,
  resolveProductDisplayLines,
} from '../../modules/inventory/viewHelpers';
import type { CategoryDef } from '../../modules/sales/category-rules';
import { InventoryImportModal } from './InventoryImportModal';
import { InventoryDetailDrawer } from './InventoryDetailDrawer';
import { InventoryCreateModal } from './InventoryCreateModal';
import { DbConnectionNotice } from './DbConnectionNotice';

type SubTab = 'all' | 'low-stock';

export const InventoryModule: React.FC = () => {
  const { lang, t, apiCall, showToast, dbMode, dbContextReady, dbStatus, currentStore } = useIms();
  const skladBlocked = dbContextReady && dbMode === 'mssql' && !dbStatus.sklad.ok;
  const suppliersLoadedRef = useRef(false);

  const [subTab, setSubTab] = useState<SubTab>('all');

  // Filter & pagination state (all products)
  const [searchInput, setSearchInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stockFilter, setStockFilter] = useState<'' | StockStatus>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('Barcode');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Low-stock client filters
  const [lowSearchInput, setLowSearchInput] = useState('');
  const [lowSupplierFilter, setLowSupplierFilter] = useState('');

  // Data state (never wiped on transient error)
  const [rows, setRows] = useState<G1Product[]>([]);
  const [total, setTotal] = useState(0);
  const [lowStockRows, setLowStockRows] = useState<LowStockRow[]>([]);
  const [lowStockTotal, setLowStockTotal] = useState(0);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals & Detail Drawer
  const [isExcelMenuOpen, setIsExcelMenuOpen] = useState(false);
  const excelMenuRef = useRef<HTMLDivElement>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<G1Product | null>(null);

  useEffect(() => {
    if (!isExcelMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (excelMenuRef.current && !excelMenuRef.current.contains(e.target as Node)) {
        setIsExcelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isExcelMenuOpen]);

  const loadSuppliers = useCallback(async () => {
    try {
      const list = await apiCall<string[]>('/api/g1/suppliers');
      setSuppliers(list);
      suppliersLoadedRef.current = true;
    } catch {
      // non-fatal
    }
  }, [apiCall]);

  useEffect(() => {
    if (!currentStore) return;
    let disposed = false;
    setCategories([]);
    suppliersLoadedRef.current = false;
    apiCall<CategoryDef[]>('/api/g1/categories').then(
      (list) => {
        if (!disposed) setCategories(list);
      },
      (error) => {
        if (!disposed) showToast(error.message, 'error');
      }
    );
    return () => {
      disposed = true;
    };
  }, [apiCall, currentStore?.id, showToast]);

  const loadLowStock = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setErrorMsg(null);
      }
      try {
        const data = await apiCall<{ rows: LowStockRow[]; total: number }>('/api/g1/low-stock');
        setLowStockRows(data.rows);
        setLowStockTotal(data.total);
      } catch (err: any) {
        if (!silent) {
          const msg = err?.message || '加载低库存告警失败';
          setErrorMsg(msg);
          showToast(msg, 'error');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiCall, showToast]
  );

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (appliedQ.trim()) params.set('q', appliedQ.trim());
      if (supplier) params.set('supplier', supplier);
      if (stockFilter) params.set('stock', stockFilter);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);

      const data = await apiCall<{ rows: G1Product[]; total: number }>(
        `/api/g1/products?${params.toString()}`
      );
      setRows(data.rows);
      setTotal(data.total);
      if (!suppliersLoadedRef.current) {
        void loadSuppliers();
      }
    } catch (err: any) {
      const msg = err?.message || '加载库存列表失败';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [appliedQ, supplier, stockFilter, page, pageSize, sortBy, sortDir, apiCall, showToast, loadSuppliers]);

  useEffect(() => {
    if (!dbContextReady || skladBlocked) return;
    if (subTab === 'all') {
      void loadProducts();
      void loadLowStock(true);
    } else {
      void loadLowStock(false);
    }
  }, [dbContextReady, skladBlocked, subTab, loadProducts, loadLowStock]);

  const pageSummary = useMemo(
    () => computeInventoryPageSummary(rows, total, lowStockTotal),
    [rows, total, lowStockTotal]
  );

  const filteredLowRows = useMemo(
    () => filterLowStockRows(lowStockRows, lowSearchInput, lowSupplierFilter),
    [lowStockRows, lowSearchInput, lowSupplierFilter]
  );

  const lowStockSummary = useMemo(
    () => computeLowStockSummary(filteredLowRows),
    [filteredLowRows]
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilters = Boolean(appliedQ.trim() || supplier || stockFilter);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedQ(searchInput);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setAppliedQ('');
    setSupplier('');
    setStockFilter('');
    setPage(1);
  };

  const refreshAfterMutation = () => {
    void loadProducts();
    void loadLowStock(subTab === 'all');
    void loadSuppliers();
  };

  const handleExport = async () => {
    setIsExcelMenuOpen(false);
    try {
      const params = new URLSearchParams();
      if (appliedQ.trim()) params.set('q', appliedQ.trim());
      if (supplier) params.set('supplier', supplier);
      if (stockFilter) params.set('stock', stockFilter);
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      await downloadImsXlsx(
        `/api/g1/export?${params.toString()}`,
        `inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      showToast(lang === 'zh' ? '库存 XLSX 导出成功' : 'Export XLSX hotový', 'success');
    } catch (err: any) {
      showToast(err?.message || '导出失败', 'error');
    }
  };

  const handleDownloadImportTemplate = async () => {
    setIsExcelMenuOpen(false);
    try {
      await downloadImsXlsx(
        '/api/g1/import-template',
        `inventory_import_template_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      showToast(
        lang === 'zh' ? '标准库存导入模板下载成功' : 'Šablóna importu stiahnutá',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || '模板下载失败', 'error');
    }
  };

  const renderStatusTag = (surplus: number | null | undefined, warningAt: number | null | undefined) => {
    const status = getStockStatus(surplus, warningAt);
    if (status === 'out') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
          <span>{t('invStockOut')}</span>
        </span>
      );
    }
    if (status === 'low') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
          <span>{t('invStockLow')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>{t('invStockIn')}</span>
      </span>
    );
  };

  const renderCompactStatusTag = (surplus: number | null | undefined, warningAt: number | null | undefined) => {
    const status = getStockStatus(surplus, warningAt);
    if (status === 'out') {
      return (
        <span className="inline-flex flex-col items-center justify-center gap-0.5 leading-none text-rose-700">
          <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span className="text-[10px] font-semibold whitespace-nowrap">{t('invStockOut')}</span>
        </span>
      );
    }
    if (status === 'low') {
      return (
        <span className="inline-flex flex-col items-center justify-center gap-0.5 leading-none text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span className="text-[10px] font-semibold whitespace-nowrap">{t('invStockLow')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex flex-col items-center justify-center gap-0.5 leading-none text-emerald-700">
        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
        <span className="text-[10px] font-semibold whitespace-nowrap">{t('invStockIn')}</span>
      </span>
    );
  };

  const renderCategoryCell = (p: G1Product) => {
    const primary = lang === 'sk' ? p.category_name_sk || p.category_name_zh : p.category_name_zh || p.category_name_sk;
    if (!primary) return <span className="text-slate-400">—</span>;
    return <span className="text-slate-700 font-medium truncate">{primary}</span>;
  };

  const renderMarginDisplay = (cena: number, cena2: number | null | undefined) => {
    if (!hasCostData(cena2)) {
      return (
        <div className="text-right font-mono-numbers">
          <span className="font-semibold text-rose-600">error</span>
        </div>
      );
    }

    const vat = calculateVatMetrics(cena, cena2 ?? 0);
    const ratePct = vat.netMarginRate === null ? null : vat.netMarginRate * 100;
    const rateTone =
      ratePct === null
        ? 'text-slate-400'
        : ratePct < 10
        ? 'text-rose-700'
        : ratePct < 22
        ? 'text-amber-700'
        : 'text-emerald-700';

    return (
      <div className="text-right font-mono-numbers">
        <div className={`font-semibold ${rateTone}`}>
          {ratePct === null ? '—' : `${ratePct.toFixed(1)}%`}
        </div>
        <div className="text-[11px] text-slate-400">{formatEur(vat.netMargin)}</div>
      </div>
    );
  };

  const avgMarginPct =
    pageSummary.pageAvgNetMarginRate === null ? null : pageSummary.pageAvgNetMarginRate * 100;

  const colCount = 8;

  if (!dbContextReady) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-500">
        {t('dbChecking')}
      </div>
    );
  }

  if (skladBlocked) {
    return <DbConnectionNotice targets={[{ name: 'SKLAD', status: dbStatus.sklad }]} />;
  }

  return (
    <div className="space-y-4">
      {/* Main Unified Inventory Workspace */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* 1. Top Control Strip */}
        <div className="px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Primary Tab Switcher */}
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                data-testid="inv-tab-all"
                onClick={() => setSubTab('all')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  subTab === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>{t('invAllListTab')}</span>
                <span className="font-mono-numbers text-[11px] text-slate-500">({total})</span>
              </button>
              <button
                type="button"
                data-testid="inv-tab-low-stock"
                onClick={() => setSubTab('low-stock')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  subTab === 'low-stock'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-amber-800 hover:bg-amber-100/70'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{t('invLowStockTab')}</span>
                {lowStockTotal > 0 && (
                  <span
                    className={`font-mono-numbers text-[11px] ${
                      subTab === 'low-stock' ? 'text-amber-100' : 'text-amber-700'
                    }`}
                  >
                    ({lowStockTotal})
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="inv-create-btn"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>{t('invCreateBtn')}</span>
            </button>

            <div className="relative" ref={excelMenuRef}>
              <button
                type="button"
                aria-expanded={isExcelMenuOpen}
                onClick={() => setIsExcelMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{t('invTemplateExportBtn')}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {isExcelMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-40 text-xs">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>{t('exportXlsx')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadImportTemplate}
                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{t('invDownloadTemplate')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsExcelMenuOpen(false);
                      setIsImportModalOpen(true);
                    }}
                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-indigo-700 hover:bg-indigo-50 font-semibold border-t border-slate-100 mt-1 pt-2"
                  >
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('invBatchImportBtn')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Real-Data KPI Summary Strip (context-aware per active tab) */}
        {subTab === 'all' ? (
          <div
            data-testid="inv-kpi-strip"
            className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200 bg-slate-50/40 [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-slate-200 lg:[&>*]:border-r lg:[&>*:last-child]:border-r-0 [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-slate-200 lg:[&>*:nth-child(-n+2)]:border-b-0"
          >
            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">{t('invSummaryVisible')}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-base sm:text-lg font-bold font-mono-numbers text-slate-900">
                  {formatQty(pageSummary.totalMatching)}
                </span>
                <span className="text-[11px] text-slate-500 font-mono-numbers whitespace-nowrap">
                  {t('invStockIn')} {pageSummary.pageInCount} · {t('invStockOut')} {pageSummary.pageOutCount}
                </span>
              </div>
            </div>

            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">{t('invLowStockTab')}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`text-base sm:text-lg font-bold font-mono-numbers ${
                    pageSummary.lowStockTotal > 0 ? 'text-amber-700' : 'text-slate-900'
                  }`}
                >
                  {formatQty(pageSummary.lowStockTotal)}
                </span>
                <span className="text-[11px] text-slate-500 font-mono-numbers whitespace-nowrap">
                  {t('invSummaryLowPage')}: {pageSummary.pageLowCount}
                </span>
              </div>
            </div>

            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">
                {lang === 'zh' ? '本页库存货值 (零售 / 成本)' : 'Hodnota zásob (strana)'}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono-numbers">
                <span className="text-base sm:text-lg font-bold text-slate-900 whitespace-nowrap">
                  {formatEur(pageSummary.pageStockValueRetail)}
                </span>
                <span className="text-[11px] text-slate-500 whitespace-nowrap">
                  / {formatEur(pageSummary.pageStockValueCost)}
                </span>
              </div>
            </div>

            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">{t('invSummaryAvgMargin')}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`text-base sm:text-lg font-bold font-mono-numbers ${
                    avgMarginPct === null
                      ? 'text-slate-400'
                      : avgMarginPct < 10
                      ? 'text-rose-700'
                      : avgMarginPct < 22
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }`}
                >
                  {avgMarginPct === null ? '—' : `${avgMarginPct.toFixed(1)}%`}
                </span>
                <span className="text-[11px] text-slate-500 whitespace-nowrap">VAT 23%</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            data-testid="inv-low-kpi-strip"
            className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200 bg-amber-50/25 [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-slate-200 lg:[&>*]:border-r lg:[&>*:last-child]:border-r-0 [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-slate-200 lg:[&>*:nth-child(-n+2)]:border-b-0"
          >
            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">
                {lang === 'zh' ? '当前告警商品数' : 'Položky v alerte'}
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono-numbers text-amber-700">
                {formatQty(lowStockSummary.alertCount)}
              </div>
            </div>
            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">
                {lang === 'zh' ? '其中已缺货 / 负库存' : 'Vypredané / záporné'}
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono-numbers text-rose-700">
                {formatQty(lowStockSummary.outOfStockCount)}
              </div>
            </div>
            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">
                {lang === 'zh' ? '累计低于警戒缺口' : 'Celkový chýbajúci počet'}
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono-numbers text-slate-900">
                +{formatQty(lowStockSummary.totalGapQty)}
              </div>
            </div>
            <div className="px-3.5 sm:px-4 py-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-500 truncate">
                {lang === 'zh' ? '估算补货成本 (按 Cena2)' : 'Odhad nákladov (Cena2)'}
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono-numbers text-slate-900">
                {formatEur(lowStockSummary.estimatedRestockCost)}
              </div>
            </div>
          </div>
        )}

        {/* 3. Error Banner (non-destructive) */}
        {errorMsg && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-rose-800">
            <span className="font-medium">{errorMsg}</span>
            <button
              type="button"
              onClick={() => (subTab === 'all' ? void loadProducts() : void loadLowStock(false))}
              className="px-2.5 py-1 rounded bg-white border border-rose-300 font-semibold hover:bg-rose-100 whitespace-nowrap"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {subTab === 'all' ? (
          <>
            {/* 4a. Integrated Filter Bar */}
            <form
              onSubmit={handleSearchSubmit}
              className="px-4 py-3 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center gap-2.5"
            >
              <div className="flex-1 min-w-0 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('invSearchPlaceholder')}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Segmented Stock Status Tabs */}
                <div
                  role="group"
                  aria-label={t('invStockAll')}
                  className="inline-flex items-center p-1 bg-slate-100 rounded-lg"
                >
                  {(
                    [
                      ['', lang === 'zh' ? '全部' : 'Všetky'],
                      ['in', t('invStockIn')],
                      ['low', t('invStockLow')],
                      ['out', t('invStockOut')],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val || 'all'}
                      type="button"
                      data-testid={`inv-stock-filter-${val || 'all'}`}
                      onClick={() => {
                        setStockFilter(val);
                        setPage(1);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        stockFilter === val
                          ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <select
                  value={supplier}
                  onChange={(e) => {
                    setSupplier(e.target.value);
                    setPage(1);
                  }}
                  aria-label={t('invSupplierAll')}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[180px]"
                >
                  <option value="">{t('invSupplierAll')}</option>
                  {suppliers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap shrink-0"
                >
                  {lang === 'zh' ? '查询' : 'Hľadať'}
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="px-2.5 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap shrink-0 inline-flex items-center gap-1"
                    title={t('reset')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('reset')}</span>
                  </button>
                )}
              </div>
            </form>

            {/* 5a. Desktop Data Grid */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse" data-testid="inventory-table">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-2 text-center w-14 whitespace-nowrap">
                      {t('invColStatus')}
                    </th>

                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Nazov')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColName')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Barcode')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColBarcode')} / {t('invColKod')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>

                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('Surplus')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColStockThreshold')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>

                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('Cena')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColCena')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>

                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('Cena2')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{lang === 'zh' ? '成本' : 'Náklady'}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>

                    <th className="py-2.5 px-3 text-right whitespace-nowrap">
                      {t('invVatNetRate')}
                    </th>

                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Supplier')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{`${t('invColCategory')} · ${t('invColSupplier')}`}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loading && rows.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={colCount} className="py-3 px-4">
                          <div className="h-4 bg-slate-100 rounded w-full" />
                        </td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="py-12 text-center text-slate-500">
                        <div>{t('noData')}</div>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                          >
                            {t('reset')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => {
                      const status = getStockStatus(p.Surplus, p.WarningAt);
                      const isLow = status === 'low';
                      const nameLines = resolveProductDisplayLines(p.Nazov, p.name_zh, lang);

                      return (
                        <tr
                          key={p.Barcode}
                          onClick={() => setDetailProduct(p)}
                          className={`cursor-pointer transition-colors ${
                            isLow
                              ? 'bg-amber-50/50 hover:bg-amber-100/60'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* 1. Compact Stock Status (Icon + Label Below) */}
                          <td className="py-2 px-2 text-center w-14 whitespace-nowrap">
                            {renderCompactStatusTag(p.Surplus, p.WarningAt)}
                          </td>

                          {/* 2. Product Identity */}
                          <td className="py-2.5 px-3 max-w-[260px]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailProduct(p);
                              }}
                              className="font-semibold text-slate-900 truncate block max-w-full text-left hover:text-indigo-700"
                              title={nameLines.line2 ? `${nameLines.line1} ${nameLines.line2}` : nameLines.line1}
                            >
                              {nameLines.line1 || '—'}
                            </button>
                            {nameLines.line2 && (
                              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                {nameLines.line2}
                              </div>
                            )}
                            {nameLines.line3 && (
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                {nameLines.line3}
                              </div>
                            )}
                          </td>

                          {/* 3. Barcode & Kod */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono-numbers">
                            <div className="font-medium text-slate-800">{p.Barcode}</div>
                            {p.Kod && (
                              <div className="text-[11px] text-slate-400">{p.Kod}</div>
                            )}
                          </td>

                          {/* 4. Surplus / WarningAt */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="font-mono-numbers">
                              <span className="font-semibold text-slate-900">
                                {formatQty(p.Surplus ?? 0)}
                              </span>
                              {(p.WarningAt ?? 0) > 0 && (
                                <span className="text-[11px] text-slate-400 ml-1">
                                  / {p.WarningAt ?? 0}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 5. Cena (incl. 23% VAT) */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span className="font-mono-numbers font-semibold text-slate-900">
                              {formatEur(p.Cena)}
                            </span>
                          </td>

                          {/* 6. Cena2 (excl. VAT cost) */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span className="font-mono-numbers text-slate-600">
                              {formatEur(p.Cena2)}
                            </span>
                          </td>

                          {/* 7. Live Net Margin % & EUR */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {renderMarginDisplay(p.Cena, p.Cena2)}
                          </td>

                          {/* 8. Category & Supplier */}
                          <td className="py-2.5 px-3 max-w-[190px]">
                            <div className="min-w-0">
                              <div className="truncate">{renderCategoryCell(p)}</div>
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                {p.Supplier || '—'}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 5b. Mobile Card Layout (< 768px) */}
            <div className="md:hidden divide-y divide-slate-200">
              {loading && rows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">{t('loading')}</div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">{t('noData')}</div>
              ) : (
                rows.map((p) => {
                  const status = getStockStatus(p.Surplus, p.WarningAt);
                  const vat = calculateVatMetrics(p.Cena, p.Cena2);
                  const nameLines = resolveProductDisplayLines(p.Nazov, p.name_zh, lang);
                  const catName =
                    lang === 'sk'
                      ? p.category_name_sk || p.category_name_zh
                      : p.category_name_zh || p.category_name_sk;

                  return (
                    <div
                      key={p.Barcode}
                      className={`p-3.5 space-y-2.5 ${
                        status === 'low' ? 'bg-amber-50/50' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(p)}
                            className="text-sm font-semibold text-slate-900 truncate block max-w-full text-left"
                          >
                            {nameLines.line1 || '—'}
                          </button>
                          {nameLines.line2 && (
                            <div className="text-xs text-slate-500 truncate mt-0.5">
                              {nameLines.line2}
                            </div>
                          )}
                          {nameLines.line3 && (
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              {nameLines.line3}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono-numbers text-slate-700">{p.Barcode}</span>
                            {p.Kod && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-numbers">{p.Kod}</span>
                              </>
                            )}
                            {p.Supplier && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{p.Supplier}</span>
                              </>
                            )}
                            {catName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-600">{catName}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {renderStatusTag(p.Surplus, p.WarningAt)}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                        <div className="grid grid-cols-3 gap-2.5 font-mono-numbers min-w-0 flex-1">
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-400 whitespace-nowrap">
                              {lang === 'zh' ? '库存 / 警戒' : 'Zásoba'}
                            </div>
                            <div className="font-semibold text-slate-900 whitespace-nowrap">
                              {formatQty(p.Surplus ?? 0)}
                              <span className="text-slate-400 font-normal"> / {p.WarningAt ?? 0}</span>
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-400 whitespace-nowrap">
                              {lang === 'zh' ? '售价 / 成本' : 'Cena / Cena2'}
                            </div>
                            <div className="font-semibold text-slate-900 leading-tight">
                              <div>{formatEur(p.Cena)}</div>
                              <div className="text-slate-400 text-[10px] font-normal">
                                {formatEur(p.Cena2)}
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-400 whitespace-nowrap">
                              {lang === 'zh' ? '净毛利' : 'Marža'}
                            </div>
                            {!hasCostData(p.Cena2) ? (
                              <div className="font-semibold text-rose-600 whitespace-nowrap">
                                error
                              </div>
                            ) : (
                              <div
                                className={`font-semibold whitespace-nowrap ${
                                  vat.netMarginRate === null
                                    ? 'text-slate-400'
                                    : vat.netMarginRate * 100 < 10
                                    ? 'text-rose-700'
                                    : vat.netMarginRate * 100 < 22
                                    ? 'text-amber-700'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {vat.netMarginRate === null
                                  ? '—'
                                  : `${(vat.netMarginRate * 100).toFixed(1)}%`}
                              </div>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setDetailProduct(p)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-[11px] shrink-0"
                        >
                          {t('invDetailEdit')}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 6. Pagination Footer */}
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-3">
                <span className="font-mono-numbers">
                  {t('invTotalPrefix')} <strong className="text-slate-900">{total}</strong>{' '}
                  {t('invTotalSuffix')}
                </span>
                <label className="inline-flex items-center gap-1.5">
                  <span>{t('invPageSize')}</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="border border-slate-300 rounded px-2 py-1 bg-white text-xs font-mono-numbers"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono-numbers px-2">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* 4b. Upgraded Low Stock Alert View */
          <div>
            <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center gap-2.5">
              <div className="flex-1 min-w-0 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={lowSearchInput}
                  onChange={(e) => setLowSearchInput(e.target.value)}
                  placeholder={t('invSearchPlaceholder')}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={lowSupplierFilter}
                  onChange={(e) => setLowSupplierFilter(e.target.value)}
                  aria-label={t('invSupplierAll')}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('invSupplierAll')}</option>
                  {suppliers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {(lowSearchInput || lowSupplierFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLowSearchInput('');
                      setLowSupplierFilter('');
                    }}
                    className="px-2.5 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                  >
                    {t('reset')}
                  </button>
                )}
              </div>
            </div>

            {/* Desktop Low-Stock Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-amber-50/70 border-b border-amber-200 text-[11px] font-semibold text-amber-900">
                    <th className="py-2.5 px-3">{t('invColBarcode')} / {t('invColKod')}</th>
                    <th className="py-2.5 px-3">{t('invColName')} · {t('invColSupplier')}</th>
                    <th className="py-2.5 px-3">{t('invColCategory')}</th>
                    <th className="py-2.5 px-3 text-right">{t('invColSurplus')}</th>
                    <th className="py-2.5 px-3 text-right">{t('invColThreshold')}</th>
                    <th className="py-2.5 px-3 text-right">{t('invColGap')}</th>
                    <th className="py-2.5 px-3">{t('invColStatus')}</th>
                    <th className="py-2.5 px-3 text-right">{t('invColActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredLowRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        {loading ? t('loading') : t('noData')}
                      </td>
                    </tr>
                  ) : (
                    filteredLowRows.map((p) => {
                      const pct =
                        p.WarningAt > 0
                          ? Math.max(0, Math.min(100, Math.round(((p.Surplus ?? 0) / p.WarningAt) * 100)))
                          : 0;
                      const nameLines = resolveProductDisplayLines(p.Nazov, p.name_zh, lang);
                      return (
                        <tr key={p.Barcode} className="bg-amber-50/35 hover:bg-amber-50">
                          <td className="py-2.5 px-3 font-mono-numbers">
                            <div className="font-medium text-slate-700">{p.Barcode}</div>
                            {p.Kod && <div className="text-[11px] text-slate-400">{p.Kod}</div>}
                          </td>
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              onClick={() => setDetailProduct(p)}
                              className="font-semibold text-slate-900 hover:text-indigo-700 text-left block"
                            >
                              {nameLines.line1 || '—'}
                            </button>
                            {nameLines.line2 && (
                              <div className="text-[11px] text-slate-500">{nameLines.line2}</div>
                            )}
                            {p.Supplier && (
                              <div className="text-[11px] text-slate-400">{p.Supplier}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">{renderCategoryCell(p)}</td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers font-semibold">
                            {formatQty(p.Surplus)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers">
                            {p.WarningAt}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="font-mono-numbers font-bold text-rose-700">
                              +{formatQty(p.Gap)}
                            </div>
                            <div className="w-16 ml-auto h-1 bg-slate-200 rounded-full overflow-hidden mt-1">
                              <div
                                className="h-full bg-amber-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3">{renderStatusTag(p.Surplus, p.WarningAt)}</td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setDetailProduct(p)}
                              className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                            >
                              {t('invDetailEdit')}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Low-Stock Cards */}
            <div className="md:hidden divide-y divide-slate-200">
              {filteredLowRows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  {loading ? t('loading') : t('noData')}
                </div>
              ) : (
                filteredLowRows.map((p) => {
                  const nameLines = resolveProductDisplayLines(p.Nazov, p.name_zh, lang);
                  return (
                  <div key={p.Barcode} className="p-3.5 bg-amber-50/35 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {nameLines.line1 || '—'}
                        </div>
                        {nameLines.line2 && (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {nameLines.line2}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 font-mono-numbers mt-0.5">
                          {p.Barcode}
                          {p.Supplier ? ` · ${p.Supplier}` : ''}
                        </div>
                      </div>
                      {renderStatusTag(p.Surplus, p.WarningAt)}
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-4 font-mono-numbers">
                        <span>
                          {t('invColSurplus')}: <strong>{formatQty(p.Surplus)}</strong>
                        </span>
                        <span>
                          {t('invColThreshold')}: <strong>{p.WarningAt}</strong>
                        </span>
                        <span className="font-bold text-rose-700">+{formatQty(p.Gap)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetailProduct(p)}
                        className="min-h-[36px] px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-[11px]"
                      >
                        {t('invDetailEdit')}
                      </button>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </section>

      {/* Batch Import Modal */}
      <InventoryImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImported={refreshAfterMutation}
      />

      {/* Slide-Over Detail & Edit Drawer */}
      <InventoryDetailDrawer
        product={detailProduct}
        categories={categories}
        suppliers={suppliers}
        onClose={() => setDetailProduct(null)}
        onSaved={refreshAfterMutation}
        onDeleted={refreshAfterMutation}
      />

      {/* Create Product Modal */}
      <InventoryCreateModal
        isOpen={isCreateOpen}
        categories={categories}
        suppliers={suppliers}
        onClose={() => setIsCreateOpen(false)}
        onCreated={refreshAfterMutation}
      />
    </div>
  );
};
